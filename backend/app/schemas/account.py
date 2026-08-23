from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models.account import AccountType


class AccountBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: AccountType
    institution: str | None = Field(None, max_length=100)
    account_number_mask: str | None = Field(None, max_length=20)
    currency: str = Field("USD", min_length=3, max_length=3)
    current_balance: float = 0.0
    credit_limit: float | None = None
    interest_rate: float | None = None
    loan_origination_date: datetime | None = None
    loan_term_months: int | None = None
    loan_original_principal: float | None = None
    monthly_payment: float | None = None
    escrow_payment: float | None = None
    is_active: bool = True


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    name: str | None = None
    type: AccountType | None = None
    institution: str | None = None
    account_number_mask: str | None = None
    currency: str | None = None
    current_balance: float | None = None
    credit_limit: float | None = None
    interest_rate: float | None = None
    loan_origination_date: datetime | None = None
    loan_term_months: int | None = None
    loan_original_principal: float | None = None
    monthly_payment: float | None = None
    escrow_payment: float | None = None
    is_active: bool | None = None


class AccountResponse(AccountBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
