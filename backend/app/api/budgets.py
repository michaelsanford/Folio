import uuid
from datetime import date, datetime, timezone
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload
from app.core.database import get_db
from app.core.money import from_cents
from app.models.budget import Budget, BudgetItem
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit
from app.services.analytics.classification import split_kind_case
from app.services.budgeting.rollover_engine import calculate_rollovers_cents
from app.schemas.budget import (
    BudgetCreate,
    BudgetUpdate,
    BudgetItemCreate,
    BudgetResponse,
    BudgetItemResponse,
    CashFlowForecastResponse,
)

router = APIRouter(prefix="/budgets", tags=["Budgets"])


_BUDGET_NAMESPACE = uuid.UUID("6f1d8a52-3c47-4e0b-9b8e-2d5a7c9e4f13")


def budget_id_for(year: int, month: int) -> str:
    """Deterministic id for a month's budget.

    A month that has never been edited is shown without being written (GET
    must not commit); it still needs an id the client can send back, and that
    id must stay the same once the budget is actually created.
    """
    return str(uuid.uuid5(_BUDGET_NAMESPACE, f"{year:04d}-{month:02d}"))


def _virtual_item_id(budget_id: str, category_id: str) -> str:
    return str(uuid.uuid5(_BUDGET_NAMESPACE, f"{budget_id}:{category_id}"))


@lru_cache(maxsize=1)
def _virtual_budget_months() -> dict[str, tuple[int, int]]:
    # The schema bounds years to 2000-2100: 1,212 ids, computed once.
    return {
        budget_id_for(y, m): (y, m)
        for y in range(2000, 2101)
        for m in range(1, 13)
    }


def _find_budget(db: Session, budget_id: str, *, create: bool) -> Budget | None:
    """Look a budget up by id, materializing a not-yet-saved month on writes."""
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if budget or not create:
        return budget
    ym = _virtual_budget_months().get(budget_id)
    if ym is None:
        return None
    budget = db.query(Budget).filter(Budget.year == ym[0], Budget.month == ym[1]).first()
    if budget is None:
        budget = Budget(id=budget_id, year=ym[0], month=ym[1])
        db.add(budget)
        db.flush()
    return budget


def _budget_response(db: Session, year: int, month: int, budget: Budget | None) -> BudgetResponse:
    """Actuals, rollovers and targets for a month. Read-only: never writes.

    Budgeted expense categories (and expense categories with spending) that
    have no saved item are shown as zero-target rows, computed on the fly
    instead of being inserted on every view.
    """
    start_of_month = datetime(year, month, 1)
    end_of_month = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)

    # Aggregate in SQL, and classify each group so that transfers between the
    # household's own accounts never land in budget actuals or the month totals.
    kind = split_kind_case().label("kind")
    rows = (
        db.query(
            kind,
            TransactionSplit.category_id.label("category_id"),
            func.sum(TransactionSplit.amount_cents).label("total_cents"),
        )
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .outerjoin(Category, TransactionSplit.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= start_of_month,
            Transaction.transaction_date < end_of_month,
        )
        .group_by(kind, TransactionSplit.category_id)
        .all()
    )

    # Exact integer cents throughout; converted to dollars only at the response.
    actuals_by_cat: dict[str, int] = {}
    income_cents = 0
    expense_cents = 0

    for row in rows:
        total = row.total_cents or 0
        if row.kind == "TRANSFER":
            continue
        if row.kind == "INCOME":
            income_cents += total
            continue
        # EXPENSE: stored negative, reported as a positive outflow.
        spent = -total
        expense_cents += spent
        if row.category_id:
            actuals_by_cat[row.category_id] = actuals_by_cat.get(row.category_id, 0) + spent

    saved_items: list[BudgetItem] = []
    if budget is not None and budget.id is not None:
        saved_items = (
            db.query(BudgetItem)
            .options(joinedload(BudgetItem.category))
            .filter(BudgetItem.budget_id == budget.id)
            .all()
        )
    budget_id = budget.id if budget is not None and budget.id else budget_id_for(year, month)

    # (item_id, category_id, planned_cents, category)
    lines: list[tuple[str, str, int, Category | None]] = [
        (it.id, it.category_id, it.planned_amount_cents or 0, it.category) for it in saved_items
    ]
    present = {it.category_id for it in saved_items}

    budgeted_categories = (
        db.query(Category)
        .filter(Category.is_budgeted.is_(True), Category.type == CategoryType.EXPENSE)
        .all()
    )
    for cat in budgeted_categories:
        if cat.id not in present:
            lines.append((_virtual_item_id(budget_id, cat.id), cat.id, 0, cat))
            present.add(cat.id)

    # Also show any expense category that had actual spend this month
    missing_spend_ids = [cid for cid in actuals_by_cat if cid not in present]
    if missing_spend_ids:
        for cat in db.query(Category).filter(Category.id.in_(missing_spend_ids)).all():
            if cat.type == CategoryType.EXPENSE:
                lines.append((_virtual_item_id(budget_id, cat.id), cat.id, 0, cat))
                present.add(cat.id)

    rollover_ids = [cid for _, cid, _, cat in lines if cat is not None and cat.is_rollover]
    rollovers = calculate_rollovers_cents(db, rollover_ids, year, month)

    items_resp: list[BudgetItemResponse] = []
    for item_id, category_id, planned_cents, category in lines:
        actual_cents = actuals_by_cat.get(category_id, 0)
        rollover_cents = rollovers.get(category_id, 0) if category is not None and category.is_rollover else 0
        available_cents = planned_cents + rollover_cents
        remaining_cents = available_cents - actual_cents
        items_resp.append(
            BudgetItemResponse(
                id=item_id,
                budget_id=budget_id,
                category_id=category_id,
                planned_amount=float(from_cents(planned_cents)),
                rollover_amount=float(from_cents(rollover_cents)),
                available_amount=float(from_cents(available_cents)),
                actual_amount=float(from_cents(actual_cents)),
                remaining_amount=float(from_cents(remaining_cents)),
                category=category,
            )
        )

    # Sort items by category name for predictable order
    items_resp.sort(key=lambda x: (x.category.name if x.category else ""))

    now = datetime.now(timezone.utc)
    return BudgetResponse(
        id=budget_id,
        year=year,
        month=month,
        total_income_target=budget.total_income_target if budget is not None else 0.0,
        total_expense_target=budget.total_expense_target if budget is not None else 0.0,
        notes=budget.notes if budget is not None else None,
        created_at=(budget.created_at if budget is not None and budget.created_at else now),
        updated_at=(budget.updated_at if budget is not None and budget.updated_at else now),
        items=items_resp,
        total_actual_income=float(from_cents(income_cents)),
        total_actual_expense=float(from_cents(expense_cents)),
    )


def populate_budget_actuals(db: Session, budget: Budget) -> BudgetResponse:
    """Calculates actual spending/income for each category in the budget month."""
    return _budget_response(db, budget.year, budget.month, budget)


@router.get("/forecast/cash-flow", response_model=CashFlowForecastResponse)
def get_cash_flow_forecast(
    days: int = Query(60, ge=7, le=180, description="Forecast horizon in days"),
    pay_cycle: str = Query("BI_WEEKLY", pattern="^(BI_WEEKLY|SEMI_MONTHLY|MONTHLY)$"),
    pay_amount: float | None = Query(None, description="Optional manual pay amount override"),
    next_pay_date: date | None = Query(None, description="Next pay date (default upcoming Friday)"),
    db: Session = Depends(get_db),
):
    """Generates day-by-day cash flow forecast considering payroll cycles and loan payments."""
    from app.services.analytics.forecast_engine import project_cash_flow
    return project_cash_flow(
        db,
        days=days,
        pay_cycle=pay_cycle,
        pay_amount=pay_amount,
        next_pay_date=next_pay_date,
    )


@router.get("/current", response_model=BudgetResponse)
def get_current_budget(db: Session = Depends(get_db)):
    now = datetime.now()
    return get_budget_by_month(now.year, now.month, db)


@router.get("/{year}/{month}", response_model=BudgetResponse)
def get_budget_by_month(year: int, month: int, db: Session = Depends(get_db)):
    """A month's budget. Read-only: an unsaved month is computed, not created."""
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise HTTPException(status_code=422, detail="Year must be 2000-2100 and month 1-12")
    budget = db.query(Budget).filter(Budget.year == year, Budget.month == month).first()
    return _budget_response(db, year, month, budget)


@router.post("", response_model=BudgetResponse, status_code=status.HTTP_201_CREATED)
def create_budget(budget_in: BudgetCreate, db: Session = Depends(get_db)):
    existing = db.query(Budget).filter(Budget.year == budget_in.year, Budget.month == budget_in.month).first()
    if existing:
        raise HTTPException(status_code=400, detail="Budget already exists for this year/month")

    budget = Budget(
        id=budget_id_for(budget_in.year, budget_in.month),
        year=budget_in.year,
        month=budget_in.month,
        total_income_target=budget_in.total_income_target,
        total_expense_target=budget_in.total_expense_target,
        notes=budget_in.notes,
    )

    for item_in in budget_in.items or []:
        budget.items.append(BudgetItem(category_id=item_in.category_id, planned_amount=item_in.planned_amount))

    db.add(budget)
    db.commit()
    db.refresh(budget)
    return populate_budget_actuals(db, budget)


@router.post("/{year}/{month}/items", response_model=BudgetResponse)
def upsert_budget_item(
    year: int,
    month: int,
    item_in: BudgetItemCreate,
    db: Session = Depends(get_db),
):
    """Adds or updates a category budget target for a specific month and marks the category as budgeted."""
    budget = (
        db.query(Budget)
        .options(selectinload(Budget.items))
        .filter(Budget.year == year, Budget.month == month)
        .first()
    )
    if not budget:
        budget = Budget(id=budget_id_for(year, month), year=year, month=month)
        db.add(budget)
        db.flush()

    cat = db.query(Category).filter(Category.id == item_in.category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if not cat.is_budgeted:
        cat.is_budgeted = True

    existing_item = next((it for it in budget.items if it.category_id == item_in.category_id), None)
    if existing_item:
        existing_item.planned_amount = item_in.planned_amount
    else:
        budget.items.append(BudgetItem(category_id=item_in.category_id, planned_amount=item_in.planned_amount))

    db.commit()
    db.refresh(budget)
    return populate_budget_actuals(db, budget)


@router.delete("/{budget_id}/items/{category_id}", response_model=BudgetResponse)
def delete_budget_item(budget_id: str, category_id: str, db: Session = Depends(get_db)):
    """Removes a category from the budget."""
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if not budget:
        ym = _virtual_budget_months().get(budget_id)
        if ym is None:
            raise HTTPException(status_code=404, detail="Budget not found")
        # A month that was never saved has no stored items to remove.
        return _budget_response(db, ym[0], ym[1], None)

    item = db.query(BudgetItem).filter(BudgetItem.budget_id == budget_id, BudgetItem.category_id == category_id).first()
    if item:
        db.delete(item)
        db.commit()
        db.refresh(budget)

    return populate_budget_actuals(db, budget)


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(budget_id: str, budget_in: BudgetUpdate, db: Session = Depends(get_db)):
    budget = _find_budget(db, budget_id, create=True)
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    if budget_in.total_income_target is not None:
        budget.total_income_target = budget_in.total_income_target
    if budget_in.total_expense_target is not None:
        budget.total_expense_target = budget_in.total_expense_target
    if budget_in.notes is not None:
        budget.notes = budget_in.notes

    if budget_in.items is not None:
        existing_items = {it.category_id: it for it in budget.items}
        for item_in in budget_in.items:
            if item_in.category_id in existing_items:
                existing_items[item_in.category_id].planned_amount = item_in.planned_amount
            else:
                budget.items.append(BudgetItem(category_id=item_in.category_id, planned_amount=item_in.planned_amount))

    db.commit()
    db.refresh(budget)
    return populate_budget_actuals(db, budget)
