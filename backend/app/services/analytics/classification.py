"""Single source of truth for deciding what a split *means* in cash-flow terms.

Previously both the dashboard engine and the budget actuals decided this inline,
and both got it wrong the same way: a TRANSFER category matched neither the
INCOME nor the EXPENSE branch by type, so the decision fell through to the sign
of the amount. That made every credit-card payment an expense on the chequing
account and income on the card, inflating both sides of the cash-flow summary
and corrupting the savings rate, the Sankey diagram, and budget actuals.
"""
from typing import Literal

from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit

SplitKind = Literal["INCOME", "EXPENSE", "TRANSFER"]


def classify_split(
    split: TransactionSplit,
    category: Category | None,
    transaction: Transaction | None = None,
) -> SplitKind:
    """Classify one split as income, expense, or a movement between own accounts.

    Resolution order (most explicit signal wins):
      1. An explicit TRANSFER category -- the user said so.
      2. A transaction linked to its opposite half via ``transfer_transaction_id``.
      3. An explicit INCOME or EXPENSE category.
      4. Fall back to the sign of the amount.
    """
    if category is not None and category.type == CategoryType.TRANSFER:
        return "TRANSFER"

    if transaction is not None and transaction.transfer_transaction_id:
        return "TRANSFER"

    if category is not None:
        if category.type == CategoryType.INCOME:
            return "INCOME"
        if category.type == CategoryType.EXPENSE:
            return "EXPENSE"

    return "INCOME" if split.amount_cents > 0 else "EXPENSE"


def split_kind_case():
    """The SQL equivalent of :func:`classify_split`, for GROUP BY aggregation.

    Kept beside the Python version so the two definitions cannot drift apart.
    Callers must join ``TransactionSplit -> Transaction`` and outer-join
    ``Category`` for this expression to resolve.
    """
    from sqlalchemy import case

    return case(
        (Category.type == CategoryType.TRANSFER, "TRANSFER"),
        (Transaction.transfer_transaction_id.isnot(None), "TRANSFER"),
        (Category.type == CategoryType.INCOME, "INCOME"),
        (Category.type == CategoryType.EXPENSE, "EXPENSE"),
        (TransactionSplit.amount_cents > 0, "INCOME"),
        else_="EXPENSE",
    )
