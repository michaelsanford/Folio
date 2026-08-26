"""money as integer cents

Every monetary column moves from REAL to INTEGER minor units. Balances are
derived by summing transaction rows, so binary floating-point error accumulated
silently across reconciliation, budget actuals, and amortization.

The deduplication fingerprint also changes: it keyed on ``f"{amount:.2f}"`` and
now keys on exact integer cents. Every existing ``import_hash`` is therefore
recomputed in this migration -- without that, previously imported statements
would no longer match and re-importing one would duplicate every row.

Revision ID: 0004
Revises: 0003
"""
import hashlib
from decimal import Decimal, ROUND_HALF_UP
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column, nullable) -- `column` is the pre-migration dollar name.
MONEY_COLUMNS = [
    ("accounts", "current_balance", False),
    ("accounts", "credit_limit", True),
    ("accounts", "loan_original_principal", True),
    ("accounts", "monthly_payment", True),
    ("accounts", "escrow_payment", True),
    ("transactions", "amount", False),
    ("transaction_splits", "amount", False),
    ("budgets", "total_income_target", False),
    ("budgets", "total_expense_target", False),
    ("budget_items", "planned_amount", False),
    ("categorization_rules", "min_amount", True),
    ("categorization_rules", "max_amount", True),
    ("account_balance_snapshots", "balance", False),
]


def _to_cents(value) -> int:
    """Mirrors app.core.money.to_cents, inlined so the migration is self-contained."""
    if value is None:
        return 0
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add the cents column beside each dollar column and copy the data across.
    for table, column, nullable in MONEY_COLUMNS:
        cents_col = f"{column}_cents"
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(cents_col, sa.Integer(), nullable=True, server_default="0" if not nullable else None)
            )

        rows = conn.execute(sa.text(f"SELECT id, {column} FROM {table}")).fetchall()
        for row_id, value in rows:
            cents = None if (value is None and nullable) else _to_cents(value)
            conn.execute(
                sa.text(f"UPDATE {table} SET {cents_col} = :c WHERE id = :i"),
                {"c": cents, "i": row_id},
            )

        # 2. Drop the float column and tighten nullability on the replacement.
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column(column)
            if not nullable:
                batch_op.alter_column(cents_col, existing_type=sa.Integer(), nullable=False)

    # 3. Recompute every deduplication fingerprint against the new cents keying.
    rows = conn.execute(
        sa.text(
            "SELECT id, account_id, transaction_date, amount_cents, raw_payee "
            "FROM transactions WHERE import_hash IS NOT NULL"
        )
    ).fetchall()
    for row_id, account_id, txn_date, amount_cents, raw_payee in rows:
        date_str = str(txn_date)[:10]
        normalized_payee = "".join(c for c in (raw_payee or "").lower() if c.isalnum())
        payload = f"{account_id}|{date_str}|{amount_cents}|{normalized_payee}"
        conn.execute(
            sa.text("UPDATE transactions SET import_hash = :h WHERE id = :i"),
            {"h": hashlib.sha256(payload.encode("utf-8")).hexdigest(), "i": row_id},
        )


def downgrade() -> None:
    conn = op.get_bind()

    for table, column, nullable in MONEY_COLUMNS:
        cents_col = f"{column}_cents"
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column(column, sa.Float(), nullable=True))

        conn.execute(sa.text(f"UPDATE {table} SET {column} = {cents_col} / 100.0"))

        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column(cents_col)
            if not nullable:
                batch_op.alter_column(column, existing_type=sa.Float(), nullable=False)

    # Restore the two-decimal-string fingerprint.
    rows = conn.execute(
        sa.text(
            "SELECT id, account_id, transaction_date, amount, raw_payee "
            "FROM transactions WHERE import_hash IS NOT NULL"
        )
    ).fetchall()
    for row_id, account_id, txn_date, amount, raw_payee in rows:
        date_str = str(txn_date)[:10]
        normalized_payee = "".join(c for c in (raw_payee or "").lower() if c.isalnum())
        payload = f"{account_id}|{date_str}|{amount:.2f}|{normalized_payee}"
        conn.execute(
            sa.text("UPDATE transactions SET import_hash = :h WHERE id = :i"),
            {"h": hashlib.sha256(payload.encode("utf-8")).hexdigest(), "i": row_id},
        )
