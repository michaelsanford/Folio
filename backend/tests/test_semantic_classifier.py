from app.services.categorization.semantic_classifier import classify_by_semantic_keywords


def test_semantic_keyword_classification():
    # 1. Transportation keywords
    toll_res = classify_by_semantic_keywords("ACH DEBIT EXPRESSWAY TOLL BOOTH #4")
    assert toll_res is not None
    assert toll_res.category_slug == "transportation"
    assert toll_res.confidence >= 0.8

    parking_res = classify_by_semantic_keywords("STATIONNEMENT DOWNTOWN MONTREAL")
    assert parking_res is not None
    assert parking_res.category_slug == "transportation"

    # 2. Health & Medical keywords
    dental_res = classify_by_semantic_keywords("CENTRE DENTAIRE LAVAL")
    assert dental_res is not None
    assert dental_res.category_slug == "health-medical"

    clinic_res = classify_by_semantic_keywords("SANTE MEDICAL CLINIC OTTAWA")
    assert clinic_res is not None
    assert clinic_res.category_slug == "health-medical"

    # 3. Dining & Cafes
    bakery_res = classify_by_semantic_keywords("BOULANGERIE ARTISANALE DU COIN")
    assert bakery_res is not None
    assert bakery_res.category_slug == "restaurants"

    coffee_res = classify_by_semantic_keywords("SPECIALTY ESPRESSO ROASTER NYC")
    assert coffee_res is not None
    assert coffee_res.category_slug == "coffee-shops"

    # 4. Utilities
    hydro_res = classify_by_semantic_keywords("PROVINCIAL ELECTRIC POWER PYMT")
    assert hydro_res is not None
    assert hydro_res.category_slug == "utilities"


def test_multi_tier_evaluation_with_seeds_and_semantic(client):
    """Verifies that explicit rules (Suno, Tidal, A30 Express) take Tier 1 precedence,
    and unknown commercial payees fall back to Tier 2 semantic matching."""
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    cat_map = {c["slug"]: c["id"] for c in categories}

    # 1. Explicit Seed Merchants (Tier 1 - 100% confidence)
    test_tier1 = [
        ("SUNO.AI SUBSCRIPTION RECURRING", cat_map["subscriptions"], "Suno AI"),
        ("TIDAL HIFI MUSIC MONTHLY", cat_map["subscriptions"], "Tidal"),
        ("A30 EXPRESS PEAGE CHATEAUGUAY", cat_map["transportation"], "A30 Express Tolls"),
    ]

    for raw_payee, expected_cat_id, expected_norm in test_tier1:
        res = client.post("/api/rules/test", json={"raw_payee": raw_payee})
        assert res.status_code == 200
        data = res.json()
        assert data["matched"] is True
        assert data["suggested_category_id"] == expected_cat_id
        assert data["suggested_payee"] == expected_norm

    # 2. Semantic Fallback (Tier 2 - 85% confidence for unseeded payees)
    test_tier2 = [
        ("NEW UNKNOWN AUTOROUTE BRIDGE TOLL", cat_map["transportation"]),
        ("UNKNOWN DOWNTOWN PHARMACY STORE", cat_map["health-medical"]),
        ("UNKNOWN COFFEE ROASTERY CORNER", cat_map["coffee-shops"]),
    ]

    for raw_payee, expected_cat_id in test_tier2:
        res = client.post("/api/rules/test", json={"raw_payee": raw_payee})
        assert res.status_code == 200
        data = res.json()
        assert data["matched"] is True
        assert data["suggested_category_id"] == expected_cat_id


def test_adaptive_auto_learning_lifecycle(client, sample_checking_account):
    """Verifies that assigning a category to an unseeded payee in a transaction
    automatically creates a persistent rule that matches future transactions."""
    cat_resp = client.get("/api/categories")
    categories = cat_resp.json()
    custom_cat = next(c for c in categories if c["slug"] == "subscriptions")

    raw_merchant = "MY UNKNOWN NICHE SAAS TOOL XYZ"

    # Step 1: Verify it is currently uncategorized
    test_before = client.post("/api/rules/test", json={"raw_payee": raw_merchant})
    assert test_before.status_code == 200

    # Step 2: Create a transaction and assign the category
    txn_resp = client.post(
        "/api/transactions",
        json={
            "account_id": sample_checking_account.id,
            "transaction_date": "2026-08-20T10:00:00",
            "raw_payee": raw_merchant,
            "normalized_payee": "Niche SaaS Tool",
            "amount": -29.99,
            "splits": [
                {
                    "category_id": custom_cat["id"],
                    "amount": -29.99,
                }
            ],
        },
    )
    assert txn_resp.status_code == 201

    # Step 3: Test again -> now it must match the auto-learned rule!
    test_after = client.post("/api/rules/test", json={"raw_payee": raw_merchant})
    assert test_after.status_code == 200
    data = test_after.json()
    assert data["matched"] is True
    assert data["suggested_category_id"] == custom_cat["id"]
    assert data["suggested_payee"] == "Niche SaaS Tool"
