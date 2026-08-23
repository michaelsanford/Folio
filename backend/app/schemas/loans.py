from pydantic import BaseModel


class AmortizationScheduleRow(BaseModel):
    period: int
    payment_date: str
    payment: float
    principal: float
    interest: float
    escrow: float
    total_payment: float
    remaining_balance: float


class AmortizationScheduleResponse(BaseModel):
    account_id: str
    account_name: str
    original_principal: float
    current_balance: float
    interest_rate: float
    loan_term_months: int
    monthly_payment: float
    escrow_payment: float
    total_interest: float
    total_cost: float
    payoff_date: str
    schedule: list[AmortizationScheduleRow]


class LoanSplitSuggestion(BaseModel):
    principal_amount: float
    interest_amount: float
    escrow_amount: float
    principal_category_id: str | None = None
    interest_category_id: str | None = None
    escrow_category_id: str | None = None
