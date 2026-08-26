"""Canadian mortgages compound semi-annually, not in advance.

Using the US monthly convention (APR/12) on a Canadian mortgage overstates the
periodic rate and therefore the interest, by thousands over a full term.
"""
import pytest

from app.models.account import Account, AccountType, LoanCompounding
from app.services.loans.amortization import calculate_monthly_payment, monthly_periodic_rate


def test_semi_annual_periodic_rate_matches_the_interest_act_conversion():
    # 5% nominal, compounded semi-annually -> (1 + 0.05/2) ** (1/6) - 1
    assert monthly_periodic_rate(5.0, LoanCompounding.SEMI_ANNUAL) == pytest.approx(0.004123915, abs=1e-8)


def test_monthly_periodic_rate_is_unchanged_for_us_loans():
    assert monthly_periodic_rate(6.0, LoanCompounding.MONTHLY) == pytest.approx(0.005)
    assert monthly_periodic_rate(6.0, None) == pytest.approx(0.005)


def test_semi_annual_rate_is_below_the_monthly_equivalent():
    """The whole point: the Canadian convention yields a smaller monthly rate."""
    assert monthly_periodic_rate(5.0, LoanCompounding.SEMI_ANNUAL) < monthly_periodic_rate(5.0, LoanCompounding.MONTHLY)


def test_canadian_payment_matches_published_figure():
    """$500,000 at 5.00% over 25 years amortizes to ~$2,908/month in Canada.

    The US monthly-compounding formula gives ~$2,923 for the same inputs.
    """
    canadian = calculate_monthly_payment(500_000.0, 5.0, 300, LoanCompounding.SEMI_ANNUAL)
    american = calculate_monthly_payment(500_000.0, 5.0, 300, LoanCompounding.MONTHLY)

    assert canadian == pytest.approx(2908.02, abs=1.0)
    assert american == pytest.approx(2922.95, abs=1.0)
    assert canadian < american


def test_schedule_uses_the_account_convention(db_session):
    from app.services.loans.amortization import generate_amortization_schedule

    def build(compounding):
        return Account(
            id=f"acct-{compounding.value}",
            name="Home",
            type=AccountType.MORTGAGE,
            current_balance=500_000.0,
            loan_original_principal=500_000.0,
            interest_rate=5.0,
            loan_term_months=300,
            compounding=compounding,
        )

    ca = generate_amortization_schedule(build(LoanCompounding.SEMI_ANNUAL))
    us = generate_amortization_schedule(build(LoanCompounding.MONTHLY))

    assert ca.total_interest < us.total_interest
    # Over 25 years the convention is worth thousands.
    assert us.total_interest - ca.total_interest > 4000.0


def test_new_mortgage_defaults_to_semi_annual(client):
    resp = client.post("/api/accounts", json={
        "name": "Maison",
        "type": "MORTGAGE",
        "institution": "Desjardins",
        "current_balance": 400000.0,
        "interest_rate": 4.5,
        "loan_term_months": 300,
    })
    assert resp.status_code == 201
    assert resp.json()["compounding"] == "SEMI_ANNUAL"


def test_explicit_monthly_choice_is_respected(client):
    resp = client.post("/api/accounts", json={
        "name": "US Home",
        "type": "MORTGAGE",
        "current_balance": 400000.0,
        "compounding": "MONTHLY",
    })
    assert resp.status_code == 201
    assert resp.json()["compounding"] == "MONTHLY"
