from app.models.account import AccountType


def test_create_and_list_accounts(client):
    response = client.post(
        "/api/accounts",
        json={
            "name": "Sapphire Reserve",
            "type": AccountType.CREDIT_CARD.value,
            "institution": "Chase",
            "account_number_mask": "*4321",
            "credit_limit": 15000.0,
            "current_balance": -450.25,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Sapphire Reserve"
    assert data["type"] == "CREDIT_CARD"
    assert data["credit_limit"] == 15000.0

    list_resp = client.get("/api/accounts")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1


def test_mortgage_amortization_schedule(client, sample_mortgage_account):
    response = client.get(f"/api/accounts/{sample_mortgage_account.id}/amortization")
    assert response.status_code == 200
    data = response.json()
    assert data["account_name"] == "Home Mortgage"
    assert data["loan_term_months"] == 360
    assert data["total_interest"] > 0
    assert len(data["schedule"]) == 360
    assert data["schedule"][0]["period"] == 1
    assert data["schedule"][0]["principal"] > 0
    assert data["schedule"][0]["interest"] > 0
    assert data["schedule"][0]["escrow"] == 450.0


def test_loan_split_suggestion(client, sample_mortgage_account):
    response = client.get(f"/api/accounts/{sample_mortgage_account.id}/suggest-split?payment_amount=2851.87")
    assert response.status_code == 200
    data = response.json()
    # At 6.5% on 350k, monthly interest is 350000 * (0.065 / 12) = 1895.83
    assert round(data["interest_amount"], 2) == 1895.83
    assert data["escrow_amount"] == 450.0
    assert data["principal_amount"] > 0
