from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.budget import Budget, BudgetItem
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.analytics.classification import split_kind_case


def _month_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1)


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def get_category_actual_spend_cents(db: Session, year: int, month: int, category_id: str) -> int:
    """Calculates total actual outflow cents for a specific category in a given calendar month."""
    start_of_month = _month_start(year, month)
    end_of_month = _month_start(*_next_month(year, month))

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


def calculate_rollovers_cents(
    db: Session,
    category_ids: list[str],
    year: int,
    month: int,
) -> dict[str, int]:
    """Rollover (cents) into ``year``/``month`` for each rollover category.

    rollover(M) = planned(M-1) + rollover(M-1) - actual(M-1), as long as the
    previous month's budget has an item for the category; the chain stops at
    the first month without one. Computed in three queries for all categories
    and all prior months, instead of three queries per category per view --
    and derived rather than read back from the stored column, so a month that
    was never opened cannot leave a stale value in the chain.
    """
    ids = list(dict.fromkeys(category_ids))
    if not ids:
        return {}

    # Every earlier budget item for these categories, newest month first.
    items = (
        db.query(Budget.year, Budget.month, BudgetItem.category_id, BudgetItem.planned_amount_cents)
        .join(BudgetItem, BudgetItem.budget_id == Budget.id)
        .filter(
            BudgetItem.category_id.in_(ids),
            (Budget.year < year) | ((Budget.year == year) & (Budget.month < month)),
        )
        .all()
    )
    planned: dict[tuple[str, int, int], int] = {
        (cat_id, y, m): (cents or 0) for y, m, cat_id, cents in items
    }
    if not planned:
        return {cid: 0 for cid in ids}

    earliest = min((y, m) for _, y, m in planned)
    start = _month_start(*earliest)
    end = _month_start(year, month)

    kind = split_kind_case().label("kind")
    ym = func.strftime("%Y-%m", Transaction.transaction_date)
    spend_rows = (
        db.query(
            TransactionSplit.category_id,
            ym.label("ym"),
            func.sum(TransactionSplit.amount_cents).label("total"),
        )
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
            TransactionSplit.category_id.in_(ids),
            kind == "EXPENSE",
        )
        .group_by(TransactionSplit.category_id, ym)
        .all()
    )
    actual: dict[tuple[str, str], int] = {
        (cat_id, key): abs(total or 0) for cat_id, key, total in spend_rows
    }

    result: dict[str, int] = {}
    for cid in ids:
        # Walk back to the start of this category's unbroken chain of months.
        chain: list[tuple[int, int]] = []
        y, m = _prev_month(year, month)
        while (cid, y, m) in planned:
            chain.append((y, m))
            y, m = _prev_month(y, m)
        rollover = 0
        for y, m in reversed(chain):
            rollover = planned[(cid, y, m)] + rollover - actual.get((cid, f"{y:04d}-{m:02d}"), 0)
        result[cid] = rollover
    return result


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
    return calculate_rollovers_cents(db, [category.id], year, month).get(category.id, 0)
