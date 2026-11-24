"""Per-user UI appearance preferences.

Revision ID: 0006
Revises: 0005

There is no users table: ``user_key`` is derived from the verified token
(``owner`` for the master passphrase, ``cognito:<sub>`` for Cognito users) and
``data`` holds the preferences as a JSON object.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("user_key", sa.String(length=128), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_key"),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
