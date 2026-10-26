from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from app.core.money import from_cents
from app.models.account import Account, AccountType
from app.schemas.budget import CashFlowForecastPoint, CashFlowForecastResponse
from app.services.loans.amortization import generate_amortization_schedule
from app.services.analytics.engine import get_dashboard_analytics


LIQUID_ACCOUNT_TYPES = {
    AccountType.CHECKING,
    AccountType.SAVINGS,
    AccountType.HISA,
    AccountType.CASH,
}

LOAN_ACCOUNT_TYPES = {
    AccountType.MORTGAGE,
    AccountType.VEHICLE_LOAN,
    AccountType.LINE_OF_CREDIT,
    AccountType.STUDENT_LOAN,
    AccountType.PERSONAL_LOAN,
    AccountType.OTHER_LIABILITY,
}


def project_cash_flow(
    db: Session,
    days: int = 60,
    pay_cycle: str = "BI_WEEKLY",  # "BI_WEEKLY", "SEMI_MONTHLY", "MONTHLY"
    pay_amount: float | None = None,
    next_pay_date: date | None = None,
) -> CashFlowForecastResponse:
    """
    Simulates day-by-day cash flow for the household over the requested horizon.
    Factors in Canadian bi-weekly or semi-monthly payroll cycles, scheduled mortgage
    and vehicle loan amortization dates, and recurring envelope outflows.
    """
    today = date.today()
    end_date = today + timedelta(days=days)

    # 1. Starting liquid balance
    liquid_accounts = (
        db.query(Account)
        .filter(Account.is_active.is_(True), Account.type.in_(LIQUID_ACCOUNT_TYPES))
        .all()
    )
    starting_balance_cents = sum(a.current_balance_cents for a in liquid_accounts)
    current_running_balance = float(from_cents(starting_balance_cents))

    # 2. Estimate payroll if not provided
    if pay_amount is None or pay_amount <= 0:
        dashboard = get_dashboard_analytics(db)
        monthly_income = dashboard.monthly_cash_flow.total_income
        if monthly_income > 0:
            if pay_cycle == "BI_WEEKLY":
                pay_amount = round((monthly_income * 12.0) / 26.0, 2)
            elif pay_cycle == "SEMI_MONTHLY":
                pay_amount = round(monthly_income / 2.0, 2)
            else:
                pay_amount = round(monthly_income, 2)
        else:
            pay_amount = 0.0

    # Next pay date default: upcoming Friday or next day
    if next_pay_date is None:
        days_ahead = (4 - today.weekday()) % 7  # 4 = Friday
        if days_ahead == 0:
            days_ahead = 7
        next_pay = today + timedelta(days=days_ahead)
    else:
        next_pay = next_pay_date

    # Build scheduled pay dates
    pay_dates: set[date] = set()
    cursor_pay = next_pay
    while cursor_pay <= end_date:
        if cursor_pay >= today:
            pay_dates.add(cursor_pay)
        if pay_cycle == "BI_WEEKLY":
            cursor_pay += timedelta(days=14)
        elif pay_cycle == "SEMI_MONTHLY":
            # 15th and last day of month
            if cursor_pay.day <= 15:
                # Next is last day of current month
                next_month = cursor_pay.month % 12 + 1
                year_adj = cursor_pay.year + (1 if cursor_pay.month == 12 else 0)
                cursor_pay = date(year_adj, next_month, 1) - timedelta(days=1)
            else:
                # Next is 15th of next month
                next_month = cursor_pay.month % 12 + 1
                year_adj = cursor_pay.year + (1 if cursor_pay.month == 12 else 0)
                cursor_pay = date(year_adj, next_month, 15)
        else:  # MONTHLY
            next_month = cursor_pay.month % 12 + 1
            year_adj = cursor_pay.year + (1 if cursor_pay.month == 12 else 0)
            cursor_pay = date(year_adj, next_month, min(cursor_pay.day, 28))

    # 3. Scheduled loan / mortgage payments
    loans = (
        db.query(Account)
        .filter(Account.is_active.is_(True), Account.type.in_(LOAN_ACCOUNT_TYPES))
        .all()
    )
    scheduled_loan_payments: dict[date, list[tuple[str, float]]] = {}
    for loan in loans:
        try:
            sched_resp = generate_amortization_schedule(loan)
            for row in sched_resp.schedule:
                row_date = datetime.strptime(row.payment_date, "%Y-%m-%d").date()
                if today <= row_date <= end_date:
                    scheduled_loan_payments.setdefault(row_date, []).append(
                        (f"{loan.name} Payment", row.total_payment)
                    )
        except Exception:
            continue

    # 4. Daily baseline non-debt expenses
    dashboard = get_dashboard_analytics(db)
    monthly_expenses = dashboard.monthly_cash_flow.total_expenses
    daily_spend = round(monthly_expenses / 30.0, 2) if monthly_expenses > 0 else 0.0

    # 5. Project day-by-day
    points: list[CashFlowForecastPoint] = []
    lowest_balance = current_running_balance
    lowest_date = today.isoformat()

    for i in range(days + 1):
        current_date = today + timedelta(days=i)
        daily_inflow = 0.0
        daily_outflow = 0.0
        notes: list[str] = []

        if current_date in pay_dates and pay_amount > 0:
            daily_inflow += pay_amount
            notes.append(f"Payroll: +${pay_amount:,.2f}")

        if current_date in scheduled_loan_payments:
            for loan_desc, pmt in scheduled_loan_payments[current_date]:
                daily_outflow += pmt
                notes.append(f"{loan_desc}: -${pmt:,.2f}")

        # Baseline daily living expense
        if daily_spend > 0:
            daily_outflow += daily_spend

        daily_net = round(daily_inflow - daily_outflow, 2)
        current_running_balance = round(current_running_balance + daily_net, 2)

        if current_running_balance < lowest_balance:
            lowest_balance = current_running_balance
            lowest_date = current_date.isoformat()

        points.append(
            CashFlowForecastPoint(
                date=current_date.isoformat(),
                projected_balance=current_running_balance,
                daily_net=daily_net,
                notes=notes,
            )
        )

    starting_dollars = float(from_cents(starting_balance_cents))
    return CashFlowForecastResponse(
        start_date=today.isoformat(),
        end_date=end_date.isoformat(),
        days=days,
        starting_balance=starting_dollars,
        lowest_projected_balance=lowest_balance,
        lowest_balance_date=lowest_date,
        is_overdraft_risk=lowest_balance < 0.0,
        points=points,
    )
