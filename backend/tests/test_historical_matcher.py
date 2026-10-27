from datetime import datetime, timezone
import pytest

from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.historical_matcher import (
    find_historical_category,
    HistoricalMatchResult,
)


def _create_categorized_txn(db, account_id, raw_payee, normalized_payee, category_id, amount=-25.0):
    txn = Transaction(
        account_id=account_id,
        transaction_date=datetime.now(timezone.utc),
        raw_payee=raw_payee,
        normalized_payee=normalized_payee,
        amount=amount,
    )
    db.add(txn)
    db.flush()
    split = TransactionSplit(
        transaction_id=txn.id,
        category_id=category_id,
        amount=amount,
    )
    db.add(split)
    db.commit()
    return txn


def test_empty_history(db_session):
    """Empty transaction history should yield None."""
    result = find_historical_category(db_session, "Unknown Payee")
    assert result is None

    # Empty raw payee string
    assert find_historical_category(db_session, "") is None
    assert find_historical_category(db_session, "   ") is None


def test_single_transaction_match(db_session, sample_checking_account):
    """A single past categorized transaction should match with 85% confidence."""
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert groceries is not None

    _create_categorized_txn(
        db_session,
        sample_checking_account.id,
        raw_payee="WHOLE FOODS MARKET #1042",
        normalized_payee="Whole Foods",
        category_id=groceries.id,
    )

    result = find_historical_category(db_session, "WHOLE FOODS MARKET #1042")
    assert result is not None
    assert isinstance(result, HistoricalMatchResult)
    assert result.matched is True
    assert result.category_id == groceries.id
    assert result.category_name == groceries.name
    assert result.confidence == 0.85
    assert result.match_count == 1
    assert result.total_count == 1
    assert result.reason == "Historical user preference: 1/1 past transactions (100%)"


def test_unanimous_multiple_match(db_session, sample_checking_account):
    """5 unanimous past transactions should yield 98% scaled confidence."""
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert groceries is not None

    for i in range(5):
        _create_categorized_txn(
            db_session,
            sample_checking_account.id,
            raw_payee=f"METRO MONTREAL #{100 + i}",
            normalized_payee="Metro",
            category_id=groceries.id,
        )

    # Search with normalized payee
    result = find_historical_category(db_session, "Metro")
    assert result is not None
    assert result.matched is True
    assert result.category_id == groceries.id
    assert result.confidence == 0.98
    assert result.match_count == 5
    assert result.total_count == 5
    assert result.reason == "Historical user preference: 5/5 past transactions (100%)"

    # Search with a store-variation raw payee
    res_raw = find_historical_category(db_session, "METRO MONTREAL #999")
    assert res_raw is not None
    assert res_raw.category_id == groceries.id


def test_split_match(db_session, sample_checking_account):
    """A 50/50 split across categories should fail default min_confidence (0.80)
    and pass when min_confidence is relaxed."""
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    restaurants = db_session.query(Category).filter(Category.slug == "restaurants").first()
    assert groceries is not None and restaurants is not None

    # 2 transactions as Groceries, 2 transactions as Restaurants
    for _ in range(2):
        _create_categorized_txn(
            db_session,
            sample_checking_account.id,
            raw_payee="COSTCO WHOLESALE #541",
            normalized_payee="Costco",
            category_id=groceries.id,
        )
    for _ in range(2):
        _create_categorized_txn(
            db_session,
            sample_checking_account.id,
            raw_payee="COSTCO WHOLESALE #541",
            normalized_payee="Costco",
            category_id=restaurants.id,
        )

    # Ratio is 2/4 = 50%, below default min_confidence 80%
    result = find_historical_category(db_session, "Costco")
    assert result is None

    # Relax min_confidence to 0.40 -> should return the top category
    relaxed_res = find_historical_category(db_session, "Costco", min_confidence=0.40)
    assert relaxed_res is not None
    assert relaxed_res.matched is True
    assert relaxed_res.match_count == 2
    assert relaxed_res.total_count == 4
    # confidence = 0.90 * (2/4) = 0.45
    assert relaxed_res.confidence == 0.45
    assert relaxed_res.reason == "Historical user preference: 2/4 past transactions (50%)"


def test_fallback_prefix_and_token_overlap(db_session, sample_checking_account):
    """When exact normalized payee is not found, fallback to prefix/token overlap."""
    groceries = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert groceries is not None

    for _ in range(3):
        _create_categorized_txn(
            db_session,
            sample_checking_account.id,
            raw_payee="PROVIGO LE MARCHE MONTREAL",
            normalized_payee="Provigo",
            category_id=groceries.id,
        )

    # "Provigo Express" does not have exact match in DB ("Provigo"),
    # but shares prefix "Prov" and token "Provigo"
    result = find_historical_category(db_session, "Provigo Express")
    assert result is not None
    assert result.matched is True
    assert result.category_id == groceries.id
    assert result.match_count == 3
    assert result.total_count == 3
    # 2 <= total_count <= 4: 0.90 * 1.0 = 0.90
    assert result.confidence == 0.90
