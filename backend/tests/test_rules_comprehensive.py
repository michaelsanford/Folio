from app.models.rule import RulePatternType


def test_rule_pattern_types_matching(client):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    coffee_cat = next(c for c in categories if c["slug"] == "coffee-shops")
    groceries_cat = next(c for c in categories if c["slug"] == "groceries")
    dining_cat = next(c for c in categories if c["slug"] == "restaurants")

    # 1. Test CONTAINS rule
    client.post(
        "/api/rules",
        json={
            "category_id": coffee_cat["id"],
            "pattern": "STARBUCKS",
            "pattern_type": RulePatternType.CONTAINS.value,
            "priority": 10,
            "normalized_payee_override": "Starbucks Coffee",
        },
    )

    test1 = client.post(
        "/api/rules/test",
        json={"raw_payee": "POS DEBIT STARBUCKS STORE #124 SEATTLE WA", "amount": -5.50},
    )
    assert test1.status_code == 200
    data1 = test1.json()
    assert data1["matched"] is True
    assert data1["suggested_category_id"] == coffee_cat["id"]
    assert data1["suggested_payee"] == "Starbucks Coffee"

    # 2. Test STARTS_WITH rule
    client.post(
        "/api/rules",
        json={
            "category_id": groceries_cat["id"],
            "pattern": "WHOLEFDS",
            "pattern_type": RulePatternType.STARTS_WITH.value,
            "priority": 10,
        },
    )
    test2 = client.post(
        "/api/rules/test",
        json={"raw_payee": "WHOLEFDS SOMA 10243", "amount": -75.00},
    )
    assert test2.status_code == 200
    assert test2.json()["matched"] is True

    # 3. Test REGEX rule
    client.post(
        "/api/rules",
        json={
            "category_id": dining_cat["id"],
            "pattern": r"UBER\s*EATS|DOORDASH",
            "pattern_type": RulePatternType.REGEX.value,
            "priority": 10,
            "normalized_payee_override": "Food Delivery",
        },
    )
    test3 = client.post(
        "/api/rules/test",
        json={"raw_payee": "UBER   EATS PENDING SAN FRANCISCO", "amount": -28.00},
    )
    assert test3.status_code == 200
    assert test3.json()["matched"] is True
    assert test3.json()["suggested_payee"] == "Food Delivery"


def test_rule_priority_resolution(client):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    groceries = next(c for c in categories if c["slug"] == "groceries")
    dining = next(c for c in categories if c["slug"] == "restaurants")

    # Lower priority general rule (Priority 20)
    client.post(
        "/api/rules",
        json={
            "category_id": groceries["id"],
            "pattern": "MARKET",
            "pattern_type": RulePatternType.CONTAINS.value,
            "priority": 20,
        },
    )

    # Higher priority specific rule (Priority 5)
    client.post(
        "/api/rules",
        json={
            "category_id": dining["id"],
            "pattern": "BOSTON MARKET",
            "pattern_type": RulePatternType.CONTAINS.value,
            "priority": 5,
        },
    )

    # Test "BOSTON MARKET" -> should match higher priority rule (Restaurants)
    test_resp = client.post(
        "/api/rules/test",
        json={"raw_payee": "CHECKOUT BOSTON MARKET #32", "amount": -18.50},
    )
    assert test_resp.status_code == 200
    assert test_resp.json()["matched"] is True
    assert test_resp.json()["suggested_category_id"] == dining["id"]


def test_apply_rules_batch(client, sample_checking_account):
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    coffee = next(c for c in categories if c["slug"] == "coffee-shops")

    # Create Rule
    client.post(
        "/api/rules",
        json={
            "category_id": coffee["id"],
            "pattern": "BLUE BOTTLE",
            "pattern_type": RulePatternType.CONTAINS.value,
            "priority": 10,
            "normalized_payee_override": "Blue Bottle Coffee",
        },
    )

    # Create Uncategorized Transaction
    txn_resp = client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-10T12:00:00",
            "raw_payee": "SQ *BLUE BOTTLE COFFEE HAYES",
            "amount": -6.50,
        },
    )
    txn_id = txn_resp.json()["id"]

    # Run Batch Categorization
    batch_resp = client.post("/api/rules/apply-batch")
    assert batch_resp.status_code == 200
    assert batch_resp.json()["applied_count"] >= 1

    # Check updated transaction
    updated_txn = client.get(f"/api/transactions/{txn_id}").json()
    assert updated_txn["normalized_payee"] == "Blue Bottle Coffee"
