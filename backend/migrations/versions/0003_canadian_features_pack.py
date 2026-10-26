"""Add household members, goals, and budget rollovers.

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create household_members table
    op.create_table(
        "household_members",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#10B981"),
        sa.Column("avatar_icon", sa.String(length=50), nullable=False, server_default="user"),
        sa.Column("role", sa.String(length=50), nullable=True, server_default="Member"),
        sa.Column("notes", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    # 2. Add owner_member_id to accounts
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("owner_member_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_accounts_owner_member_id",
            "household_members",
            ["owner_member_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # 3. Add assigned_member_id to transactions
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("assigned_member_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_transactions_assigned_member_id",
            "household_members",
            ["assigned_member_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # 4. Add is_rollover to categories
    with op.batch_alter_table("categories") as batch_op:
        batch_op.add_column(sa.Column("is_rollover", sa.Boolean(), nullable=False, server_default=sa.false()))

    # 5. Add rollover_amount_cents to budget_items
    with op.batch_alter_table("budget_items") as batch_op:
        batch_op.add_column(sa.Column("rollover_amount_cents", sa.Integer(), nullable=False, server_default="0"))

    # 6. Create goals table
    op.create_table(
        "goals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "type",
            sa.Enum("SAVINGS", "EMERGENCY_FUND", "TFSA_ANNUAL", "FHSA_ANNUAL", "HBP_REPAYMENT", "DEBT_PAYOFF", name="goaltype"),
            nullable=False,
            server_default="SAVINGS",
        ),
        sa.Column("target_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_amount_cents", sa.Integer(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("emergency_fund_months", sa.Integer(), nullable=True, server_default="6"),
        sa.Column("excluded_category_ids", sa.Text(), nullable=True),
        sa.Column("linked_account_id", sa.String(length=36), nullable=True),
        sa.Column("owner_member_id", sa.String(length=36), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["linked_account_id"], ["accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_member_id"], ["household_members.id"], ondelete="SET NULL"),
    )


def downgrade() -> None:
    op.drop_table("goals")
    with op.batch_alter_table("budget_items") as batch_op:
        batch_op.drop_column("rollover_amount_cents")
    with op.batch_alter_table("categories") as batch_op:
        batch_op.drop_column("is_rollover")
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_constraint("fk_transactions_assigned_member_id", type_="foreignkey")
        batch_op.drop_column("assigned_member_id")
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_constraint("fk_accounts_owner_member_id", type_="foreignkey")
        batch_op.drop_column("owner_member_id")
    op.drop_table("household_members")
