"""Liability balances are the positive amount owed.

Revision ID: 0008
Revises: 0007

Balances used to be the plain sum of an account's transactions, so a card,
loan or line of credit built from imported or entered transactions came out
negative. They are now stored as the amount owed (positive while owing).

Only negative liability balances, and their snapshots, are flipped: a balance
typed in by hand as a positive amount owed was already right and is left alone.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]

# Fixed here rather than imported, so this revision never changes meaning.
_LIABILITY_TYPES = (
    "CREDIT_CARD",
    "LINE_OF_CREDIT",
    "MORTGAGE",
    "VEHICLE_LOAN",
    "STUDENT_LOAN",
    "PERSONAL_LOAN",
    "OTHER_LIABILITY",
)
_IN_LIABILITY = "(" + ", ".join(f"'{t}'" for t in _LIABILITY_TYPES) + ")"


def upgrade() -> None:
    op.execute(
        "UPDATE account_balance_snapshots SET balance_cents = -balance_cents "
        "WHERE balance_cents < 0 AND account_id IN "
        f"(SELECT id FROM accounts WHERE type IN {_IN_LIABILITY})"
    )
    op.execute(
        "UPDATE accounts SET current_balance_cents = -current_balance_cents "
        f"WHERE current_balance_cents < 0 AND type IN {_IN_LIABILITY}"
    )


def downgrade() -> None:
    # Not reversible: a balance positive before and after cannot be told apart.
    # Older code reads either sign through abs(), so leaving them is harmless.
    pass
