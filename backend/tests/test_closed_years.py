"""Closing a year: the lock, bulk paths that skip it, imports, and the archive."""
import hashlib
import sqlite3
from compression import zstd
from datetime import date, datetime

import pytest

from app.core.config import settings
from app.models.transaction import Transaction, TransactionSplit

PAST = date.today().year - 1
CURRENT = date.today().year


@pytest.fixture(autouse=True)
def archive_dir(tmp_path, monkeypatch):
    # Keep archives out of the developer's data dir.
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    return tmp_path / "archives"


def _txn(db, account, when: datetime, amount: float, payee: str = "SHOP", category_id=None) -> Transaction:
    txn = Transaction(account_id=account.id, transaction_date=when, raw_payee=payee, normalized_payee=payee, amount=amount)
    txn.splits.append(TransactionSplit(category_id=category_id, amount=amount))
    db.add(txn)
    db.commit()
    return txn


@pytest.fixture
def ledger(db_session, sample_checking_account):
    old = _txn(db_session, sample_checking_account, datetime(PAST, 6, 15), -42.0, "OLD SHOP")
    new = _txn(db_session, sample_checking_account, datetime(CURRENT, 1, 10), -10.0, "NEW SHOP")
    return old, new


def test_closing_a_year_locks_its_transactions(client, db_session, ledger, sample_checking_account):
    old, new = ledger
    res = client.post(f"/api/periods/{PAST}/close")
    assert res.status_code == 200, res.text
    assert res.json()["closed_through"] == f"{PAST}-12-31"

    edit = client.put(f"/api/transactions/{old.id}", json={"notes": "late fix"})
    assert edit.status_code == 409
    assert edit.json()["detail"]["code"] == "period_closed"
    assert client.delete(f"/api/transactions/{old.id}").status_code == 409
    backdated = client.post("/api/transactions", json={
        "account_id": sample_checking_account.id,
        "transaction_date": f"{PAST}-12-31T12:00:00",
        "raw_payee": "Forgot this",
        "amount": -5,
    })
    assert backdated.status_code == 409
    # Moving an open transaction into the closed year is refused too.
    moved = client.put(f"/api/transactions/{new.id}", json={"transaction_date": f"{PAST}-11-01T00:00:00"})
    assert moved.status_code == 409
    # Each request normally has its own session; this test shares one, so drop
    # the refused change before the next request.
    db_session.rollback()

    assert client.put(f"/api/transactions/{new.id}", json={"notes": "fine"}).status_code == 200


def test_reopening_unlocks_and_keeps_the_archive(client, ledger):
    old, _ = ledger
    client.post(f"/api/periods/{PAST}/close")
    reopened = client.post(f"/api/periods/{PAST}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["is_active"] is False and reopened.json()["archive_available"] is True
    assert client.put(f"/api/transactions/{old.id}", json={"notes": "late fix"}).status_code == 200

    listing = client.get("/api/periods").json()
    assert listing["closed_through_year"] is None
    assert PAST in listing["closable_years"]
    # Closing again works and replaces the archive.
    assert client.post(f"/api/periods/{PAST}/close").status_code == 200


def test_only_finished_years_close_once(client, ledger):
    assert client.post(f"/api/periods/{CURRENT}/close").json()["detail"]["code"] == "year_not_over"
    client.post(f"/api/periods/{PAST}/close")
    again = client.post(f"/api/periods/{PAST}/close")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_closed"
    listing = client.get("/api/periods").json()
    assert listing["closed_through_year"] == PAST
    assert PAST not in listing["closable_years"]


def test_bulk_rules_leave_closed_years_alone(client, db_session, ledger):
    old, new = ledger
    client.post(f"/api/periods/{PAST}/close")
    res = client.post("/api/rules/apply-batch")
    assert res.status_code == 200, res.text
    db_session.expire_all()
    # Whatever the engine decided for the open row, the closed one never changed.
    assert db_session.get(Transaction, old.id).updated_by is None
    assert db_session.get(Transaction, old.id).splits[0].category_id is None


def test_import_skips_rows_in_a_closed_year(client, db_session, ledger, sample_checking_account):
    client.post(f"/api/periods/{PAST}/close")
    res = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": [
            {"transaction_date": f"{PAST}-12-30", "raw_payee": "Late", "normalized_payee": "Late",
             "amount": -1.0, "import_hash": "h-closed"},
            {"transaction_date": f"{CURRENT}-02-01", "raw_payee": "Fresh", "normalized_payee": "Fresh",
             "amount": -2.0, "import_hash": "h-open"},
        ],
    })
    assert res.status_code == 200, res.text
    assert res.json()["committed_count"] == 1
    assert res.json()["skipped_closed_count"] == 1
    assert db_session.query(Transaction).filter(Transaction.raw_payee == "Late").count() == 0


def test_archive_holds_exactly_the_year(client, ledger, archive_dir, tmp_path):
    closed = client.post(f"/api/periods/{PAST}/close").json()
    assert closed["row_counts"]["transactions"] == 1

    res = client.get(f"/api/periods/{PAST}/archive")
    assert res.status_code == 200
    assert res.headers["content-disposition"].endswith(f'filename="folio-{PAST}.db.zst"')
    assert hashlib.sha256(res.content).hexdigest() == closed["archive_sha256"] == res.headers["x-archive-sha256"]
    assert len(list(archive_dir.rglob("*.db.zst"))) == 1

    plain = tmp_path / "check.db"
    plain.write_bytes(zstd.decompress(res.content))
    conn = sqlite3.connect(plain)
    try:
        payees = [r[0] for r in conn.execute("SELECT raw_payee FROM transactions")]
        splits = conn.execute("SELECT COUNT(*) FROM transaction_splits").fetchone()[0]
        info = conn.execute("SELECT year FROM archive_info").fetchone()[0]
        accounts = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    finally:
        conn.close()
    assert payees == ["OLD SHOP"] and splits == 1 and info == PAST and accounts == 1


def test_a_failed_archive_leaves_the_year_open(client, ledger, monkeypatch):
    from app.api import periods

    def broken(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(periods, "create_year_archive", broken)
    res = client.post(f"/api/periods/{PAST}/close")
    assert res.status_code == 503 and res.json()["detail"]["code"] == "archive_failed"
    assert client.get("/api/periods").json()["closed_through_year"] is None
