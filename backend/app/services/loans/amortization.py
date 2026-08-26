from datetime import datetime
from dateutil.relativedelta import relativedelta
from app.core.money import from_cents
from app.models.account import Account, LoanCompounding
from app.schemas.loans import (
    AmortizationScheduleRow,
    AmortizationScheduleResponse,
    LoanSplitSuggestion,
)


def monthly_periodic_rate(annual_rate: float, compounding: LoanCompounding | None = None) -> float:
    """Convert a nominal annual rate into the effective monthly rate.

    Monthly compounding (US convention) is simply APR/12. Canadian fixed-rate
    mortgages are compounded semi-annually, not in advance, so the nominal rate is
    halved to get the semi-annual rate and then converted to its monthly
    equivalent: (1 + APR/2) ** (1/6) - 1.
    """
    if annual_rate <= 0:
        return 0.0
    if compounding == LoanCompounding.SEMI_ANNUAL:
        return (1.0 + (annual_rate / 100.0) / 2.0) ** (1.0 / 6.0) - 1.0
    return (annual_rate / 100.0) / 12.0


def calculate_monthly_payment(
    principal: float,
    annual_rate: float,
    term_months: int,
    compounding: LoanCompounding | None = None,
) -> float:
    """Calculates fixed monthly principal + interest payment using standard amortization formula."""
    if principal <= 0 or term_months <= 0:
        return 0.0
    if annual_rate <= 0:
        return principal / term_months

    r = monthly_periodic_rate(annual_rate, compounding)
    payment = principal * (r * (1 + r) ** term_months) / ((1 + r) ** term_months - 1)
    return round(payment, 2)


def generate_amortization_schedule(account: Account) -> AmortizationScheduleResponse:
    """
    Generates a full month-by-month amortization schedule for a mortgage or vehicle loan.
    """
    # An amortization schedule is a projection over an irrational periodic rate,
    # so the arithmetic is float; the inputs come from exact cents and every row
    # is rounded back to whole cents.
    principal = float(from_cents(
        account.loan_original_principal_cents or account.current_balance_cents or 0
    ))
    annual_rate = account.interest_rate or 0.0
    term_months = account.loan_term_months or 360
    escrow = float(from_cents(account.escrow_payment_cents or 0))

    compounding = account.compounding or LoanCompounding.MONTHLY
    stored_pi = float(from_cents(account.monthly_payment_cents or 0))
    monthly_pi = stored_pi or calculate_monthly_payment(
        principal, annual_rate, term_months, compounding
    )
    monthly_rate = monthly_periodic_rate(annual_rate, compounding)

    start_date = account.loan_origination_date or datetime.now()

    schedule_rows: list[AmortizationScheduleRow] = []
    remaining_balance = principal
    total_interest = 0.0

    for period in range(1, term_months + 1):
        payment_date = start_date + relativedelta(months=period)

        interest_payment = round(remaining_balance * monthly_rate, 2) if monthly_rate > 0 else 0.0
        principal_payment = round(monthly_pi - interest_payment, 2)

        if principal_payment > remaining_balance or period == term_months:
            principal_payment = remaining_balance
            payment_pi = principal_payment + interest_payment
        else:
            payment_pi = monthly_pi

        remaining_balance = max(0.0, round(remaining_balance - principal_payment, 2))
        total_interest += interest_payment

        schedule_rows.append(
            AmortizationScheduleRow(
                period=period,
                payment_date=payment_date.strftime("%Y-%m-%d"),
                payment=payment_pi,
                principal=principal_payment,
                interest=interest_payment,
                escrow=escrow,
                total_payment=payment_pi + escrow,
                remaining_balance=remaining_balance,
            )
        )

        if remaining_balance <= 0:
            break

    payoff_date = (
        schedule_rows[-1].payment_date
        if schedule_rows
        else (start_date + relativedelta(months=term_months)).strftime("%Y-%m-%d")
    )

    return AmortizationScheduleResponse(
        account_id=account.id,
        account_name=account.name,
        original_principal=principal,
        current_balance=float(from_cents(account.current_balance_cents)),
        interest_rate=annual_rate,
        loan_term_months=term_months,
        monthly_payment=monthly_pi,
        escrow_payment=escrow,
        total_interest=round(total_interest, 2),
        total_cost=round(principal + total_interest + (escrow * len(schedule_rows)), 2),
        payoff_date=payoff_date,
        schedule=schedule_rows,
    )


def suggest_loan_split(account: Account, payment_amount: float | None = None) -> LoanSplitSuggestion:
    """
    Given a loan account and payment amount, computes the breakdown:
    Principal + Interest + Escrow.
    """
    annual_rate = account.interest_rate or 0.0
    monthly_rate = monthly_periodic_rate(annual_rate, account.compounding or LoanCompounding.MONTHLY)
    current_balance = float(from_cents(account.current_balance_cents or 0))
    escrow = float(from_cents(account.escrow_payment_cents or 0))

    interest_amount = round(current_balance * monthly_rate, 2)

    total_pmt = payment_amount or float(from_cents(account.monthly_payment_cents or 0))
    principal_amount = max(0.0, round(total_pmt - interest_amount - escrow, 2))

    return LoanSplitSuggestion(
        principal_amount=principal_amount,
        interest_amount=interest_amount,
        escrow_amount=escrow,
    )
