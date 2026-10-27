from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import settings
from app.models.account import Account, AccountType
from app.models.category import Category
from app.models.rule import CategorizationRule, RulePatternType
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.bedrock_classifier import BedrockClassificationResult
from app.services.categorization.engine import (
    ClassificationEngine,
    ClassificationTier,
)


def test_cascade_tier_1_explicit_rule(db_session, sample_checking_account):
    cat = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert cat is not None

    rule = CategorizationRule(
        category_id=cat.id,
        pattern="SUPER C",
        pattern_type=RulePatternType.CONTAINS,
        normalized_payee_override="Super C Supermarché",
        priority=1,
    )
    db_session.add(rule)
    db_session.commit()

    result = ClassificationEngine.classify_transaction(
        db=db_session,
        raw_payee="SUPER C #1234 MONTREAL",
        amount=-75.50,
        account_id=sample_checking_account.id,
    )

    assert result.matched is True
    assert result.tier == ClassificationTier.EXPLICIT_RULE
    assert result.confidence == 1.0
    assert result.category_id == cat.id
    assert result.category_name == cat.name
    assert result.normalized_payee == "Super C Supermarché"
    assert result.rule_id == rule.id


def test_cascade_tier_2_user_history(db_session, sample_checking_account):
    """
    When no explicit rule exists, but historical transactions exist for this merchant,
    Tier 2 should classify using historical user behavior.
    """
    fuel_cat = db_session.query(Category).filter(Category.slug == "fuel").first()
    assert fuel_cat is not None

    # Insert historical transactions for "LOCAL INDEPENDENT PUMP" categorized as "fuel"
    for _ in range(3):
        txn = Transaction(
            account_id=sample_checking_account.id,
            transaction_date=datetime.now(timezone.utc),
            raw_payee="LOCAL INDEPENDENT PUMP 9988",
            normalized_payee="Local Independent Pump",
            amount_cents=5000,
        )
        db_session.add(txn)
        db_session.flush()

        split = TransactionSplit(
            transaction_id=txn.id,
            category_id=fuel_cat.id,
            amount_cents=5000,
        )
        db_session.add(split)

    db_session.commit()

    result = ClassificationEngine.classify_transaction(
        db=db_session,
        raw_payee="LOCAL INDEPENDENT PUMP 9988",
        amount=-50.0,
        account_id=sample_checking_account.id,
    )

    assert result.matched is True
    assert result.tier == ClassificationTier.USER_HISTORY
    assert result.confidence >= 0.80
    assert result.category_id == fuel_cat.id
    assert result.category_name == fuel_cat.name


def test_cascade_tier_3_semantic_heuristics(db_session, sample_checking_account):
    """
    When no explicit rule or user history exists, semantic heuristics should
    classify known keyword patterns or flow types.
    """
    # 1. Commercial keyword taxonomy match
    result = ClassificationEngine.classify_transaction(
        db=db_session,
        raw_payee="JEAN COUTU PHARMACIE 123",
        amount=-24.99,
        account_id=sample_checking_account.id,
    )

    assert result.matched is True
    assert result.tier == ClassificationTier.HEURISTIC
    assert result.confidence == 0.85
    health_cat = db_session.query(Category).filter(Category.slug == "health-medical").first()
    assert result.category_id == health_cat.id

    # 2. Financial flow heuristic: Positive amount payroll
    salary_result = ClassificationEngine.classify_transaction(
        db=db_session,
        raw_payee="BIG TECH CORP PAYROLL DIR DEP",
        amount=3450.00,
        account_id=sample_checking_account.id,
    )

    assert salary_result.matched is True
    assert salary_result.tier == ClassificationTier.HEURISTIC
    assert salary_result.confidence >= 0.90
    salary_cat = db_session.query(Category).filter(Category.slug == "salary").first()
    assert salary_result.category_id == salary_cat.id


def test_cascade_tier_4_bedrock_ai_and_auto_learning(db_session, sample_checking_account, monkeypatch):
    """
    When Tiers 1-3 fail, and enable_bedrock is True, Bedrock is called.
    The result must map to a Category, auto-learn into a local rule, and return BEDROCK_AI.
    A subsequent evaluation for the same merchant must immediately hit Tier 1.
    """
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    niche_merchant = "XYZZY OMEGA UNIQUE BAZAAR 9988"
    gym_cat = db_session.query(Category).filter(Category.slug == "health-medical").first()

    mock_bedrock_results = [
        BedrockClassificationResult(
            category_slug="health-medical",
            confidence=0.91,
            reasoning="Merchant is a specialized wellness clinic",
            normalized_payee="Xyzzy Omega",
        )
    ]

    with patch(
        "app.services.categorization.engine.classify_with_bedrock",
        return_value=mock_bedrock_results,
    ) as mock_bedrock:
        result = ClassificationEngine.classify_transaction(
            db=db_session,
            raw_payee=niche_merchant,
            amount=-65.0,
            account_id=sample_checking_account.id,
            enable_bedrock=True,
        )

        assert mock_bedrock.called
        assert result.matched is True
        assert result.tier == ClassificationTier.BEDROCK_AI
        assert result.confidence == 0.91
        assert result.category_id == gym_cat.id
        assert result.normalized_payee == "Xyzzy Omega"
        assert result.rule_id is not None

    # Verify auto-learned rule exists in the database
    learned_rule = (
        db_session.query(CategorizationRule)
        .filter(CategorizationRule.id == result.rule_id)
        .first()
    )
    assert learned_rule is not None
    assert learned_rule.category_id == gym_cat.id

    # Second execution: Must hit Tier 1 (EXPLICIT_RULE) with zero Bedrock calls!
    with patch("app.services.categorization.engine.classify_with_bedrock") as mock_bedrock_second:
        second_result = ClassificationEngine.classify_transaction(
            db=db_session,
            raw_payee=niche_merchant,
            amount=-65.0,
            account_id=sample_checking_account.id,
            enable_bedrock=True,
        )

        mock_bedrock_second.assert_not_called()
        assert second_result.matched is True
        assert second_result.tier == ClassificationTier.EXPLICIT_RULE
        assert second_result.confidence == 1.0
        assert second_result.category_id == gym_cat.id
        assert second_result.rule_id == learned_rule.id


def test_cascade_fallback_unclassified(db_session, sample_checking_account):
    """When all tiers fail, returns UNCLASSIFIED."""
    result = ClassificationEngine.classify_transaction(
        db=db_session,
        raw_payee="XYZ789 UNKNOWN COMPLETELY NONSENSE 0001",
        amount=-12.34,
        account_id=sample_checking_account.id,
        enable_bedrock=False,
    )

    assert result.matched is False
    assert result.tier == ClassificationTier.UNCLASSIFIED
    assert result.confidence == 0.0
    assert result.category_id is None


def test_classify_batch_optimization(db_session, sample_checking_account, monkeypatch):
    """
    Tests batch classification:
    - Pre-evaluates Tiers 1-3 locally.
    - Sends only the remaining items to Bedrock in a single batched call.
    - Preserves input transaction order.
    """
    monkeypatch.setattr(settings, "FOLIO_BEDROCK_ENABLED", True)

    groceries_cat = db_session.query(Category).filter(Category.slug == "groceries").first()
    sub_cat = db_session.query(Category).filter(Category.slug == "subscriptions").first()

    # Rule for Tier 1
    rule = CategorizationRule(
        category_id=groceries_cat.id,
        pattern="PROVIGO",
        pattern_type=RulePatternType.CONTAINS,
        normalized_payee_override="Provigo Supermarché",
        priority=1,
    )
    db_session.add(rule)
    db_session.commit()

    items = [
        {"raw_payee": "PROVIGO #5422", "amount": -80.0},                  # Matches Tier 1
        {"raw_payee": "ACME ENTERPRISE PAYROLL", "amount": 2500.0},       # Matches Tier 3 (Heuristic)
        {"raw_payee": "STRANGE UNSEEN SAAS 101", "amount": -15.0},        # Goes to Tier 4 (Bedrock)
        {"raw_payee": "ANOTHER ODD TOOL 202", "amount": -25.0},           # Goes to Tier 4 (Bedrock)
    ]

    mock_bedrock_results = [
        BedrockClassificationResult(
            category_slug="subscriptions",
            confidence=0.88,
            reasoning="Online SaaS service subscription",
            normalized_payee="Strange Unseen SaaS",
        ),
        BedrockClassificationResult(
            category_slug="subscriptions",
            confidence=0.85,
            reasoning="Digital tool service",
            normalized_payee="Another Odd Tool",
        ),
    ]

    with patch(
        "app.services.categorization.engine.classify_with_bedrock",
        return_value=mock_bedrock_results,
    ) as mock_bedrock:
        results = ClassificationEngine.classify_batch(
            db=db_session,
            items=items,
            enable_bedrock=True,
        )

        assert len(results) == 4
        # Verify Bedrock was called with only the 2 unmatched items
        assert mock_bedrock.call_count == 1
        call_txns = mock_bedrock.call_args[0][0]
        assert len(call_txns) == 2
        assert call_txns[0]["raw_payee"] == "STRANGE UNSEEN SAAS 101"
        assert call_txns[1]["raw_payee"] == "ANOTHER ODD TOOL 202"

        # Item 0: Tier 1
        assert results[0].tier == ClassificationTier.EXPLICIT_RULE
        assert results[0].category_id == groceries_cat.id

        # Item 1: Tier 3
        assert results[1].tier == ClassificationTier.HEURISTIC
        assert results[1].category_name == "Salary / Paycheck"

        # Item 2: Tier 4 Bedrock
        assert results[2].tier == ClassificationTier.BEDROCK_AI
        assert results[2].category_id == sub_cat.id
        assert results[2].normalized_payee == "Strange Unseen SaaS"

        # Item 3: Tier 4 Bedrock
        assert results[3].tier == ClassificationTier.BEDROCK_AI
        assert results[3].category_id == sub_cat.id
        assert results[3].normalized_payee == "Another Odd Tool"


def test_api_evaluate_endpoint(client, sample_checking_account):
    resp = client.post(
        "/api/classification/evaluate",
        json={
            "raw_payee": "TIM HORTONS #4432",
            "amount": -3.50,
            "account_id": sample_checking_account.id,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["matched"] is True
    assert data["category_name"] == "Coffee Shops"
    assert data["tier"] == "HEURISTIC"


def test_api_batch_evaluate_endpoint(client, sample_checking_account):
    resp = client.post(
        "/api/classification/batch-evaluate",
        json={
            "transactions": [
                {"raw_payee": "STARBUCKS #111", "amount": -6.25},
                {"raw_payee": "COMPLETELY UNKNOWN MYSTERY STORE 999", "amount": -10.00},
            ],
            "enable_bedrock": False,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert data["matched_count"] == 1
    assert data["tier_counts"]["HEURISTIC"] == 1
    assert data["tier_counts"]["UNCLASSIFIED"] == 1


def test_api_auto_classify_uncategorized(client, db_session, sample_checking_account):
    # Create uncategorized transactions
    t1 = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee="STARBUCKS #999",
        amount_cents=-550,
    )
    t2 = Transaction(
        account_id=sample_checking_account.id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee="UNKNOWN RANDOM BAZAAR 88",
        amount_cents=-1500,
    )
    db_session.add_all([t1, t2])
    db_session.commit()

    # Dry run
    dry_resp = client.post(
        "/api/classification/auto-classify-uncategorized",
        json={"dry_run": True, "threshold": 0.70},
    )
    assert dry_resp.status_code == 200
    dry_data = dry_resp.json()
    assert dry_data["total_uncategorized"] == 2
    assert dry_data["classified_count"] == 1
    assert dry_data["dry_run"] is True

    # Real execution
    real_resp = client.post(
        "/api/classification/auto-classify-uncategorized",
        json={"dry_run": False, "threshold": 0.70},
    )
    assert real_resp.status_code == 200
    real_data = real_resp.json()
    assert real_data["classified_count"] == 1

    # Verify t1 is now categorized in the database
    db_session.refresh(t1)
    assert t1.splits is not None
    assert len(t1.splits) > 0
    assert t1.splits[0].category_id is not None
    coffee_cat = db_session.query(Category).filter(Category.slug == "coffee-shops").first()
    assert t1.splits[0].category_id == coffee_cat.id


def test_api_status_endpoint(client):
    resp = client.get("/api/classification/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "bedrock_enabled" in data
    assert "bedrock_model_id" in data
    assert "bedrock_region" in data
    assert "total_rules" in data
    assert "historical_learned_count" in data
