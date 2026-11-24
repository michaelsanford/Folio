"""Migration 0005: new indexes, the partial unique import-hash index, redundant drops."""
import sqlite3

import pytest
from alembic import command
from sqlalchemy import create_engine

from app.core import migrations
from app.core.config import settings
from app.core.database import Base

NEW = {
    "ix_transactions_transfer_transaction_id",
    "ix_transactions_statement_file_id",
    "ix_transactions_amount_date",
    "ix_categorization_rules_pattern",
    "uq_transactions_account_import_hash",
}
DROPPED = {
    "ix_transactions_account_id",
    "ix_transactions_import_hash",
    "ix_transaction_splits_transaction_id",
    "ix_account_balance_snapshots_account_id",
}


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "folio.db"
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", db_path)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    return db_path


def _indexes(db_path) -> dict[str, str]:
    conn = sqlite3.connect(str(db_path))
    try:
        return {
            name: sql
            for name, sql in conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
            )
        }
    finally:
        conn.close()


def _cfg():
    return migrations._alembic_config()


def test_upgrade_adds_and_drops_indexes(temp_db):
    command.upgrade(_cfg(), "head")
    idx = _indexes(temp_db)
    assert NEW <= set(idx)
    assert not (DROPPED & set(idx))
    assert "WHERE import_hash IS NOT NULL" in idx["uq_transactions_account_import_hash"]
    assert "UNIQUE" in idx["uq_transactions_account_import_hash"].upper()


def test_models_match_migrated_schema(temp_db, tmp_path):
    """create_all (used by the tests) must build the same index set as the migrations."""
    command.upgrade(_cfg(), "head")
    migrated = set(_indexes(temp_db))

    other = tmp_path / "create_all.db"
    engine = create_engine(f"sqlite:///{other.as_posix()}")
    Base.metadata.create_all(engine)
    engine.dispose()
    created = set(_indexes(other))

    assert migrated == created, {
        "only_in_migrations": migrated - created,
        "only_in_models": created - migrated,
    }


def test_downgrade_restores_previous_indexes(temp_db):
    command.upgrade(_cfg(), "head")
    command.downgrade(_cfg(), "0004")
    idx = set(_indexes(temp_db))
    assert DROPPED <= idx
    assert not (NEW & idx)
    command.upgrade(_cfg(), "head")
    assert NEW <= set(_indexes(temp_db))


def test_existing_duplicates_skip_the_unique_index(temp_db, caplog):
    command.upgrade(_cfg(), "0004")
    conn = sqlite3.connect(str(temp_db))
    try:
        conn.execute(
            "INSERT INTO accounts (id, name, type, currency, current_balance_cents, is_active, created_at, updated_at, icon, color, compounding) "
            "VALUES ('acc1', 'A', 'CHECKING', 'CAD', 0, 1, '2026-01-01', '2026-01-01', 'bank', '#000', 'MONTHLY')"
        )
        for tid in ("t1", "t2"):
            conn.execute(
                "INSERT INTO transactions (id, account_id, transaction_date, raw_payee, amount_cents, currency, import_hash, status, created_at, updated_at) "
                f"VALUES ('{tid}', 'acc1', '2026-01-01 00:00:00.000000', 'X', -100, 'CAD', 'samehash', 'CLEARED', '2026-01-01', '2026-01-01')"
            )
        conn.commit()
    finally:
        conn.close()

    with caplog.at_level("WARNING"):
        command.upgrade(_cfg(), "head")
    idx = set(_indexes(temp_db))
    assert "uq_transactions_account_import_hash" not in idx
    assert "ix_transactions_account_import_hash" in idx, "the non-unique composite must remain"
    assert {"ix_transactions_amount_date", "ix_transactions_transfer_transaction_id"} <= idx
    assert any("uq_transactions_account_import_hash" in r.getMessage() for r in caplog.records)
