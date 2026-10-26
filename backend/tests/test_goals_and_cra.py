from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.household import HouseholdMember
from app.models.transaction import Transaction, TransactionSplit


def test_goal_crud_and_account_linking(client: TestClient, db_session: Session):
    # Setup HISA savings account with $8,000
    hisa = Account(name="EQ Bank HISA", type=AccountType.HISA, currency="CAD", current_balance_cents=800000)
    db_session.add(hisa)
    db_session.commit()

    # 1. Create Goal linked to HISA
    resp = client.post(
        "/api/goals",
        json={
            "name": "House Down Payment Fund",
            "type": "SAVINGS",
            "target_amount": 20000.0,
            "linked_account_id": hisa.id,
            "target_date": "2027-12-31",
            "notes": "Targeting 5% minimum down payment",
        },
    )
    assert resp.status_code == 201
    goal_id = resp.json()["id"]
    assert resp.json()["target_amount"] == 20000.0
    assert resp.json()["effective_current_amount"] == 8000.0
    assert resp.json()["progress_percentage"] == 40.0  # 8000 / 20000 = 40%

    # 2. List goals
    list_resp = client.get("/api/goals")
    assert list_resp.status_code == 200
    assert any(g["id"] == goal_id for g in list_resp.json())

    # 3. Update goal
    up_resp = client.put(f"/api/goals/{goal_id}", json={"target_amount": 25000.0})
    assert up_resp.status_code == 200
    assert up_resp.json()["target_amount"] == 25000.0
    assert up_resp.json()["progress_percentage"] == 32.0  # 8000 / 25000 = 32%

    # 4. Delete goal
    del_resp = client.delete(f"/api/goals/{goal_id}")
    assert del_resp.status_code == 204


def test_emergency_fund_calculator_with_exclusions(client: TestClient, db_session: Session):
    acc = Account(name="Chequing", type=AccountType.CHECKING, currency="CAD", current_balance_cents=500000)
    rent = Category(name="Rent / Housing", slug="rent-test", type=CategoryType.EXPENSE)
    dining = Category(name="Fine Dining", slug="dining-test", type=CategoryType.EXPENSE)
    db_session.add_all([acc, rent, dining])
    db_session.commit()

    # Create transactions over past 6 months
    # Rent: $2,000/mo * 6 = $12,000
    # Dining: $500/mo * 6 = $3,000
    now = datetime.now()
    for month_offset in range(1, 4):
        txn_date = datetime(now.year, max(1, now.month - month_offset), 5)
        t1 = Transaction(account_id=acc.id, transaction_date=txn_date, raw_payee="Landlord", amount_cents=-200000)
        t1.splits.append(TransactionSplit(category_id=rent.id, amount_cents=-200000))

        t2 = Transaction(account_id=acc.id, transaction_date=txn_date, raw_payee="Restaurant", amount_cents=-50000)
        t2.splits.append(TransactionSplit(category_id=dining.id, amount_cents=-50000))
        db_session.add_all([t1, t2])
    db_session.commit()

    # 1. Calc 6 months including everything
    resp_all = client.get("/api/goals/emergency-fund-calc?months=6&lookback_months=3")
    assert resp_all.status_code == 200
    data_all = resp_all.json()
    assert data_all["months"] == 6
    assert data_all["monthly_fixed_expense"] == 2500.0  # (2000 + 500)
    assert data_all["suggested_target"] == 15000.0  # 2500 * 6

    # 2. Calc 6 months excluding Dining (survival mode)
    resp_excl = client.get(f"/api/goals/emergency-fund-calc?months=6&lookback_months=3&excluded_categories={dining.id}")
    assert resp_excl.status_code == 200
    data_excl = resp_excl.json()
    assert data_excl["monthly_fixed_expense"] == 2000.0  # only rent
    assert data_excl["suggested_target"] == 12000.0  # 2000 * 6


def test_cra_contribution_room_summary(client: TestClient, db_session: Session):
    partner = HouseholdMember(name="Camille Roy", color="#10B981")
    db_session.add(partner)
    db_session.commit()

    tfsa = Account(name="Camille's TFSA", type=AccountType.TFSA, owner_member_id=partner.id, currency="CAD", current_balance_cents=300000)
    db_session.add(tfsa)
    db_session.commit()

    # Deposit $3,000 in TFSA in current year
    curr_year = datetime.now().year
    txn = Transaction(account_id=tfsa.id, transaction_date=datetime(curr_year, 2, 1), raw_payee="Interac Deposit", amount_cents=300000)
    db_session.add(txn)
    db_session.commit()

    resp = client.get(f"/api/goals/cra-limits?year={curr_year}")
    assert resp.status_code == 200
    limits = resp.json()["limits"]
    assert len(limits) >= 1

    tfsa_limit = next(l for l in limits if l["account_type"] == "TFSA" and l["owner_member_id"] == partner.id)
    assert tfsa_limit["year_to_date_contributions"] == 3000.0
    assert tfsa_limit["remaining_annual_room"] == tfsa_limit["annual_limit"] - 3000.0
    assert not tfsa_limit["is_over_limit"]
