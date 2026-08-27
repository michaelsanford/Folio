from app.services.categorization.normalizer import normalize_payee
from app.models.rule import CategorizationRule, RulePatternType
from app.models.category import Category
from app.services.categorization.rules_engine import evaluate_rules


def test_merchant_normalizer():
    assert normalize_payee("AMZN MKTP US*1A2B3C SEATTLE WA") == "Amazon"
    assert normalize_payee("SQ *BLUE BOTTLE COFFEE #124") == "Blue Bottle Coffee"
    assert normalize_payee("NETFLIX.COM 866-579-7172 CA") == "Netflix"
    assert normalize_payee("TARGET T-0842 BROOKLYN NY") == "Target"
    assert normalize_payee("WHOLEFDS MKT #10293") == "Whole Foods"


def test_rule_matching(db_session, sample_checking_account):
    grocery_cat = db_session.query(Category).filter(Category.slug == "groceries").first()
    assert grocery_cat is not None

    rule = CategorizationRule(
        category_id=grocery_cat.id,
        pattern="TRADER JOE",
        pattern_type=RulePatternType.CONTAINS,
        normalized_payee_override="Trader Joe's",
        priority=1,
    )
    db_session.add(rule)
    db_session.commit()

    match_result = evaluate_rules(
        db=db_session,
        raw_payee="TRADER JOE #543 NEW YORK NY",
        amount=-45.60,
        account_id=sample_checking_account.id,
    )

    assert match_result.matched is True
    assert match_result.category_id == grocery_cat.id
    assert match_result.normalized_payee == "Trader Joe's"
