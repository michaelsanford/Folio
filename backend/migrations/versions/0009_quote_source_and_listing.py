"""Quote provenance and resolved listings; merge bare-symbol duplicates.

Revision ID: 0009
Revises: 0008

* ``price_quotes`` gains where a price came from (MANUAL, YAHOO, TMX), its
  market time, when it was fetched, the trading session and the previous
  close. Every existing price is MANUAL: its origin cannot be known.
* ``securities`` gains ``quote_symbol`` (the listing that answers quotes) and
  ``exchange_timezone``.
* A security typed without its exchange suffix (``XEQT``) beside the same
  listing with one (``XEQT.TO`` or ``XEQT.V``, same currency) is merged into
  the suffixed one: holdings, lots and prices move over, holdings in the same
  account combine, and the bare security is removed.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

_SUFFIXES = (".TO", ".V")


def _merge_bare_duplicates(conn) -> None:
    rows = conn.execute(sa.text("SELECT id, symbol, currency FROM securities")).fetchall()
    by_symbol = {(r.symbol, r.currency): r.id for r in rows}
    for bare_id, symbol, currency in [(r.id, r.symbol, r.currency) for r in rows]:
        if "." in symbol:
            continue
        target_id = next(
            (by_symbol[(symbol + sfx, currency)] for sfx in _SUFFIXES if (symbol + sfx, currency) in by_symbol),
            None,
        )
        if target_id is None:
            continue

        for holding_id, account_id in conn.execute(
            sa.text("SELECT id, account_id FROM holdings WHERE security_id = :s"), {"s": bare_id}
        ).fetchall():
            existing = conn.execute(
                sa.text("SELECT id FROM holdings WHERE security_id = :t AND account_id = :a"),
                {"t": target_id, "a": account_id},
            ).scalar()
            if existing:
                conn.execute(
                    sa.text("UPDATE lots SET holding_id = :keep WHERE holding_id = :drop"),
                    {"keep": existing, "drop": holding_id},
                )
                conn.execute(sa.text("DELETE FROM holdings WHERE id = :h"), {"h": holding_id})
            else:
                conn.execute(
                    sa.text("UPDATE holdings SET security_id = :t WHERE id = :h"),
                    {"t": target_id, "h": holding_id},
                )

        # Prices: keep the suffixed listing's price where both have one that day.
        conn.execute(
            sa.text(
                "DELETE FROM price_quotes WHERE security_id = :b AND as_of_date IN "
                "(SELECT as_of_date FROM price_quotes WHERE security_id = :t)"
            ),
            {"b": bare_id, "t": target_id},
        )
        conn.execute(
            sa.text("UPDATE price_quotes SET security_id = :t WHERE security_id = :b"),
            {"t": target_id, "b": bare_id},
        )
        conn.execute(
            sa.text("UPDATE investment_activities SET security_id = :t WHERE security_id = :b"),
            {"t": target_id, "b": bare_id},
        )
        conn.execute(sa.text("DELETE FROM securities WHERE id = :b"), {"b": bare_id})


def upgrade() -> None:
    with op.batch_alter_table("price_quotes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source", sa.String(16), nullable=False, server_default="MANUAL"))
        batch_op.add_column(sa.Column("quoted_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("session", sa.String(8), nullable=True))
        batch_op.add_column(sa.Column("previous_close_cents", sa.Integer(), nullable=True))
    with op.batch_alter_table("securities", schema=None) as batch_op:
        batch_op.add_column(sa.Column("quote_symbol", sa.String(32), nullable=True))
        batch_op.add_column(sa.Column("exchange_timezone", sa.String(64), nullable=True))

    _merge_bare_duplicates(op.get_bind())


def downgrade() -> None:
    # Merged securities are not split again; only the columns are removed.
    with op.batch_alter_table("securities", schema=None) as batch_op:
        batch_op.drop_column("exchange_timezone")
        batch_op.drop_column("quote_symbol")
    with op.batch_alter_table("price_quotes", schema=None) as batch_op:
        batch_op.drop_column("previous_close_cents")
        batch_op.drop_column("session")
        batch_op.drop_column("fetched_at")
        batch_op.drop_column("quoted_at")
        batch_op.drop_column("source")
