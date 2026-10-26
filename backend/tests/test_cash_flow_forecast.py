from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType, LoanCompounding


def test_cash_flow_forecast_endpoint(client: TestClient, db_session: Session):
    # Setup checking account with $5,000 balance
    checking = Account(
        name="Operating Chequing",
        type=AccountType.CHECKING,
        currency="CAD",
        current_balance_cents=500000,
    )
    # Setup mortgage with monthly payment of $1,800
    mortgage = Account(
        name="Fixed Mortgage",
        type=AccountType.MORTGAGE,
        currency="CAD",
        current_balance_cents=40000000,
        loan_original_principal_cents=45000000,
        interest_rate=4.5,
        monthly_payment_cents=180000,
        loan_term_months=300,
        compounding=LoanCompounding.SEMI_ANNUAL,
        loan_origination_date=datetime.now() - timedelta(days=60),
    )
    db_session.add_all([checking, mortgage])
    db_session.commit()

    resp = client.get("/api/budgets/forecast/cash-flow?days=30&pay_cycle=BI_WEEKLY&pay_amount=2500.0")
    assert resp.status_code == 200
    data = resp.json()

    assert data["days"] == 30
    assert data["starting_balance"] == 5000.0
    assert len(data["points"]) == 31  # day 0 to day 30 inclusive
    assert "lowest_projected_balance" in data
    assert "is_overdraft_risk" in data
    assert not data["is_overdraft_risk"]  # should not be overdraft with $5k and bi-weekly pay
