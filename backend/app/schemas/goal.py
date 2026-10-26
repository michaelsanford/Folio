from datetime import date, datetime
from pydantic import BaseModel, Field
from app.models.goal import GoalType


class GoalBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    type: GoalType = Field(default=GoalType.SAVINGS)
    target_amount: float = Field(..., gt=0, description="Target amount in dollars")
    current_amount: float | None = Field(default=None, description="Starting / manual current amount in dollars")
    target_date: date | None = None
    emergency_fund_months: int | None = Field(default=None, ge=1, le=36)
    excluded_category_ids: list[str] | None = None
    linked_account_id: str | None = None
    owner_member_id: str | None = None
    notes: str | None = None


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    type: GoalType | None = None
    target_amount: float | None = Field(default=None, gt=0)
    current_amount: float | None = None
    target_date: date | None = None
    emergency_fund_months: int | None = Field(default=None, ge=1, le=36)
    excluded_category_ids: list[str] | None = None
    linked_account_id: str | None = None
    owner_member_id: str | None = None
    notes: str | None = None


class GoalResponse(BaseModel):
    id: str
    name: str
    type: GoalType
    target_amount: float
    current_amount: float | None = None
    effective_current_amount: float
    progress_percentage: float
    target_date: date | None = None
    emergency_fund_months: int | None = None
    excluded_category_ids: list[str] | None = None
    linked_account_id: str | None = None
    owner_member_id: str | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmergencyFundCategoryBreakdown(BaseModel):
    category_id: str
    category_name: str
    category_color: str | None = None
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

    # Frontend compatibility aliases
    months_selected: int = 0
    monthly_average_included_expense: float = 0.0
    suggested_target_amount: float = 0.0
    monthly_average_total_expense: float = 0.0
    category_breakdown: list[EmergencyFundCategoryBreakdown] = []
    excluded_category_ids: list[str] = []


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
    tax_year: int = 2026
    tfsa_annual_limit: float = 7000.0
    fhsa_annual_limit: float = 8000.0
    fhsa_lifetime_limit: float = 40000.0
    tfsa_contributed: float = 0.0
    tfsa_remaining_room: float = 7000.0
    fhsa_contributed: float = 0.0
    fhsa_remaining_room: float = 8000.0
    notes: str = ""
    limits: list[CraLimitInfo] = []
