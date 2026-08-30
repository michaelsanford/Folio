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


def test_create_canadian_registered_accounts(client):
    # Test TFSA creation with custom glyph and color
    tfsa_resp = client.post(
        "/api/accounts",
        json={
            "name": "Wealthsimple TFSA",
            "type": AccountType.TFSA.value,
            "institution": "Wealthsimple",
            "icon": "sparkles",
            "color": "#10B981",
            "current_balance": 45000.0,
        },
    )
    assert tfsa_resp.status_code == 201
    tfsa = tfsa_resp.json()
    assert tfsa["type"] == "TFSA"
    assert tfsa["icon"] == "sparkles"
    assert tfsa["color"] == "#10B981"
    assert tfsa["current_balance"] == 45000.0

    # Test FHSA creation
    fhsa_resp = client.post(
        "/api/accounts",
        json={
            "name": "Questrade FHSA",
            "type": AccountType.FHSA.value,
            "institution": "Questrade",
            "icon": "home",
            "color": "#6366F1",
            "current_balance": 16000.0,
        },
    )
    assert fhsa_resp.status_code == 201
    assert fhsa_resp.json()["type"] == "FHSA"


def test_student_loan_amortization(client):
    loan_resp = client.post(
        "/api/accounts",
        json={
            "name": "Canada Student Loan",
            "type": AccountType.STUDENT_LOAN.value,
            "institution": "NSLSC",
            "icon": "book-open",
            "color": "#8B5CF6",
            "loan_original_principal": 25000.0,
            "current_balance": -20000.0,
            "interest_rate": 0.0,
            "loan_term_months": 120,
            "monthly_payment": 208.33,
        },
    )
    assert loan_resp.status_code == 201
    loan_id = loan_resp.json()["id"]

    amort_resp = client.get(f"/api/accounts/{loan_id}/amortization")
    assert amort_resp.status_code == 200
    schedule = amort_resp.json()
    assert schedule["account_name"] == "Canada Student Loan"
    assert len(schedule["schedule"]) == 120

