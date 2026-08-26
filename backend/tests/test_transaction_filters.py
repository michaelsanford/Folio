"""Ledger filters the frontend has always sent but the backend never implemented."""
from datetime import datetime

import pytest
import sqlalchemy

from app.models.transaction import Transaction, TransactionSplit


def _txn(db, account, amount, payee, category_id=None):
    txn = Transaction(
        account_id=account.id,
        transaction_date=datetime(2026, 3, 15),
        raw_payee=payee,
        normalized_payee=payee,
        amount=amount,
    )
    txn.splits.append(TransactionSplit(amount=amount, category_id=category_id))
    db.add(txn)
    db.commit()
    return txn


@pytest.fixture
def mixed_ledger(db_session, sample_checking_account):
    groceries = db_session.execute(
        sqlalchemy.text("SELECT id FROM categories WHERE slug='groceries'")
    ).scalar()
    _txn(db_session, sample_checking_account, -25.0, "CATEGORIZED A", groceries)
    _txn(db_session, sample_checking_account, -75.0, "CATEGORIZED B", groceries)
    _txn(db_session, sample_checking_account, -150.0, "UNKNOWN MERCHANT")
    _txn(db_session, sample_checking_account, -300.0, "ANOTHER UNKNOWN")
    return sample_checking_account


def test_uncategorized_filter_returns_only_uncategorized(client, mixed_ledger):
    data = client.get("/api/transactions?is_uncategorized=true").json()
    assert data["total"] == 2
    assert {t["raw_payee"] for t in data["items"]} == {"UNKNOWN MERCHANT", "ANOTHER UNKNOWN"}


def test_categorized_filter_is_the_complement(client, mixed_ledger):
    data = client.get("/api/transactions?is_uncategorized=false").json()
    assert data["total"] == 2
    assert {t["raw_payee"] for t in data["items"]} == {"CATEGORIZED A", "CATEGORIZED B"}


def test_omitting_the_filter_returns_everything(client, mixed_ledger):
    assert client.get("/api/transactions").json()["total"] == 4


def test_amount_range_filter(client, mixed_ledger):
    data = client.get("/api/transactions?min_amount=-100&max_amount=-20").json()
    assert data["total"] == 2
    assert {t["raw_payee"] for t in data["items"]} == {"CATEGORIZED A", "CATEGORIZED B"}
