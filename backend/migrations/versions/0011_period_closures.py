"""Closed years.

Revision ID: 0011
Revises: 0010

``period_closures`` records each year an owner closed: transactions dated on
or before the latest open closure's ``closed_through`` can no longer change,
and a read-only archive of the year is kept (``archive_key``, checksum).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.create_table(
        "period_closures",
        sa.Column("year", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("closed_through", sa.Date(), nullable=False),
        sa.Column("closed_by", sa.String(128), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=False),
        sa.Column("archive_key", sa.String(255), nullable=True),
        sa.Column("archive_sha256", sa.String(64), nullable=True),
        sa.Column("archive_bytes", sa.Integer(), nullable=True),
        sa.Column("row_counts", sa.JSON(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
        sa.Column("reopened_by", sa.String(128), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("period_closures")
