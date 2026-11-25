"""Whole-vault export to SQLite and import into an empty database."""
import sqlite3
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.archive_store import decompress_file
from app.core.database import Base
from app.models.account import Account, AccountType
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.archive.export import export_database, import_database


def _seed_ledger(db):
    chequing = Account(name="Chequing", type=AccountType.CHECKING, current_balance=0.0)
    savings = Account(name="Savings", type=AccountType.SAVINGS, current_balance=0.0)
    db.add_all([chequing, savings])
    db.flush()
    out = Transaction(account_id=chequing.id, transaction_date=datetime(2026, 2, 1), raw_payee="To savings", amount=-25.0)
    inn = Transaction(account_id=savings.id, transaction_date=datetime(2026, 2, 1), raw_payee="From chequing", amount=25.0)
    out.splits.append(TransactionSplit(amount=-25.0))
    db.add_all([out, inn])
    db.flush()
    out.transfer_transaction_id, inn.transfer_transaction_id = inn.id, out.id
    db.commit()
    return out.id, inn.id


def test_export_then_import_round_trips_every_row(db_session, scratch_db, tmp_path):
    out_id, in_id = _seed_ledger(db_session)
    path = tmp_path / "folio.db.zst"
    exported = export_database(db_session, path)
    assert exported["transactions"] == 2 and exported["categories"] > 0

    plain = tmp_path / "folio.db"
    decompress_file(path, plain)
    with sqlite3.connect(plain) as conn:
        assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 2

    _, scratch = scratch_db
    Base.metadata.create_all(bind=scratch)
    with Session(scratch) as target:
        imported = import_database(target, path)
        assert imported == exported
        assert target.get(Transaction, out_id).transfer_transaction_id == in_id
        assert target.query(Category).count() == db_session.query(Category).count()


def test_import_refuses_a_database_that_has_rows(db_session, tmp_path):
    path = tmp_path / "folio.db.zst"
    export_database(db_session, path)
    try:
        import_database(db_session, path)
    except RuntimeError as exc:
        assert "already has rows" in str(exc)
    else:
        raise AssertionError("import into a non-empty database must be refused")
