"""The migrated schema's indexes: the query indexes, the partial unique import-hash index,
no redundant single-column ones, and the same set create_all builds."""
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
