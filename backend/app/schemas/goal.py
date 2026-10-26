from datetime import date, datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models.goal import GoalType


class GoalBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: GoalType = GoalType.SAVINGS
    target_amount: float = Field(..., ge=0)
    current_amount: float | None = None
    target_date: date | None = None
    emergency_fund_months: int | None = Field(6, ge=1, le=36)
    excluded_category_ids: str | None = None
    linked_account_id: str | None = None
    owner_member_id: str | None = None
    notes: str | None = None


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    name: str | None = None
    type: GoalType | None = None
    target_amount: float | None = None
    current_amount: float | None = None
    target_date: date | None = None
    emergency_fund_months: int | None = None
    excluded_category_ids: str | None = None
    linked_account_id: str | None = None
    owner_member_id: str | None = None
    notes: str | None = None


class GoalResponse(GoalBase):
    id: str
    effective_current_amount: float = 0.0
    progress_percentage: float = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmergencyFundCategoryBreakdown(BaseModel):
    category_id: str
    category_name: str
    category_color: str
    total_spent: float
    monthly_average: float
    is_excluded: bool = False


class EmergencyFundCalcRequest(BaseModel):
    months: int = Field(6, ge=1, le=36)
    lookback_months: int = Field(6, ge=1, le=24)
    excluded_category_ids: list[str] = []


class EmergencyFundCalcResponse(BaseModel):
    months: int
    lookback_months: int
    monthly_fixed_expense: float
    suggested_target: float
    total_spent_in_period: float
    categories: list[EmergencyFundCategoryBreakdown] = []


class CraLimitInfo(BaseModel):
    account_type: str
    annual_limit: float
    year_to_date_contributions: float
    remaining_annual_room: float
    is_over_limit: bool
    lifetime_limit: float | None = None
    total_lifetime_contributions: float | None = None
    notes: str
    owner_member_id: str | None = None
    owner_member_name: str | None = None


class CraSummaryResponse(BaseModel):
    year: int
    limits: list[CraLimitInfo] = []
