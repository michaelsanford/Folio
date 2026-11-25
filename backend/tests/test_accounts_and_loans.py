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



def _create_loc(client, **extra):
    resp = client.post(
        "/api/accounts",
        json={
            "name": "Home Equity Line",
            "type": AccountType.LINE_OF_CREDIT.value,
            "current_balance": -24000.0,
            "interest_rate": 6.0,
            # Stale term-loan fields must be ignored for a revolving line.
            "loan_term_months": 120,
            "loan_original_principal": 50000.0,
            **extra,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_line_of_credit_defaults_to_interest_only(client):
    loc = _create_loc(client)
    assert loc["minimum_payment_percent"] is None

    data = client.get(f"/api/accounts/{loc['id']}/amortization").json()
    assert data["is_revolving"] is True
    assert data["loan_term_months"] is None
    assert data["original_principal"] is None
    assert data["payoff_date"] is None
    # 24,000 at 6% / 12 = 120.00 interest, and interest-only pays exactly that.
    assert data["monthly_payment"] == 120.0
    assert len(data["schedule"]) == 12
    assert all(row["principal"] == 0 for row in data["schedule"])
    assert data["schedule"][-1]["remaining_balance"] == 24000.0


def test_line_of_credit_percentage_minimum(client):
    loc = _create_loc(client, minimum_payment_percent=3.0)
    assert loc["minimum_payment_percent"] == 3.0

    data = client.get(f"/api/accounts/{loc['id']}/amortization").json()
    assert data["minimum_payment_percent"] == 3.0
    # 3% of 24,000 = 720, above the 120 of interest.
    assert data["monthly_payment"] == 720.0
    balances = [row["remaining_balance"] for row in data["schedule"]]
    assert balances == sorted(balances, reverse=True)
    assert balances[-1] < 24000.0


def test_line_of_credit_percentage_never_below_interest(client):
    # 0.25% of the balance is less than a month's interest at 6%.
    loc = _create_loc(client, minimum_payment_percent=0.25)
    data = client.get(f"/api/accounts/{loc['id']}/amortization").json()
    assert data["monthly_payment"] == 120.0


def test_line_of_credit_switch_back_to_interest_only(client):
    loc = _create_loc(client, minimum_payment_percent=3.0)
    resp = client.put(f"/api/accounts/{loc['id']}", json={"minimum_payment_percent": None})
    assert resp.status_code == 200
    assert resp.json()["minimum_payment_percent"] is None


def test_line_of_credit_rejects_out_of_range_percentage(client):
    resp = client.post(
        "/api/accounts",
        json={"name": "Bad LOC", "type": "LINE_OF_CREDIT", "minimum_payment_percent": 150},
    )
    assert resp.status_code == 422


def test_line_of_credit_split_uses_minimum(client):
    loc = _create_loc(client)
    data = client.get(f"/api/accounts/{loc['id']}/suggest-split").json()
    assert data["interest_amount"] == 120.0
    assert data["principal_amount"] == 0.0
