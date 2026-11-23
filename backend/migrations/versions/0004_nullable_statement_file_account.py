"""Allow statement_files.account_id to be nullable for auto-detect/multi-account uploads.

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def upgrade() -> None:
    with op.batch_alter_table("statement_files", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_statement_files_account_id_accounts", type_="foreignkey")
        batch_op.alter_column(
            "account_id",
            existing_type=sa.String(length=36),
            nullable=True,
        )
        batch_op.create_foreign_key(
            "fk_statement_files_account_id_accounts",
            "accounts",
            ["account_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # Delete multi-account / unlinked statement records before tightening nullable=False
    # so downgrade cannot violate NOT NULL or foreign key checks.
    op.execute(sa.text("UPDATE transactions SET statement_file_id = NULL WHERE statement_file_id IN (SELECT id FROM statement_files WHERE account_id IS NULL)"))
    op.execute(sa.text("DELETE FROM statement_files WHERE account_id IS NULL"))
    with op.batch_alter_table("statement_files", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_statement_files_account_id_accounts", type_="foreignkey")
        batch_op.alter_column(
            "account_id",
            existing_type=sa.String(length=36),
            nullable=False,
        )
        batch_op.create_foreign_key(
            "fk_statement_files_account_id_accounts",
            "accounts",
            ["account_id"],
            ["id"],
            ondelete="CASCADE",
        )
