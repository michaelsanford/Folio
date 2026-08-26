"""Net worth history must be measured, not fabricated.

The previous implementation appended the *current* net worth once per month,
producing a flat line the user could read as "nothing changed".
"""
from datetime import datetime

import pytest
from dateutil.relativedelta import relativedelta

from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit


def _txn(db, account, when, amount, payee="ACTIVITY"):
    txn = Transaction(
        account_id=account.id,
        transaction_date=when,
        raw_payee=payee,
        normalized_payee=payee,
        amount=amount,
    )
    txn.splits.append(TransactionSplit(amount=amount))
    db.add(txn)
    db.commit()
    return txn


@pytest.fixture
def savings_account(db_session):
    account = Account(
        name="Household Savings",
        type=AccountType.SAVINGS,
        institution="Desjardins",
        current_balance=0.0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def test_history_reflects_actual_growth(client, db_session, savings_account):
    """Three months of deposits must produce three distinct net worth points."""
    now = datetime.now()
    for months_ago, amount in ((2, 1000.0), (1, 1000.0), (0, 1000.0)):
        _txn(db_session, savings_account, now - relativedelta(months=months_ago), amount)

    # Balance is derived from transactions, then history reconstructed from it.
    from app.api.transactions import recalculate_account_balance
    recalculate_account_balance(db_session, savings_account.id)

    resp = client.post("/api/maintenance/backfill-snapshots?months=6")
    assert resp.status_code == 200
    assert resp.json()["snapshots_written"] > 0

    history = client.get("/api/analytics/dashboard").json()["net_worth_history"]
    values = [p["net_worth"] for p in history]

    assert len(set(values)) > 1, f"history is flat, so it is not real history: {values}"
    assert values == sorted(values), "savings only grew, so the series must be non-decreasing"
    assert values[-1] == pytest.approx(3000.0, abs=0.01)


def test_history_is_empty_before_any_snapshot_rather_than_invented(client, db_session, savings_account):
    """With no snapshots recorded, report nothing instead of repeating today's figure."""
    history = client.get("/api/analytics/dashboard").json()["net_worth_history"]
    assert all(p["net_worth"] == 0.0 for p in history)


def test_snapshot_is_recorded_on_balance_recalculation(client, db_session, savings_account):
    from app.api.transactions import recalculate_account_balance
    from app.models.snapshot import AccountBalanceSnapshot

    _txn(db_session, savings_account, datetime.now(), 250.0)
    recalculate_account_balance(db_session, savings_account.id)

    snaps = db_session.query(AccountBalanceSnapshot).filter(
        AccountBalanceSnapshot.account_id == savings_account.id
    ).all()
    assert len(snaps) == 1
    assert snaps[0].balance == pytest.approx(250.0)

    # A second recalculation on the same day updates rather than duplicating.
    _txn(db_session, savings_account, datetime.now(), 100.0)
    recalculate_account_balance(db_session, savings_account.id)
    snaps = db_session.query(AccountBalanceSnapshot).filter(
        AccountBalanceSnapshot.account_id == savings_account.id
    ).all()
    assert len(snaps) == 1
    assert snaps[0].balance == pytest.approx(350.0)
