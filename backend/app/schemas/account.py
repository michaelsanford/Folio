from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator
from app.core.config import settings
from app.models.account import AccountType, AccountVisibility, LoanCompounding


class AccountBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: AccountType
    institution: str | None = Field(None, max_length=100)
    account_number_mask: str | None = Field(None, max_length=20)
    icon: str | None = Field(None, max_length=50)
    color: str | None = Field(None, max_length=20)
    currency: str = Field(settings.DEFAULT_CURRENCY, min_length=3, max_length=3)
    current_balance: float = 0.0
    credit_limit: float | None = None
    interest_rate: float | None = None
    loan_origination_date: datetime | None = None
    loan_term_months: int | None = None
    loan_original_principal: float | None = None
    monthly_payment: float | None = None
    escrow_payment: float | None = None
    minimum_payment_percent: float | None = Field(None, gt=0, le=100)
    compounding: LoanCompounding = LoanCompounding.MONTHLY
    is_active: bool = True


class AccountCreate(AccountBase):
    # Household members who own it. Omitted: the signed-in person's member.
    owner_member_ids: list[str] | None = Field(None, max_length=20)
    visibility: AccountVisibility = AccountVisibility.HOUSEHOLD


class AccountUpdate(BaseModel):
    name: str | None = None
    type: AccountType | None = None
    institution: str | None = None
    account_number_mask: str | None = None
    icon: str | None = None
    color: str | None = None
    currency: str | None = None
    current_balance: float | None = None
    credit_limit: float | None = None
    interest_rate: float | None = None
    loan_origination_date: datetime | None = None
    loan_term_months: int | None = None
    loan_original_principal: float | None = None
    monthly_payment: float | None = None
    escrow_payment: float | None = None
    minimum_payment_percent: float | None = Field(None, gt=0, le=100)
    compounding: LoanCompounding | None = None
    owner_member_ids: list[str] | None = Field(None, max_length=20)
    visibility: AccountVisibility | None = None
    is_active: bool | None = None


class AccountResponse(AccountBase):
    id: str
    created_at: datetime
    updated_at: datetime
    owner_member_ids: list[str] = []
    owner_names: list[str] = []
    visibility: AccountVisibility = AccountVisibility.HOUSEHOLD
    # Someone else's "totals only" account: name, details and rows withheld.
    redacted: bool = False
    # User keys of who added and last changed it (names: bootstrap ``people``).
    created_by: str | None = None
    updated_by: str | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("visibility", mode="before")
    @classmethod
    def _household_when_unset(cls, value):
        return value or AccountVisibility.HOUSEHOLD
