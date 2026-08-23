from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models.category import CategoryType


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    parent_id: str | None = None
    icon: str | None = "tag"
    color: str | None = "#6366F1"
    type: CategoryType = CategoryType.EXPENSE
    is_budgeted: bool = True
    sort_order: int = 0


class CategoryCreate(CategoryBase):
    slug: str | None = None  # Auto-generated if not supplied


class CategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    slug: str | None = None
    icon: str | None = None
    color: str | None = None
    type: CategoryType | None = None
    is_budgeted: bool | None = None
    sort_order: int | None = None


class CategoryResponse(CategoryBase):
    id: str
    slug: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CategoryTreeResponse(CategoryResponse):
    children: list["CategoryTreeResponse"] = []
