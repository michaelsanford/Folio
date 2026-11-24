"""Indexes for transfer linking, dedup and rule learning; drop redundant ones.

Revision ID: 0005
Revises: 0004

Added:
* ``ix_transactions_transfer_transaction_id`` -- unpaired-transfer scans and the
  self-referencing FK (``ON DELETE SET NULL`` looks rows up by it).
* ``ix_transactions_statement_file_id`` -- the statement FK; deleting a
  statement nulls it on every imported row.
* ``ix_transactions_amount_date`` -- transfer matching probes opposite amounts
  inside a date window.
* ``ix_categorization_rules_pattern`` -- rule learning looks rules up by pattern.
* ``uq_transactions_account_import_hash`` -- partial UNIQUE on
  (account_id, import_hash) WHERE import_hash IS NOT NULL, so the database
  itself refuses a duplicate import. Skipped (with a warning) when existing
  data already holds duplicates; the non-unique composite stays either way.

Dropped (each fully served by the leading column of another index):
* ``ix_transactions_account_id`` -> ``ix_transactions_account_date``
* ``ix_transactions_import_hash`` -> no query filters on the hash without the
  account; ``ix_transactions_account_import_hash`` serves (account, hash)
* ``ix_transaction_splits_transaction_id`` -> ``ix_splits_transaction_category``
* ``ix_account_balance_snapshots_account_id`` -> ``uq_snapshot_account_date``
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

logger = logging.getLogger("alembic.runtime.migration")

UNIQUE_IMPORT_HASH = "uq_transactions_account_import_hash"

ADDED = (
    ("ix_transactions_transfer_transaction_id", "transactions", ["transfer_transaction_id"]),
    ("ix_transactions_statement_file_id", "transactions", ["statement_file_id"]),
    ("ix_transactions_amount_date", "transactions", ["amount_cents", "transaction_date"]),
    ("ix_categorization_rules_pattern", "categorization_rules", ["pattern"]),
)

REDUNDANT = (
    ("ix_transactions_account_id", "transactions", ["account_id"]),
    ("ix_transactions_import_hash", "transactions", ["import_hash"]),
    ("ix_transaction_splits_transaction_id", "transaction_splits", ["transaction_id"]),
    ("ix_account_balance_snapshots_account_id", "account_balance_snapshots", ["account_id"]),
)


def _existing_indexes(table: str) -> set[str]:
    return {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    for name, table, cols in ADDED:
        if name not in _existing_indexes(table):
            op.create_index(name, table, cols, unique=False)

    duplicate = bind.execute(
        sa.text(
            "SELECT account_id, import_hash FROM transactions "
            "WHERE import_hash IS NOT NULL "
            "GROUP BY account_id, import_hash HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate is None:
        if UNIQUE_IMPORT_HASH not in _existing_indexes("transactions"):
            op.create_index(
                UNIQUE_IMPORT_HASH,
                "transactions",
                ["account_id", "import_hash"],
                unique=True,
                sqlite_where=sa.text("import_hash IS NOT NULL"),
            )
    else:
        logger.warning(
            "Existing transactions share an (account_id, import_hash) pair; not creating %s. "
            "Imports still de-duplicate in application code via ix_transactions_account_import_hash.",
            UNIQUE_IMPORT_HASH,
        )

    for name, table, _cols in REDUNDANT:
        if name in _existing_indexes(table):
            op.drop_index(name, table_name=table)


def downgrade() -> None:
    for name, table, cols in REDUNDANT:
        if name not in _existing_indexes(table):
            op.create_index(name, table, cols, unique=False)

    if UNIQUE_IMPORT_HASH in _existing_indexes("transactions"):
        op.drop_index(UNIQUE_IMPORT_HASH, table_name="transactions")

    for name, table, _cols in reversed(ADDED):
        if name in _existing_indexes(table):
            op.drop_index(name, table_name=table)
