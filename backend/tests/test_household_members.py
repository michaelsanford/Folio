from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.household import HouseholdMember
from app.models.account import Account, AccountType
from app.models.transaction import Transaction


def test_household_member_crud(client: TestClient):
    # 1. Create
    resp = client.post(
        "/api/household/members",
        json={"name": "Alex Tremblay", "color": "#3B82F6", "avatar_icon": "user", "role": "Partner"},
    )
    assert resp.status_code == 201
    alex_id = resp.json()["id"]
    assert resp.json()["name"] == "Alex Tremblay"
    assert resp.json()["role"] == "Partner"

    # 2. List
    resp = client.get("/api/household/members")
    assert resp.status_code == 200
    members = resp.json()
    assert any(m["id"] == alex_id for m in members)

    # 3. Update
    resp = client.put(f"/api/household/members/{alex_id}", json={"role": "Co-Owner", "notes": "Primary earner"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "Co-Owner"
    assert resp.json()["notes"] == "Primary earner"

    # 4. Get by ID
    resp = client.get(f"/api/household/members/{alex_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == alex_id

    # 5. Delete
    resp = client.delete(f"/api/household/members/{alex_id}")
    assert resp.status_code == 204
    assert client.get(f"/api/household/members/{alex_id}").status_code == 404


def test_account_and_transaction_member_attribution(client: TestClient, db_session: Session):
    # Create member
    member = HouseholdMember(name="Taylor Roy", color="#EC4899", avatar_icon="user-heart", role="Partner")
    db_session.add(member)
    db_session.commit()
    db_session.refresh(member)

    # Create TFSA owned by Taylor
    resp = client.post(
        "/api/accounts",
        json={
            "name": "Taylor's TFSA",
            "type": "TFSA",
            "institution": "Wealthsimple",
            "owner_member_id": member.id,
            "currency": "CAD",
            "current_balance": 15000.0,
        },
    )
    assert resp.status_code == 201
    account_id = resp.json()["id"]
    assert resp.json()["owner_member_id"] == member.id

    # Filter accounts by owner_member_id
    resp = client.get(f"/api/accounts?owner_member_id={member.id}")
    assert resp.status_code == 200
    accs = resp.json()
    assert len(accs) == 1
    assert accs[0]["name"] == "Taylor's TFSA"

    # Create transaction assigned to Taylor
    txn_resp = client.post(
        "/api/transactions",
        json={
            "account_id": account_id,
            "transaction_date": "2026-06-15T12:00:00",
            "raw_payee": "Vanguard ETF Purchase",
            "amount": -500.0,
            "currency": "CAD",
            "assigned_member_id": member.id,
        },
    )
    assert txn_resp.status_code == 201
    assert txn_resp.json()["assigned_member_id"] == member.id

    # Filter transactions by assigned_member_id
    list_resp = client.get(f"/api/transactions?assigned_member_id={member.id}")
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] >= 1
    assert any(t["id"] == txn_resp.json()["id"] for t in list_resp.json()["items"])
