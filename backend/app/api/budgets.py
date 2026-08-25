from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models.budget import Budget, BudgetItem
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit
from app.schemas.budget import (
    BudgetCreate,
    BudgetUpdate,
    BudgetItemCreate,
    BudgetResponse,
    BudgetItemResponse,
)

router = APIRouter(prefix="/budgets", tags=["Budgets"])


def populate_budget_actuals(db: Session, budget: Budget) -> BudgetResponse:
    """Calculates actual spending/income for each category in the budget month and syncs all budgeted categories."""
    start_of_month = datetime(budget.year, budget.month, 1)
    if budget.month == 12:
        end_of_month = datetime(budget.year + 1, 1, 1)
    else:
        end_of_month = datetime(budget.year, budget.month + 1, 1)

    splits = (
        db.query(TransactionSplit, Transaction)
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .filter(
            Transaction.transaction_date >= start_of_month,
            Transaction.transaction_date < end_of_month,
        )
        .all()
    )

    actuals_by_cat: dict[str, float] = {}
    total_income = 0.0
    total_expense = 0.0

    for split, trn in splits:
        if split.category_id:
            actuals_by_cat[split.category_id] = actuals_by_cat.get(split.category_id, 0.0) + abs(split.amount)
        if split.amount > 0:
            total_income += abs(split.amount)
        else:
            total_expense += abs(split.amount)

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
    for item in budget.items:
        actual = actuals_by_cat.get(item.category_id, 0.0)
        remaining = round(item.planned_amount - actual, 2)
        items_resp.append(
            BudgetItemResponse(
                id=item.id,
                budget_id=item.budget_id,
                category_id=item.category_id,
                planned_amount=item.planned_amount,
                actual_amount=round(actual, 2),
                remaining_amount=remaining,
                category=item.category,
            )
        )

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
        total_actual_income=round(total_income, 2),
        total_actual_expense=round(total_expense, 2),
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
        # Create empty budget for current month with all budgeted categories
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
        # Automatically initialize budget for requested period
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
        .options(joinedload(Budget.items).joinedload(BudgetItem.category))
        .filter(Budget.year == year, Budget.month == month)
        .first()
    )
    if not budget:
        budget = Budget(year=year, month=month)
        db.add(budget)
        db.flush()

    # Ensure category exists and is marked as is_budgeted
    cat = db.query(Category).filter(Category.id == item_in.category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if not cat.is_budgeted:
        cat.is_budgeted = True

    # Check if item already exists
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
        raise HTTPException(status_code=404, detail="Budget not found")

    item = db.query(BudgetItem).filter(BudgetItem.budget_id == budget_id, BudgetItem.category_id == category_id).first()
    if item:
        db.delete(item)
        db.commit()
        db.refresh(budget)

    return populate_budget_actuals(db, budget)


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(budget_id: str, budget_in: BudgetUpdate, db: Session = Depends(get_db)):
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
        # Update or add items
        existing_items = {it.category_id: it for it in budget.items}
        for item_in in budget_in.items:
            if item_in.category_id in existing_items:
                existing_items[item_in.category_id].planned_amount = item_in.planned_amount
            else:
                budget.items.append(BudgetItem(category_id=item_in.category_id, planned_amount=item_in.planned_amount))

    db.commit()
    db.refresh(budget)
    return populate_budget_actuals(db, budget)
