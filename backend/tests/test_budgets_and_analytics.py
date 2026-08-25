

def test_budget_creation_and_actuals(client, sample_checking_account):
    # 1. Fetch current budget
    res = client.get("/api/budgets/current")
    assert res.status_code == 200
    budget_data = res.json()
    assert "year" in budget_data
    assert "month" in budget_data
    assert len(budget_data["items"]) > 0

    # 2. Add planned budget amount to first category
    first_item = budget_data["items"][0]
    cat_id = first_item["category_id"]

    update_res = client.put(
        f"/api/budgets/{budget_data['id']}",
        json={
            "total_income_target": 6000.0,
            "total_expense_target": 3500.0,
            "items": [{"category_id": cat_id, "planned_amount": 500.0}],
        },
    )
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data["total_expense_target"] == 3500.0


def test_dashboard_analytics_endpoint(client, sample_checking_account):
    res = client.get("/api/analytics/dashboard")
    assert res.status_code == 200
    data = res.json()
    assert "current_net_worth" in data
    assert "total_assets" in data
    assert "total_liabilities" in data
    assert "monthly_cash_flow" in data
    assert "sankey" in data
    assert "nodes" in data["sankey"]
