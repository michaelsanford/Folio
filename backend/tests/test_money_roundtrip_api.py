"""Money must survive the full API round trip exactly.

Storage is integer cents; the HTTP contract stays dollars-as-JSON-numbers. These
tests pin both halves so a future change cannot quietly reintroduce drift or
change the wire format.
"""
from datetime import datetime

import pytest

from app.models.transaction import Transaction


# (submitted, expected). Note -2.675: Python round() gives -2.67 because the float
# is really -2.67499...; half-up on the decimal literal gives -2.68, which is what a
# bank statement would show and what to_cents produces.
AWKWARD_AMOUNTS = [
    (-19.47, -19.47),
    (-0.07, -0.07),
    (0.1, 0.1),
    (1234.56, 1234.56),
    (-2.675, -2.68),
    (9999999.99, 9999999.99),
    (-0.01, -0.01),
]


@pytest.mark.parametrize("amount,expected", AWKWARD_AMOUNTS)
def test_amount_round_trips_through_the_api(client, sample_checking_account, amount, expected):
    created = client.post("/api/transactions", json={
        "account_id": sample_checking_account.id,
        "transaction_date": "2026-03-15T00:00:00",
        "raw_payee": "ROUND TRIP",
        "amount": amount,
    })
    assert created.status_code == 201

    fetched = client.get(f"/api/transactions/{created.json()['id']}").json()
    assert fetched["amount"] == pytest.approx(expected, abs=0.0001)
    assert isinstance(fetched["amount"], (int, float)), "wire format must stay a JSON number"


def test_balance_of_many_awkward_amounts_is_exact(client, db_session, sample_checking_account):
    """A hundred repetitions of 0.07 must total exactly 7.00, not 7.000000000000005."""
    for i in range(100):
        client.post("/api/transactions", json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-03-15T00:00:00",
            "raw_payee": f"SMALL {i}",
            "amount": 0.07,
        })

    db_session.expire_all()
    account = client.get(f"/api/accounts/{sample_checking_account.id}").json()
    assert account["current_balance"] == 7.00

    total_cents = sum(
        t.amount_cents
        for t in db_session.query(Transaction).filter(
            Transaction.account_id == sample_checking_account.id
        )
    )
    assert total_cents == 700, "storage must be exact integer cents"


def test_split_amounts_must_reconcile_to_the_transaction(client, db_session, sample_checking_account):
    import sqlalchemy
    groceries = db_session.execute(
        sqlalchemy.text("SELECT id FROM categories WHERE slug='groceries'")
    ).scalar()
    coffee = db_session.execute(
        sqlalchemy.text("SELECT id FROM categories WHERE slug='coffee-shops'")
    ).scalar()

    created = client.post("/api/transactions", json={
        "account_id": sample_checking_account.id,
        "transaction_date": "2026-03-15T00:00:00",
        "raw_payee": "SPLIT PURCHASE",
        "amount": -100.01,
        "splits": [
            {"category_id": groceries, "amount": -66.67},
            {"category_id": coffee, "amount": -33.34},
        ],
    })
    assert created.status_code == 201

    txn = db_session.query(Transaction).filter(Transaction.id == created.json()["id"]).first()
    assert sum(s.amount_cents for s in txn.splits) == txn.amount_cents == -10001


def test_amounts_are_stored_as_integers_not_reals(db_session, sample_checking_account):
    """Guards against a future model change silently reverting the column type."""
    import sqlalchemy

    txn = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime(2026, 3, 1),
        raw_payee="TYPE CHECK",
        amount=-12.34,
    )
    db_session.add(txn)
    db_session.commit()

    typ = db_session.execute(
        sqlalchemy.text("SELECT typeof(amount_cents) FROM transactions WHERE id = :i"),
        {"i": txn.id},
    ).scalar()
    assert typ == "integer", f"amount_cents stored as {typ}"
