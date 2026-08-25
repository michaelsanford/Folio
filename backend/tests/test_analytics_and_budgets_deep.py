

def test_upsert_budget_item_and_retrieve_envelope(client):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    groceries = next(c for c in categories if c["slug"] == "groceries")

    # Set budget for 2026-08
    create_resp = client.post(
        "/api/budgets",
        json={
            "year": 2026,
            "month": 8,
            "items": [
                {"category_id": groceries["id"], "planned_amount": 650.00}
            ],
        },
    )
    assert create_resp.status_code == 201
    budget = create_resp.json()
    assert budget["year"] == 2026
    assert budget["month"] == 8
    assert len(budget["items"]) >= 1

    item = next(i for i in budget["items"] if i["category_id"] == groceries["id"])
    assert item["planned_amount"] == 650.00


def test_dashboard_analytics_breakdown(client, sample_checking_account, sample_mortgage_account):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    groceries = next(c for c in categories if c["slug"] == "groceries")
    income_cat = next(c for c in categories if c["slug"] == "income")

    # Add Income
    client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-01T12:00:00",
            "raw_payee": "Employer Direct Deposit",
            "amount": 5000.00,
            "splits": [{"category_id": income_cat["id"], "amount": 5000.00}],
        },
    )

    # Add Expense
    client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-05T12:00:00",
            "raw_payee": "Supermarket",
            "amount": -250.00,
            "splits": [{"category_id": groceries["id"], "amount": -250.00}],
        },
    )

    # Fetch Analytics
    anl_resp = client.get("/api/analytics/dashboard")
    assert anl_resp.status_code == 200
    data = anl_resp.json()

    assert "current_net_worth" in data
    assert "total_assets" in data
    assert "total_liabilities" in data
    assert "monthly_cash_flow" in data
    assert "sankey" in data
    assert len(data["sankey"]["nodes"]) > 0
    assert len(data["sankey"]["links"]) > 0
