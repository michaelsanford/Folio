from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.core.money import from_cents
from app.models.budget import Budget, BudgetItem
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit
from app.services.analytics.classification import split_kind_case
from app.schemas.budget import (
    BudgetCreate,
    BudgetUpdate,
    BudgetItemCreate,
    BudgetResponse,
    BudgetItemResponse,
    CashFlowForecastResponse,
)

router = APIRouter(prefix="/budgets", tags=["Budgets"])


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


def populate_budget_actuals(db: Session, budget: Budget) -> BudgetResponse:
    """Calculates actual spending/income for each category in the budget month and syncs all budgeted categories."""
    from app.services.budgeting.rollover_engine import calculate_category_rollover_cents

    start_of_month = datetime(budget.year, budget.month, 1)
    if budget.month == 12:
        end_of_month = datetime(budget.year + 1, 1, 1)
    else:
        end_of_month = datetime(budget.year, budget.month + 1, 1)

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

    # Ensure all budgeted expense categories (and any category with actual spend) exist in the budget items
    existing_cat_ids = {it.category_id for it in budget.items}
    budgeted_categories = (
        db.query(Category)
        .filter(Category.is_budgeted.is_(True), Category.type == CategoryType.EXPENSE)
        .all()
    )

    new_items_added = False
    for cat in budgeted_categories:
        if cat.id not in existing_cat_ids:
            item = BudgetItem(budget_id=budget.id, category_id=cat.id, planned_amount=0.0)
            budget.items.append(item)
            existing_cat_ids.add(cat.id)
            new_items_added = True

    # Also add any uncategorized spend or non-budgeted categories that had actual spend this month
    for cat_id in actuals_by_cat.keys():
        if cat_id not in existing_cat_ids:
            cat = db.query(Category).filter(Category.id == cat_id).first()
            if cat and cat.type == CategoryType.EXPENSE:
                item = BudgetItem(budget_id=budget.id, category_id=cat.id, planned_amount=0.0)
                budget.items.append(item)
                existing_cat_ids.add(cat.id)
                new_items_added = True

    if new_items_added:
        db.commit()
        db.refresh(budget)

    items_resp: list[BudgetItemResponse] = []
    rollover_updated = False
    for item in budget.items:
        actual_cents = actuals_by_cat.get(item.category_id, 0)

        # Calculate rollover from previous month if category.is_rollover is True
        rollover_cents = 0
        if item.category and item.category.is_rollover:
            rollover_cents = calculate_category_rollover_cents(db, item.category, budget.year, budget.month)
            if item.rollover_amount_cents != rollover_cents:
                item.rollover_amount_cents = rollover_cents
                rollover_updated = True

        available_cents = (item.planned_amount_cents or 0) + rollover_cents
        remaining_cents = available_cents - actual_cents
        items_resp.append(
            BudgetItemResponse(
                id=item.id,
                budget_id=item.budget_id,
                category_id=item.category_id,
                planned_amount=float(from_cents(item.planned_amount_cents)),
                rollover_amount=float(from_cents(rollover_cents)),
                available_amount=float(from_cents(available_cents)),
                actual_amount=float(from_cents(actual_cents)),
                remaining_amount=float(from_cents(remaining_cents)),
                category=item.category,
            )
        )

    if rollover_updated:
        db.commit()

    # Sort items by category name for predictable order
    items_resp.sort(key=lambda x: (x.category.name if x.category else ""))

    return BudgetResponse(
        id=budget.id,
        year=budget.year,
        month=budget.month,
        total_income_target=budget.total_income_target,
        total_expense_target=budget.total_expense_target,
        notes=budget.notes,
        created_at=budget.created_at,
        updated_at=budget.updated_at,
        items=items_resp,
        total_actual_income=float(from_cents(income_cents)),
        total_actual_expense=float(from_cents(expense_cents)),
    )


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
    budget = (
        db.query(Budget)
        .options(joinedload(Budget.items).joinedload(BudgetItem.category))
        .filter(Budget.year == now.year, Budget.month == now.month)
        .first()
    )

    if not budget:
        budget = Budget(year=now.year, month=now.month)
        categories = db.query(Category).filter(Category.is_budgeted.is_(True), Category.type == CategoryType.EXPENSE).all()
        for cat in categories:
            budget.items.append(BudgetItem(category_id=cat.id, planned_amount=0.0))
        db.add(budget)
        db.commit()
        db.refresh(budget)

    return populate_budget_actuals(db, budget)


@router.get("/{year}/{month}", response_model=BudgetResponse)
def get_budget_by_month(year: int, month: int, db: Session = Depends(get_db)):
    budget = (
        db.query(Budget)
        .options(joinedload(Budget.items).joinedload(BudgetItem.category))
        .filter(Budget.year == year, Budget.month == month)
        .first()
    )
    if not budget:
        budget = Budget(year=year, month=month)
        categories = db.query(Category).filter(Category.is_budgeted.is_(True), Category.type == CategoryType.EXPENSE).all()
        for cat in categories:
            budget.items.append(BudgetItem(category_id=cat.id, planned_amount=0.0))
        db.add(budget)
        db.commit()
        db.refresh(budget)

    return populate_budget_actuals(db, budget)


@router.post("", response_model=BudgetResponse, status_code=status.HTTP_201_CREATED)
def create_budget(budget_in: BudgetCreate, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    existing = db.query(Budget).filter(Budget.year == budget_in.year, Budget.month == budget_in.month).first()
    if existing:
        raise HTTPException(status_code=400, detail="Budget already exists for this year/month")

    budget = Budget(
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
    sync_db_if_configured()
    return populate_budget_actuals(db, budget)


@router.post("/{year}/{month}/items", response_model=BudgetResponse)
def upsert_budget_item(
    year: int,
    month: int,
    item_in: BudgetItemCreate,
    db: Session = Depends(get_db),
):
    """Adds or updates a category budget target for a specific month and marks the category as budgeted."""
    from app.core.s3_sync import sync_db_if_configured
    budget = (
        db.query(Budget)
        .options(joinedload(Budget.items).joinedload(BudgetItem.category))
        .filter(Budget.year == year, Budget.month == month)
        .first()
    )
    if not budget:
        budget = Budget(year=year, month=month)
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
    sync_db_if_configured()
    return populate_budget_actuals(db, budget)


@router.delete("/{budget_id}/items/{category_id}", response_model=BudgetResponse)
def delete_budget_item(budget_id: str, category_id: str, db: Session = Depends(get_db)):
    """Removes a category from the budget."""
    from app.core.s3_sync import sync_db_if_configured
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    item = db.query(BudgetItem).filter(BudgetItem.budget_id == budget_id, BudgetItem.category_id == category_id).first()
    if item:
        db.delete(item)
        db.commit()
        db.refresh(budget)
        sync_db_if_configured()

    return populate_budget_actuals(db, budget)


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(budget_id: str, budget_in: BudgetUpdate, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
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
    sync_db_if_configured()
    return populate_budget_actuals(db, budget)
