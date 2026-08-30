"""Add icon and color columns to accounts.

Revision ID: 0002
Revises: 0001
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("icon", sa.String(length=50), nullable=True))
    op.add_column("accounts", sa.Column("color", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("color")
        batch_op.drop_column("icon")
