from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.category import CategoryResponse


class BudgetItemBase(BaseModel):
    category_id: str
    planned_amount: float = 0.0


class BudgetItemCreate(BudgetItemBase):
    pass


class BudgetItemUpdate(BaseModel):
    planned_amount: float


class BudgetItemResponse(BudgetItemBase):
    id: str
    budget_id: str
    actual_amount: float = 0.0
    remaining_amount: float = 0.0
    category: CategoryResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class BudgetBase(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    total_income_target: float = 0.0
    total_expense_target: float = 0.0
    notes: str | None = None


class BudgetCreate(BudgetBase):
    items: list[BudgetItemCreate] | None = None


class BudgetUpdate(BaseModel):
    total_income_target: float | None = None
    total_expense_target: float | None = None
    notes: str | None = None
    items: list[BudgetItemCreate] | None = None


class BudgetResponse(BudgetBase):
    id: str
    created_at: datetime
    updated_at: datetime
    items: list[BudgetItemResponse] = []
    total_actual_income: float = 0.0
    total_actual_expense: float = 0.0

    model_config = ConfigDict(from_attributes=True)
