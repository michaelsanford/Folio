"""Liability balances are the positive amount owed, whatever the transaction signs."""
from datetime import datetime, timedelta

import pytest

from app.models.account import Account, AccountType, balance_from_ledger_cents
from app.models.snapshot import AccountBalanceSnapshot
from app.services.snapshots.balance_history import backfill_account_history


@pytest.fixture
def card(db_session):
    account = Account(name="Visa", type=AccountType.CREDIT_CARD, institution="RBC", current_balance=0.0)
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _post(client, account, amount, when="2026-08-20T12:00:00", payee="Shop"):
    resp = client.post("/api/transactions", json={
        "account_id": account.id,
        "transaction_date": when,
        "raw_payee": payee,
        "amount": amount,
        "splits": [{"amount": amount}],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_ledger_sign_rule():
    assert balance_from_ledger_cents(AccountType.CREDIT_CARD, -1250) == 1250
    assert balance_from_ledger_cents(AccountType.MORTGAGE, -100) == 100
    assert balance_from_ledger_cents(AccountType.CHECKING, -100) == -100


def test_a_purchase_raises_what_is_owed_and_a_payment_lowers_it(client, db_session, card):
    _post(client, card, -120.00, payee="Groceries")
    db_session.refresh(card)
    assert float(card.current_balance) == pytest.approx(120.00)

    _post(client, card, 100.00, payee="Payment thank you")
    db_session.refresh(card)
    assert float(card.current_balance) == pytest.approx(20.00)

    # Dashboard figures are unchanged by the convention.
    data = client.get("/api/analytics/dashboard").json()
    assert data["total_liabilities"] == pytest.approx(20.00)
    assert data["current_net_worth"] == pytest.approx(-20.00)


def test_overpaying_a_card_leaves_a_credit(client, db_session, card):
    _post(client, card, 50.00, payee="Payment")
    db_session.refresh(card)
    assert float(card.current_balance) == pytest.approx(-50.00)


def test_backfilled_history_of_a_card_stays_positive(client, db_session, card):
    now = datetime.now()
    _post(client, card, -300.00, when=(now - timedelta(days=45)).isoformat(timespec="seconds"))
    _post(client, card, -200.00, when=(now - timedelta(days=2)).isoformat(timespec="seconds"))
    db_session.refresh(card)
    assert float(card.current_balance) == pytest.approx(500.00)

    backfill_account_history(db_session, card, months=3)
    db_session.commit()
    snaps = (
        db_session.query(AccountBalanceSnapshot)
        .filter(AccountBalanceSnapshot.account_id == card.id)
        .order_by(AccountBalanceSnapshot.as_of_date)
        .all()
    )
    values = [s.balance_cents for s in snaps]
    assert all(v >= 0 for v in values), values
    assert values[-1] == 50000
    # Before both purchases nothing was owed.
    assert values[0] == 0
