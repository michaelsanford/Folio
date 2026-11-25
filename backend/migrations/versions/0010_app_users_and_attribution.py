"""People who sign in, their roles, and who changed what.

Revision ID: 0010
Revises: 0009

* ``app_users``: one row per person who can sign in (role OWNER, MEMBER or
  VIEWER; status INVITED, ACTIVE or DISABLED), optionally linked to a
  household member. Rows are created on first sign-in or by an invitation, so
  the table starts empty.
* ``created_by`` / ``updated_by`` (user keys) on the rows people edit. Existing
  rows keep NULL: who made them cannot be known.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

ATTRIBUTED_TABLES = (
    "accounts",
    "budgets",
    "categorization_rules",
    "goals",
    "holdings",
    "investment_activities",
    "lots",
    "statement_files",
    "transactions",
)


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("user_key", sa.String(128), primary_key=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="MEMBER"),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column(
            "member_id",
            sa.String(36),
            sa.ForeignKey("household_members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("invited_by", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_sign_in_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("member_id", name="uq_app_users_member_id"),
    )
    op.create_index("ix_app_users_email", "app_users", ["email"])
    for table in ATTRIBUTED_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("created_by", sa.String(128), nullable=True))
            batch.add_column(sa.Column("updated_by", sa.String(128), nullable=True))


def downgrade() -> None:
    for table in ATTRIBUTED_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("updated_by")
            batch.drop_column("created_by")
    op.drop_index("ix_app_users_email", table_name="app_users")
    op.drop_table("app_users")
