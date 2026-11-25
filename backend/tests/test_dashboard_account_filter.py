"""Dashboard figures can leave chosen accounts out entirely."""
from datetime import date, datetime

import pytest

from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit
from app.services.snapshots.balance_history import record_snapshot


def _account(db, name, type_, balance):
    account = Account(name=name, type=type_, institution="Test", current_balance=balance)
    db.add(account)
    db.commit()
    db.refresh(account)
    record_snapshot(db, account.id, account.current_balance_cents, date.today())
    db.commit()
    return account


def _txn(db, account, amount, payee):
    now = datetime.now()
    txn = Transaction(
        account_id=account.id,
        transaction_date=datetime(now.year, now.month, 1, 12),
        raw_payee=payee,
        normalized_payee=payee,
        amount=amount,
    )
    txn.splits.append(TransactionSplit(amount=amount))
    db.add(txn)
    db.commit()


@pytest.fixture
def household(db_session):
    chequing = _account(db_session, "Chequing", AccountType.CHECKING, 3000.0)
    card = _account(db_session, "Visa", AccountType.CREDIT_CARD, 800.0)
    _txn(db_session, chequing, 4000.0, "Payroll")
    _txn(db_session, chequing, -1200.0, "Rent")
    _txn(db_session, card, -300.0, "Groceries")
    return chequing, card


def test_unfiltered_dashboard_counts_every_account(client, household):
    data = client.get("/api/analytics/dashboard").json()
    assert data["total_assets"] == pytest.approx(3000.0)
    assert data["total_liabilities"] == pytest.approx(800.0)
    assert data["monthly_cash_flow"]["total_expenses"] == pytest.approx(1500.0)


def test_excluding_an_account_drops_its_balance_history_and_spending(client, household):
    _, card = household
    data = client.get(f"/api/analytics/dashboard?exclude_account_id={card.id}").json()

    assert data["total_liabilities"] == pytest.approx(0.0)
    assert data["current_net_worth"] == pytest.approx(3000.0)
    assert data["net_worth_history"][-1]["net_worth"] == pytest.approx(3000.0)
    assert data["monthly_cash_flow"]["total_income"] == pytest.approx(4000.0)
    assert data["monthly_cash_flow"]["total_expenses"] == pytest.approx(1200.0)


def test_excluding_every_account_leaves_an_empty_dashboard(client, household):
    chequing, card = household
    data = client.get(
        f"/api/analytics/dashboard?exclude_account_id={chequing.id}&exclude_account_id={card.id}"
    ).json()
    assert data["current_net_worth"] == 0
    assert data["net_worth_history"] == []
    assert data["monthly_cash_flow"]["total_income"] == 0
    assert data["sankey"]["links"] == []


def test_bootstrap_applies_the_same_exclusions(client, household):
    _, card = household
    query = f"?exclude_account_id={card.id}"
    boot = client.get(f"/api/bootstrap{query}").json()["analytics"]
    direct = client.get(f"/api/analytics/dashboard{query}").json()
    assert boot == direct
    # Accounts themselves are still all listed; only the analytics are filtered.
    assert len(client.get(f"/api/bootstrap{query}").json()["accounts"]) == 2
