"""Accounts owned by one or more members, and per-account visibility.

Revision ID: 0002
Revises: 0001

- ``account_owners`` (account, member) replaces ``accounts.owner_member_id``;
  existing owners are copied over before the column is dropped.
- ``accounts.visibility``: HOUSEHOLD (or NULL), TOTALS or PRIVATE
  (core/visibility.py).

Every statement stands alone: on the serverless database each schema change
commits by itself and the data copy runs in its own transaction.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_owners",
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["household_members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id", "member_id"),
    )
    op.create_index("ix_account_owners_member_id", "account_owners", ["member_id"], unique=False)
    op.add_column("accounts", sa.Column("visibility", sa.String(length=16), nullable=True))
    op.execute(
        "INSERT INTO account_owners (account_id, member_id) "
        "SELECT id, owner_member_id FROM accounts WHERE owner_member_id IS NOT NULL"
    )
    op.drop_column("accounts", "owner_member_id")


def downgrade() -> None:
    op.add_column("accounts", sa.Column("owner_member_id", sa.String(length=36), nullable=True))
    # One owner survives: the first by member id.
    op.execute(
        "UPDATE accounts SET owner_member_id = ("
        "SELECT min(member_id) FROM account_owners WHERE account_owners.account_id = accounts.id)"
    )
    op.create_foreign_key(
        "accounts_owner_member_id_fkey", "accounts", "household_members", ["owner_member_id"], ["id"], ondelete="SET NULL"
    )
    op.drop_column("accounts", "visibility")
    op.drop_index("ix_account_owners_member_id", table_name="account_owners")
    op.drop_table("account_owners")
