from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.budget import Budget, BudgetItem
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.analytics.classification import split_kind_case


def get_category_actual_spend_cents(db: Session, year: int, month: int, category_id: str) -> int:
    """Calculates total actual outflow cents for a specific category in a given calendar month."""
    start_of_month = datetime(year, month, 1)
    if month == 12:
        end_of_month = datetime(year + 1, 1, 1)
    else:
        end_of_month = datetime(year, month + 1, 1)

    kind = split_kind_case().label("kind")
    total = (
        db.query(func.sum(TransactionSplit.amount_cents))
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start_of_month,
            Transaction.transaction_date < end_of_month,
            TransactionSplit.category_id == category_id,
            kind == "EXPENSE",
        )
        .scalar()
    ) or 0
    return abs(total)


def calculate_category_rollover_cents(
    db: Session,
    category: Category,
    year: int,
    month: int,
) -> int:
    """
    Computes rollover minor units (cents) from the preceding calendar month.
    If the category has is_rollover=False, returns 0.
    If is_rollover=True, positive surplus carries over as additional available funds,
    and negative deficit strictly carries over as a reduction of available funds.
    """
    if not category.is_rollover:
        return 0

    if month == 1:
        prev_year = year - 1
        prev_month = 12
    else:
        prev_year = year
        prev_month = month - 1

    prev_budget = (
        db.query(Budget)
        .filter(Budget.year == prev_year, Budget.month == prev_month)
        .first()
    )
    if not prev_budget:
        return 0

    prev_item = (
        db.query(BudgetItem)
        .filter(BudgetItem.budget_id == prev_budget.id, BudgetItem.category_id == category.id)
        .first()
    )
    if not prev_item:
        return 0

    # Calculate actuals for prior month in this category
    prior_actual_cents = get_category_actual_spend_cents(db, prev_year, prev_month, category.id)

    # Prior available = prior planned + prior rollover
    prior_available_cents = (prev_item.planned_amount_cents or 0) + (prev_item.rollover_amount_cents or 0)
    prior_remaining_cents = prior_available_cents - prior_actual_cents

    return prior_remaining_cents
