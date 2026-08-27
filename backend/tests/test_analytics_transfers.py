"""Transfers between the household's own accounts must never read as cash flow.

Regression guard for the defect where a TRANSFER category matched neither the
INCOME nor the EXPENSE branch, so classification fell through to the sign of the
amount -- making every credit-card payment an expense on the chequing account and
income on the card.
"""
from datetime import datetime

import pytest

from app.models.account import Account, AccountType
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit


def _category(db, slug: str) -> Category:
    return db.query(Category).filter(Category.slug == slug).first()


def _txn(db, account, date, amount, payee, category=None, transfer_pair_id=None):
    txn = Transaction(
        account_id=account.id,
        transaction_date=date,
        raw_payee=payee,
        normalized_payee=payee,
        amount=amount,
        transfer_transaction_id=transfer_pair_id,
    )
    txn.splits.append(
        TransactionSplit(amount=amount, category_id=category.id if category else None)
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


@pytest.fixture
def credit_card_account(db_session):
    account = Account(
        name="Household Visa",
        type=AccountType.CREDIT_CARD,
        institution="RBC",
        current_balance=-500.0,
        credit_limit=10000.0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@pytest.fixture
def month(db_session):
    now = datetime.now()
    return datetime(now.year, now.month, 15)


def test_credit_card_payment_is_not_income_or_expense(
    client, db_session, sample_checking_account, credit_card_account, month
):
    """The two halves of a card payment must cancel, not double-count."""
    salary = _category(db_session, "salary")
    groceries = _category(db_session, "groceries")
    cc_payment = _category(db_session, "cc-payment")

    _txn(db_session, sample_checking_account, month, 5000.0, "EMPLOYER PAYROLL", salary)
    _txn(db_session, credit_card_account, month, -200.0, "METRO GROCERY", groceries)

    # The payment: money leaves chequing and lands on the card.
    _txn(db_session, sample_checking_account, month, -500.0, "RBC VISA PAYMENT", cc_payment)
    _txn(db_session, credit_card_account, month, 500.0, "PAYMENT THANK YOU", cc_payment)

    flow = client.get("/api/analytics/dashboard").json()["monthly_cash_flow"]

    assert flow["total_income"] == 5000.0, "the card payment must not read as income"
    assert flow["total_expenses"] == 200.0, "the card payment must not read as an expense"
    assert flow["total_transfers"] == 1000.0, "transfer volume is reported, not discarded"
    assert flow["net_savings"] == 4800.0


def test_linked_transfer_pair_excluded_without_a_transfer_category(
    client, db_session, sample_checking_account, credit_card_account, month
):
    """A transaction linked to its opposite half is a transfer even if uncategorized."""
    salary = _category(db_session, "salary")
    _txn(db_session, sample_checking_account, month, 3000.0, "EMPLOYER PAYROLL", salary)

    out = _txn(db_session, sample_checking_account, month, -750.0, "TRANSFER TO SAVINGS")
    back = _txn(db_session, credit_card_account, month, 750.0, "TRANSFER IN", transfer_pair_id=out.id)
    out.transfer_transaction_id = back.id
    db_session.commit()

    flow = client.get("/api/analytics/dashboard").json()["monthly_cash_flow"]

    assert flow["total_income"] == 3000.0
    assert flow["total_expenses"] == 0.0
    assert flow["total_transfers"] == 1500.0


def test_transfers_excluded_from_category_spending_and_sankey(
    client, db_session, sample_checking_account, month
):
    salary = _category(db_session, "salary")
    groceries = _category(db_session, "groceries")
    cc_payment = _category(db_session, "cc-payment")

    _txn(db_session, sample_checking_account, month, 4000.0, "EMPLOYER PAYROLL", salary)
    _txn(db_session, sample_checking_account, month, -300.0, "METRO GROCERY", groceries)
    _txn(db_session, sample_checking_account, month, -900.0, "VISA PAYMENT", cc_payment)

    data = client.get("/api/analytics/dashboard").json()

    spend_names = [c["category_name"] for c in data["category_spending"]]
    assert "Groceries" in spend_names
    assert "Credit Card Payment" not in spend_names

    node_names = [n["name"] for n in data["sankey"]["nodes"]]
    assert "Credit Card Payment" not in node_names


def test_sankey_outflows_sum_to_total_expenses(client, db_session, sample_checking_account, month):
    """With more than five spending categories the remainder must appear as 'Other'."""
    _txn(db_session, sample_checking_account, month, 10000.0, "PAYROLL", _category(db_session, "salary"))

    slugs = ["groceries", "restaurants", "coffee-shops", "fuel", "utilities", "shopping", "travel"]
    for i, slug in enumerate(slugs):
        _txn(db_session, sample_checking_account, month, -(100.0 * (i + 1)), f"MERCHANT {i}", _category(db_session, slug))

    data = client.get("/api/analytics/dashboard").json()
    total_expenses = data["monthly_cash_flow"]["total_expenses"]

    nodes = data["sankey"]["nodes"]
    expenses_idx = next(i for i, n in enumerate(nodes) if n["name"] == "Expenses")
    outflow = sum(link["value"] for link in data["sankey"]["links"] if link["source"] == expenses_idx)

    assert "Other" in [n["name"] for n in nodes]
    assert outflow == pytest.approx(total_expenses, abs=0.01)


def test_refund_reduces_category_spend_rather_than_inflating_it(
    client, db_session, sample_checking_account, month
):
    groceries = _category(db_session, "groceries")
    _txn(db_session, sample_checking_account, month, 2000.0, "PAYROLL", _category(db_session, "salary"))
    _txn(db_session, sample_checking_account, month, -250.0, "METRO GROCERY", groceries)
    _txn(db_session, sample_checking_account, month, 50.0, "METRO GROCERY REFUND", groceries)

    data = client.get("/api/analytics/dashboard").json()

    assert data["monthly_cash_flow"]["total_expenses"] == 200.0
    assert data["monthly_cash_flow"]["total_income"] == 2000.0
    grocery = next(c for c in data["category_spending"] if c["category_name"] == "Groceries")
    assert grocery["amount"] == 200.0


def test_budget_actuals_exclude_transfers(client, db_session, sample_checking_account, month):
    """Budget actuals shared the same defect and must stay fixed too."""
    _txn(db_session, sample_checking_account, month, 4000.0, "PAYROLL", _category(db_session, "salary"))
    _txn(db_session, sample_checking_account, month, -400.0, "METRO GROCERY", _category(db_session, "groceries"))
    _txn(db_session, sample_checking_account, month, -1200.0, "VISA PAYMENT", _category(db_session, "cc-payment"))

    budget = client.get(f"/api/budgets/{month.year}/{month.month}").json()

    assert budget["total_actual_income"] == 4000.0
    assert budget["total_actual_expense"] == 400.0, "the card payment must not count as budgeted spend"

    by_cat = {i["category"]["slug"]: i["actual_amount"] for i in budget["items"] if i.get("category")}
    assert by_cat.get("groceries") == 400.0
    assert by_cat.get("cc-payment", 0.0) == 0.0
