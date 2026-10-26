from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit


def test_budget_category_rollovers(client: TestClient, db_session: Session):
    # 1. Create checking account
    acc = Account(name="Main Chequing", type=AccountType.CHECKING, currency="CAD", current_balance_cents=500000)
    db_session.add(acc)

    # 2. Create rollover category (Dining) and non-rollover category (Utilities)
    dining = Category(name="Dining Out", slug="dining-out-test", type=CategoryType.EXPENSE, is_budgeted=True, is_rollover=True)
    utilities = Category(name="Hydro Power", slug="hydro-power-test", type=CategoryType.EXPENSE, is_budgeted=True, is_rollover=False)
    db_session.add_all([dining, utilities])
    db_session.commit()

    # 3. Create Budget for Month 1 (e.g. 2026/04)
    # Dining: Planned $400
    # Utilities: Planned $150
    client.post(
        "/api/budgets/2026/4/items",
        json={"category_id": dining.id, "planned_amount": 400.0},
    )
    client.post(
        "/api/budgets/2026/4/items",
        json={"category_id": utilities.id, "planned_amount": 150.0},
    )

    # Incur expenses in Month 1:
    # Dining: spend $300 (under budget by $100)
    txn1 = Transaction(
        account_id=acc.id,
        transaction_date=datetime(2026, 4, 10, 12, 0),
        raw_payee="Le Bistro",
        amount_cents=-30000,
        currency="CAD",
    )
    txn1.splits.append(TransactionSplit(category_id=dining.id, amount_cents=-30000))

    # Utilities: spend $100 (under budget by $50, but non-rollover)
    txn2 = Transaction(
        account_id=acc.id,
        transaction_date=datetime(2026, 4, 15, 12, 0),
        raw_payee="Hydro",
        amount_cents=-10000,
        currency="CAD",
    )
    txn2.splits.append(TransactionSplit(category_id=utilities.id, amount_cents=-10000))
    db_session.add_all([txn1, txn2])
    db_session.commit()

    # Verify Month 1 budget numbers
    resp1 = client.get("/api/budgets/2026/4")
    assert resp1.status_code == 200
    items_m1 = {it["category_id"]: it for it in resp1.json()["items"]}
    assert items_m1[dining.id]["actual_amount"] == 300.0
    assert items_m1[dining.id]["remaining_amount"] == 100.0
    assert items_m1[dining.id]["rollover_amount"] == 0.0

    # 4. Now create Budget for Month 2 (2026/05)
    # Dining planned: $400
    # Utilities planned: $150
    client.post(
        "/api/budgets/2026/5/items",
        json={"category_id": dining.id, "planned_amount": 400.0},
    )
    client.post(
        "/api/budgets/2026/5/items",
        json={"category_id": utilities.id, "planned_amount": 150.0},
    )

    resp2 = client.get("/api/budgets/2026/5")
    assert resp2.status_code == 200
    items_m2 = {it["category_id"]: it for it in resp2.json()["items"]}

    # Dining is rollover: +$100 should roll over!
    # Available = $400 planned + $100 rollover = $500.0
    assert items_m2[dining.id]["rollover_amount"] == 100.0
    assert items_m2[dining.id]["available_amount"] == 500.0
    assert items_m2[dining.id]["actual_amount"] == 0.0
    assert items_m2[dining.id]["remaining_amount"] == 500.0

    # Utilities is NOT rollover: rollover should be 0.0
    assert items_m2[utilities.id]["rollover_amount"] == 0.0
    assert items_m2[utilities.id]["available_amount"] == 150.0
    assert items_m2[utilities.id]["remaining_amount"] == 150.0
