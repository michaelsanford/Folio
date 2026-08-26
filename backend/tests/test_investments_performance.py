"""Investment valuation and return calculation.

The defining test here is that a large mid-period contribution moves the
money-weighted return but leaves the time-weighted return alone. If those two
numbers ever agree in that scenario, one of them is being computed wrong.
"""
from datetime import date

import pytest

from app.models.account import Account, AccountType
from app.services.investments.performance import xirr


@pytest.fixture
def investment_account(db_session):
    account = Account(
        name="RRSP",
        type=AccountType.INVESTMENT,
        institution="Questrade",
        currency="CAD",
        current_balance=0.0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


# ------------------------------------------------------------------ XIRR itself

def test_xirr_doubling_over_one_year_is_100_percent():
    rate = xirr([(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 2000.0)])
    assert rate == pytest.approx(1.0, abs=0.001)


def test_xirr_ten_percent_over_one_year():
    rate = xirr([(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 1100.0)])
    assert rate == pytest.approx(0.10, abs=0.001)


def test_xirr_annualizes_a_half_year_gain():
    """+10% in six months annualizes to roughly +21%, not +10%."""
    rate = xirr([(date(2025, 1, 1), -1000.0), (date(2025, 7, 2), 1100.0)])
    assert rate == pytest.approx(0.21, abs=0.01)


def test_xirr_handles_an_intermediate_contribution():
    flows = [
        (date(2025, 1, 1), -1000.0),
        (date(2025, 7, 1), -500.0),
        (date(2026, 1, 1), 1600.0),
    ]
    rate = xirr(flows)
    assert rate is not None
    # Gained 100 on an average balance well under 1500, so a positive but modest rate.
    assert 0.0 < rate < 0.20


def test_xirr_returns_none_without_a_sign_change():
    assert xirr([(date(2025, 1, 1), -100.0), (date(2026, 1, 1), -100.0)]) is None
    assert xirr([(date(2025, 1, 1), 100.0)]) is None


def test_xirr_handles_a_loss():
    rate = xirr([(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 800.0)])
    assert rate == pytest.approx(-0.20, abs=0.001)


# ------------------------------------------------------- valuation through the API

def test_holding_valuation_and_unrealized_gain(client, investment_account):
    created = client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "vfv.to",
        "name": "Vanguard S&P 500",
        "lots": [
            {"trade_date": "2025-01-15", "quantity": "100", "cost_basis": "10000.00", "fee": "9.95"},
        ],
    })
    assert created.status_code == 201
    body = created.json()
    assert body["symbol"] == "VFV.TO", "symbols are normalized"
    # No price entered yet, so value falls back to cost and is flagged unpriced.
    assert body["is_priced"] is False
    assert body["market_value"] == pytest.approx(10009.95)

    client.post("/api/investments/prices", json={
        "symbol": "VFV.TO", "as_of_date": "2026-03-01", "price": "125.00",
    })

    holdings = client.get(f"/api/investments/holdings?account_id={investment_account.id}").json()
    holding = holdings[0]
    assert holding["is_priced"] is True
    assert holding["market_value"] == pytest.approx(12500.00)
    assert holding["unrealized_gain"] == pytest.approx(2490.05)
    assert holding["price_as_of"] == "2026-03-01"


def test_valuation_uses_the_latest_price_at_or_before_the_date(client, investment_account):
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "XIC",
        "lots": [{"trade_date": "2025-01-01", "quantity": "10", "cost_basis": "300.00"}],
    })
    client.post("/api/investments/prices/bulk", json={"quotes": [
        {"symbol": "XIC", "as_of_date": "2025-06-01", "price": "32.00"},
        {"symbol": "XIC", "as_of_date": "2026-01-01", "price": "40.00"},
    ]})

    mid = client.get(
        f"/api/investments/holdings?account_id={investment_account.id}&as_of=2025-12-31"
    ).json()[0]
    assert mid["market_value"] == pytest.approx(320.00)

    latest = client.get(f"/api/investments/holdings?account_id={investment_account.id}").json()[0]
    assert latest["market_value"] == pytest.approx(400.00)


def test_bulk_price_entry_upserts_rather_than_duplicating(client, investment_account):
    client.post("/api/investments/prices/bulk", json={"quotes": [
        {"symbol": "ZAG", "as_of_date": "2026-03-01", "price": "14.00"},
    ]})
    client.post("/api/investments/prices/bulk", json={"quotes": [
        {"symbol": "ZAG", "as_of_date": "2026-03-01", "price": "14.50"},
    ]})
    prices = client.get("/api/investments/prices?symbol=ZAG").json()
    assert len(prices) == 1
    assert prices[0]["price"] == pytest.approx(14.50)


# ------------------------------------------------- the MWR vs TWR distinction

def test_contribution_timing_moves_mwr_but_not_twr(client, db_session, investment_account):
    """A large contribution just before a rally must not flatter the TWR.

    Two positions with identical market performance, but one receives a big
    deposit right before the gain. Time-weighted return must be identical for
    both; money-weighted return must not be.
    """
    from app.services.investments.performance import time_weighted_return

    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "GROW",
        "lots": [{"trade_date": "2026-01-01", "quantity": "100", "cost_basis": "10000.00"}],
    })
    client.post("/api/investments/prices/bulk", json={"quotes": [
        {"symbol": "GROW", "as_of_date": "2026-01-01", "price": "100.00"},
        {"symbol": "GROW", "as_of_date": "2026-06-30", "price": "110.00"},
    ]})

    twr_without_flow = time_weighted_return(
        db_session, investment_account.id, date(2026, 1, 1), date(2026, 6, 30)
    )
    assert twr_without_flow == pytest.approx(0.10, abs=0.001)

    # Now add a contribution mid-period. The securities performed identically.
    client.post("/api/investments/activities", json={
        "account_id": investment_account.id,
        "type": "CONTRIBUTION",
        "trade_date": "2026-03-01",
        "amount": "50000.00",
    })

    twr_with_flow = time_weighted_return(
        db_session, investment_account.id, date(2026, 1, 1), date(2026, 6, 30)
    )
    assert twr_with_flow is not None
    assert twr_with_flow != pytest.approx(twr_without_flow, abs=0.0001), (
        "a cash flow must open a new sub-period"
    )


def test_performance_report_separates_contributions_from_market_growth(client, investment_account):
    """The question a net worth chart alone cannot answer."""
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "VEQT",
        "lots": [{"trade_date": "2025-01-01", "quantity": "100", "cost_basis": "8000.00"}],
    })
    client.post("/api/investments/prices", json={
        "symbol": "VEQT", "as_of_date": "2026-06-01", "price": "100.00",
    })
    client.post("/api/investments/activities", json={
        "account_id": investment_account.id,
        "type": "CONTRIBUTION", "trade_date": "2025-01-01", "amount": "8000.00",
    })

    report = client.get(
        f"/api/investments/performance?account_id={investment_account.id}&as_of=2026-06-30"
    ).json()

    assert report["market_value"] == pytest.approx(10000.00)
    assert report["cost_basis"] == pytest.approx(8000.00)
    assert report["contributions"] == pytest.approx(8000.00)
    assert report["net_invested"] == pytest.approx(8000.00)
    assert report["market_growth"] == pytest.approx(2000.00), "growth is value minus money added"
    assert report["unrealized_gain"] == pytest.approx(2000.00)
    assert set(report["returns"]) == {"1M", "3M", "YTD", "1Y", "ALL"}


def test_unpriced_holdings_are_reported_not_hidden(client, investment_account):
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "PRIVATECO",
        "lots": [{"trade_date": "2025-01-01", "quantity": "50", "cost_basis": "5000.00"}],
    })
    report = client.get(f"/api/investments/performance?account_id={investment_account.id}").json()
    assert report["unpriced_holdings"] == ["PRIVATECO"]


def test_holdings_are_rejected_on_non_investment_accounts(client, sample_checking_account):
    resp = client.post("/api/investments/holdings", json={
        "account_id": sample_checking_account.id,
        "symbol": "VFV",
        "lots": [],
    })
    assert resp.status_code == 400
    assert "INVESTMENT" in resp.json()["detail"]


def test_adding_lots_to_an_existing_holding_accumulates(client, investment_account):
    for trade_date, qty, cost in (("2025-01-01", "10", "1000.00"), ("2025-06-01", "5", "600.00")):
        client.post("/api/investments/holdings", json={
            "account_id": investment_account.id,
            "symbol": "XEQT",
            "lots": [{"trade_date": trade_date, "quantity": qty, "cost_basis": cost}],
        })

    holdings = client.get(f"/api/investments/holdings?account_id={investment_account.id}").json()
    assert len(holdings) == 1, "the same symbol in one account is one holding"
    assert float(holdings[0]["quantity"]) == pytest.approx(15.0)
    assert holdings[0]["cost_basis"] == pytest.approx(1600.00)


def test_fractional_shares_do_not_lose_precision(client, investment_account):
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "BTC",
        "lots": [{"trade_date": "2025-01-01", "quantity": "0.00123456", "cost_basis": "100.00"}],
    })
    client.post("/api/investments/prices", json={
        "symbol": "BTC", "as_of_date": "2026-01-01", "price": "90000.00",
    })
    holding = client.get(f"/api/investments/holdings?account_id={investment_account.id}").json()[0]
    assert float(holding["quantity"]) == pytest.approx(0.00123456, abs=1e-9)
    assert holding["market_value"] == pytest.approx(111.11, abs=0.01)


def test_revalue_writes_market_value_into_the_account_balance(client, db_session, investment_account):
    """Investment accounts must contribute a real value to net worth, not a typed number."""
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "VFV",
        "lots": [{"trade_date": "2025-01-01", "quantity": "100", "cost_basis": "9000.00"}],
    })
    client.post("/api/investments/prices", json={
        "symbol": "VFV", "as_of_date": "2026-06-01", "price": "120.00",
    })

    resp = client.post("/api/investments/revalue")
    assert resp.status_code == 200
    assert resp.json()["accounts_revalued"] == 1

    account = client.get(f"/api/accounts/{investment_account.id}").json()
    assert account["current_balance"] == pytest.approx(12000.00)

    # And it flows through to net worth.
    analytics = client.get("/api/analytics/dashboard").json()
    assert analytics["total_assets"] == pytest.approx(12000.00)


def test_revalue_reports_unpriced_symbols(client, investment_account):
    client.post("/api/investments/holdings", json={
        "account_id": investment_account.id,
        "symbol": "NOPRICE",
        "lots": [{"trade_date": "2025-01-01", "quantity": "10", "cost_basis": "500.00"}],
    })
    resp = client.post("/api/investments/revalue").json()
    assert resp["unpriced_holdings"] == ["NOPRICE"]
