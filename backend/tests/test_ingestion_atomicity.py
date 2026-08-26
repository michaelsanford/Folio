"""A failed import must leave nothing behind.

The commit handler wrapped its loop in try/except with a rollback, but the
adaptive-learning helper committed on every row -- so a failure at row 400 left
rows 1-399 permanently written despite the rollback.
"""
import pytest

from app.models.rule import CategorizationRule
from app.models.transaction import Transaction


def _items(count: int, category_id: str | None = None):
    return [
        {
            "transaction_date": "2026-03-0{}".format((i % 9) + 1),
            "raw_payee": f"MERCHANT {i}",
            "normalized_payee": f"Merchant {i}",
            "amount": -10.0 - i,
            "import_hash": f"hash-{i}",
            "category_id": category_id,
        }
        for i in range(count)
    ]


def test_failed_commit_writes_no_transactions(client, db_session, sample_checking_account, monkeypatch):
    groceries_id = db_session.execute(
        __import__("sqlalchemy").text("SELECT id FROM categories WHERE slug='groceries'")
    ).scalar()

    import app.api.ingestion as ingestion

    real_bulk = ingestion.auto_learn_rules_bulk

    def explode(db, learned):
        real_bulk(db, learned)
        raise RuntimeError("simulated failure after rows were staged")

    monkeypatch.setattr(ingestion, "auto_learn_rules_bulk", explode)

    resp = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": _items(25, groceries_id),
    })

    assert resp.status_code == 400
    assert db_session.query(Transaction).count() == 0, "rollback must undo every staged row"


def test_successful_commit_writes_all_rows_and_learns_once(client, db_session, sample_checking_account):
    import sqlalchemy
    groceries_id = db_session.execute(
        sqlalchemy.text("SELECT id FROM categories WHERE slug='groceries'")
    ).scalar()

    before_rules = db_session.query(CategorizationRule).count()

    resp = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": _items(10, groceries_id),
    })

    assert resp.status_code == 200
    assert resp.json()["committed_count"] == 10
    assert db_session.query(Transaction).count() == 10

    # Ten distinct merchants, so ten new rules -- and no duplicates from re-running.
    after_rules = db_session.query(CategorizationRule).count()
    assert after_rules == before_rules + 10


def test_repeated_merchant_learns_a_single_rule(client, db_session, sample_checking_account):
    import sqlalchemy
    groceries_id = db_session.execute(
        sqlalchemy.text("SELECT id FROM categories WHERE slug='groceries'")
    ).scalar()

    before = db_session.query(CategorizationRule).count()
    items = [
        {
            "transaction_date": "2026-03-01",
            "raw_payee": "METRO GROCERY",
            "normalized_payee": "Metro",
            "amount": -20.0 - i,
            "import_hash": f"repeat-{i}",
            "category_id": groceries_id,
        }
        for i in range(8)
    ]
    resp = client.post("/api/ingestion/commit", json={
        "account_id": sample_checking_account.id,
        "items": items,
    })
    assert resp.status_code == 200
    assert db_session.query(CategorizationRule).count() == before + 1
