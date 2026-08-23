import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.category import Category, CategoryType
from app.schemas.category import (
    CategoryCreate,
    CategoryUpdate,
    CategoryResponse,
    CategoryTreeResponse,
)

router = APIRouter(prefix="/categories", tags=["Categories"])

DEFAULT_CATEGORIES = [
    # Income
    {"name": "Income", "slug": "income", "icon": "wallet", "color": "#10B981", "type": CategoryType.INCOME, "children": [
        {"name": "Salary / Paycheck", "slug": "salary", "icon": "briefcase", "color": "#10B981", "type": CategoryType.INCOME},
        {"name": "Investment Dividends", "slug": "investments", "icon": "trending-up", "color": "#10B981", "type": CategoryType.INCOME},
        {"name": "Other Income", "slug": "other-income", "icon": "plus-circle", "color": "#10B981", "type": CategoryType.INCOME},
    ]},
    # Housing & Utilities
    {"name": "Housing", "slug": "housing", "icon": "home", "color": "#6366F1", "type": CategoryType.EXPENSE, "children": [
        {"name": "Mortgage Principal", "slug": "mortgage-principal", "icon": "shield-check", "color": "#6366F1", "type": CategoryType.EXPENSE},
        {"name": "Mortgage Interest", "slug": "mortgage-interest", "icon": "percent", "color": "#EF4444", "type": CategoryType.EXPENSE},
        {"name": "Property Tax & Insurance (Escrow)", "slug": "escrow", "icon": "file-text", "color": "#8B5CF6", "type": CategoryType.EXPENSE},
        {"name": "Utilities (Electric/Water/Gas)", "slug": "utilities", "icon": "zap", "color": "#F59E0B", "type": CategoryType.EXPENSE},
        {"name": "Home Maintenance & Repairs", "slug": "home-maintenance", "icon": "wrench", "color": "#6B7280", "type": CategoryType.EXPENSE},
    ]},
    # Transportation & Auto
    {"name": "Transportation", "slug": "transportation", "icon": "car", "color": "#3B82F6", "type": CategoryType.EXPENSE, "children": [
        {"name": "Vehicle Loan Principal", "slug": "vehicle-loan-principal", "icon": "shield-check", "color": "#3B82F6", "type": CategoryType.EXPENSE},
        {"name": "Vehicle Loan Interest", "slug": "vehicle-loan-interest", "icon": "percent", "color": "#EF4444", "type": CategoryType.EXPENSE},
        {"name": "Gas / Fuel", "slug": "fuel", "icon": "fuel", "color": "#EC4899", "type": CategoryType.EXPENSE},
        {"name": "Auto Insurance", "slug": "auto-insurance", "icon": "shield", "color": "#06B6D4", "type": CategoryType.EXPENSE},
        {"name": "Auto Maintenance & Service", "slug": "auto-maintenance", "icon": "tool", "color": "#64748B", "type": CategoryType.EXPENSE},
    ]},
    # Food & Dining
    {"name": "Food & Dining", "slug": "food-dining", "icon": "utensils", "color": "#F97316", "type": CategoryType.EXPENSE, "children": [
        {"name": "Groceries", "slug": "groceries", "icon": "shopping-bag", "color": "#F97316", "type": CategoryType.EXPENSE},
        {"name": "Restaurants & Takeout", "slug": "restaurants", "icon": "coffee", "color": "#FB923C", "type": CategoryType.EXPENSE},
        {"name": "Coffee Shops", "slug": "coffee-shops", "icon": "coffee", "color": "#D97706", "type": CategoryType.EXPENSE},
    ]},
    # Lifestyle & Personal
    {"name": "Personal & Lifestyle", "slug": "personal", "icon": "user", "color": "#8B5CF6", "type": CategoryType.EXPENSE, "children": [
        {"name": "Shopping & General Merchandise", "slug": "shopping", "icon": "shopping-cart", "color": "#8B5CF6", "type": CategoryType.EXPENSE},
        {"name": "Subscriptions & Streaming", "slug": "subscriptions", "icon": "tv", "color": "#A855F7", "type": CategoryType.EXPENSE},
        {"name": "Health & Medical", "slug": "health-medical", "icon": "activity", "color": "#14B8A6", "type": CategoryType.EXPENSE},
        {"name": "Travel & Vacation", "slug": "travel", "icon": "plane", "color": "#0EA5E9", "type": CategoryType.EXPENSE},
    ]},
    # Transfers
    {"name": "Transfers", "slug": "transfers", "icon": "arrow-left-right", "color": "#64748B", "type": CategoryType.TRANSFER, "children": [
        {"name": "Credit Card Payment", "slug": "cc-payment", "icon": "credit-card", "color": "#64748B", "type": CategoryType.TRANSFER},
        {"name": "Account Transfer", "slug": "internal-transfer", "icon": "repeat", "color": "#64748B", "type": CategoryType.TRANSFER},
    ]},
]


def seed_default_categories(db: Session):
    """Populates default categories if category table is empty."""
    if db.query(Category).count() > 0:
        return

    for parent_def in DEFAULT_CATEGORIES:
        parent = Category(
            name=parent_def["name"],
            slug=parent_def["slug"],
            icon=parent_def["icon"],
            color=parent_def["color"],
            type=parent_def["type"],
            parent_id=None,
        )
        db.add(parent)
        db.flush()

        for child_def in parent_def.get("children", []):
            child = Category(
                name=child_def["name"],
                slug=child_def["slug"],
                icon=child_def["icon"],
                color=child_def["color"],
                type=child_def["type"],
                parent_id=parent.id,
            )
            db.add(child)

    db.commit()


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", cleaned)


@router.get("", response_model=list[CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    seed_default_categories(db)
    return db.query(Category).order_by(Category.sort_order.asc(), Category.name.asc()).all()


@router.get("/tree", response_model=list[CategoryTreeResponse])
def get_category_tree(db: Session = Depends(get_db)):
    seed_default_categories(db)
    all_cats = db.query(Category).all()
    parent_map: dict[str | None, list[Category]] = {}

    for cat in all_cats:
        parent_map.setdefault(cat.parent_id, []).append(cat)

    def build_tree(parent_id: str | None) -> list[CategoryTreeResponse]:
        items: list[CategoryTreeResponse] = []
        for cat in parent_map.get(parent_id, []):
            node = CategoryTreeResponse(
                id=cat.id,
                name=cat.name,
                slug=cat.slug,
                parent_id=cat.parent_id,
                icon=cat.icon,
                color=cat.color,
                type=cat.type,
                is_budgeted=cat.is_budgeted,
                sort_order=cat.sort_order,
                created_at=cat.created_at,
                updated_at=cat.updated_at,
                children=build_tree(cat.id),
            )
            items.append(node)
        return items

    return build_tree(None)


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(cat_in: CategoryCreate, db: Session = Depends(get_db)):
    slug = cat_in.slug or slugify(cat_in.name)
    existing = db.query(Category).filter(Category.slug == slug).first()
    if existing:
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    cat = Category(
        name=cat_in.name,
        slug=slug,
        parent_id=cat_in.parent_id,
        icon=cat_in.icon,
        color=cat_in.color,
        type=cat_in.type,
        is_budgeted=cat_in.is_budgeted,
        sort_order=cat_in.sort_order,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(category_id: str, cat_in: CategoryUpdate, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = cat_in.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(cat, field, val)

    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: str, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    db.delete(cat)
    db.commit()
    return None
