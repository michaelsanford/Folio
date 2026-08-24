from datetime import datetime
from app.models.account import AccountType


def test_create_and_get_transaction(client, sample_checking_account):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    groceries_cat = next(c for c in categories if c["slug"] == "groceries")

    # Create transaction
    resp = client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-20T12:00:00",
            "raw_payee": "Trader Joe's",
            "amount": -85.50,
            "splits": [
                {"category_id": groceries_cat["id"], "amount": -85.50, "memo": "Weekly grocery run"}
            ],
            "notes": "Weekly grocery run",
        },
    )
    assert resp.status_code == 201
    txn = resp.json()
    assert txn["raw_payee"] == "Trader Joe's"
    assert txn["amount"] == -85.50
    assert len(txn["splits"]) == 1
    assert txn["splits"][0]["category"]["name"] == "Groceries"

    # Get by ID
    get_resp = client.get(f"/api/transactions/{txn['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == txn["id"]


def test_update_and_delete_transaction(client, sample_checking_account):
    create_resp = client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-01T10:00:00",
            "raw_payee": "Old Payee",
            "amount": -20.00,
        },
    )
    assert create_resp.status_code == 201
    txn_id = create_resp.json()["id"]

    # Update
    update_resp = client.put(
        f"/api/transactions/{txn_id}",
        json={"raw_payee": "New Payee", "notes": "Updated note"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["raw_payee"] == "New Payee"
    assert update_resp.json()["notes"] == "Updated note"

    # Delete
    del_resp = client.delete(f"/api/transactions/{txn_id}")
    assert del_resp.status_code == 204

    # Verify deleted
    get_resp = client.get(f"/api/transactions/{txn_id}")
    assert get_resp.status_code == 404


def test_transaction_split_flow(client, sample_checking_account):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    groceries = next(c for c in categories if c["slug"] == "groceries")
    dining = next(c for c in categories if c["slug"] == "restaurants")

    # Create $100 expense
    create_resp = client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-15T14:30:00",
            "raw_payee": "Costco Wholesale",
            "amount": -100.00,
        },
    )
    assert create_resp.status_code == 201
    txn_id = create_resp.json()["id"]

    # Update with multi-category split
    split_resp = client.put(
        f"/api/transactions/{txn_id}",
        json={
            "splits": [
                {"category_id": groceries["id"], "amount": -70.00, "memo": "Food"},
                {"category_id": dining["id"], "amount": -30.00, "memo": "Food Court"},
            ]
        },
    )
    assert split_resp.status_code == 200
    split_txn = split_resp.json()
    assert len(split_txn["splits"]) == 2
    assert split_txn["splits"][0]["amount"] == -70.00
    assert split_txn["splits"][1]["amount"] == -30.00


def test_transaction_filters_search_and_pagination(client, sample_checking_account):
    # Seed 5 transactions
    for i in range(1, 6):
        client.post(
            "/api/transactions",
            json={
                "account_id": sample_checking_account.id,
                "transaction_date": f"2026-08-0{i}T09:00:00",
                "raw_payee": f"Merchant {i}",
                "amount": -(10.0 * i),
            },
        )

    # 1. Test pagination: page=1, page_size=2
    page1 = client.get("/api/transactions?page=1&page_size=2")
    assert page1.status_code == 200
    data1 = page1.json()
    assert data1["total"] == 5
    assert len(data1["items"]) == 2
    assert data1["page"] == 1

    # 2. Test search
    search_resp = client.get("/api/transactions?search=Merchant 3")
    assert search_resp.status_code == 200
    assert len(search_resp.json()["items"]) == 1
    assert search_resp.json()["items"][0]["raw_payee"] == "Merchant 3"
