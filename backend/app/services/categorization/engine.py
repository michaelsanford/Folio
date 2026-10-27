import enum
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.rules import auto_learn_rule
from app.core.config import settings
from app.models.category import Category
from app.models.rule import CategorizationRule
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.bedrock_classifier import classify_with_bedrock
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.rules_engine import evaluate_rules
from app.services.categorization.semantic_classifier import classify_by_semantic_heuristics

try:
    from app.services.categorization.historical_matcher import find_historical_category
except ImportError:
    find_historical_category = None

logger = logging.getLogger("folio.classification")


class ClassificationTier(str, enum.Enum):
    EXPLICIT_RULE = "EXPLICIT_RULE"
    USER_HISTORY = "USER_HISTORY"
    HEURISTIC = "HEURISTIC"
    BEDROCK_AI = "BEDROCK_AI"
    UNCLASSIFIED = "UNCLASSIFIED"


@dataclass
class ClassificationResult:
    matched: bool
    category_id: str | None
    category_name: str | None
    category_color: str | None
    normalized_payee: str
    confidence: float
    tier: ClassificationTier
    reason: str
    rule_id: str | None = None


SLUG_SYNONYMS: dict[str, str] = {
    "income-salary": "salary",
    "fast-food": "restaurants",
    "alcohol-bars": "restaurants",
    "personal-care": "personal",
    "electronics": "shopping",
    "home-improvement": "home-maintenance",
    "entertainment": "personal",
    "pets": "personal",
    "childcare": "personal",
    "education": "personal",
    "insurance": "personal",
    "bank-fees": "personal",
}


def lookup_category_by_slug(db: Session, slug: str) -> Category | None:
    """Finds Category in DB matching exact slug or mapped synonym."""
    cat = db.query(Category).filter(Category.slug == slug).first()
    if cat:
        return cat

    mapped = SLUG_SYNONYMS.get(slug)
    if mapped:
        cat = db.query(Category).filter(Category.slug == mapped).first()
        if cat:
            return cat

    if "-" in slug:
        for part in slug.split("-"):
            cat = db.query(Category).filter(Category.slug == part).first()
            if cat:
                return cat

    return None


def _fallback_find_historical(
    db: Session,
    raw_payee: str,
    normalized_payee: str | None = None,
    account_id: str | None = None,
) -> tuple[Category, float, int] | None:
    """Internal fallback historical category matcher if historical_matcher is unavailable."""
    if not raw_payee and not normalized_payee:
        return None

    def _query(payee_filter, target_acc: str | None = None):
        q = (
            db.query(
                TransactionSplit.category_id,
                func.count(TransactionSplit.id).label("freq"),
            )
            .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
            .filter(
                TransactionSplit.category_id.isnot(None),
                payee_filter,
            )
        )
        if target_acc:
            q = q.filter(Transaction.account_id == target_acc)
        return q.group_by(TransactionSplit.category_id).order_by(func.count(TransactionSplit.id).desc()).all()

    clean_raw = raw_payee.upper().strip() if raw_payee else None
    cat_counts = []
    if clean_raw and account_id:
        cat_counts = _query(func.upper(Transaction.raw_payee) == clean_raw, account_id)
    if not cat_counts and clean_raw:
        cat_counts = _query(func.upper(Transaction.raw_payee) == clean_raw)

    clean_norm = normalized_payee.upper().strip() if normalized_payee else None
    if not cat_counts and clean_norm and account_id:
        cat_counts = _query(func.upper(Transaction.normalized_payee) == clean_norm, account_id)
    if not cat_counts and clean_norm:
        cat_counts = _query(func.upper(Transaction.normalized_payee) == clean_norm)

    if not cat_counts:
        return None

    total_count = sum(cnt for _, cnt in cat_counts)
    top_cat_id, top_count = cat_counts[0]
    confidence = round(float(top_count) / float(total_count), 2)
    cat = db.query(Category).filter(Category.id == top_cat_id).first()
    if not cat:
        return None
    return (cat, confidence, total_count)


class ClassificationEngine:
    """
    Master 4-tier cascading classification orchestrator for Folio.
    Waterfall:
      1. Explicit Rules (priority-ordered user & default rules) - 100% confidence
      2. User History (frequently assigned category in past transactions)
      3. Semantic Heuristics (financial flow heuristics & commercial taxonomy keywords)
      4. AWS Bedrock AI Recourse (Nova Micro / Claude 3 with auto-learning caching)
      5. Fallback Unclassified
    """

    @classmethod
    def classify_transaction(
        cls,
        db: Session,
        raw_payee: str,
        amount: float | None = None,
        account_id: str | None = None,
        account_type: str | None = None,
        enable_bedrock: bool = False,
        min_confidence: float = 0.70,
    ) -> ClassificationResult:
        norm = normalize_payee(raw_payee)

        # Tier 1: Explicit Rules
        rule_match = evaluate_rules(db, raw_payee, amount, account_id)
        if rule_match.matched and rule_match.rule_id is not None:
            return ClassificationResult(
                matched=True,
                category_id=rule_match.category_id,
                category_name=rule_match.category_name,
                category_color=rule_match.category_color,
                normalized_payee=rule_match.normalized_payee or norm,
                confidence=1.0,
                tier=ClassificationTier.EXPLICIT_RULE,
                reason=f"Matched explicit rule {rule_match.rule_id}",
                rule_id=rule_match.rule_id,
            )

        # Tier 2: User History
        history = None
        if find_historical_category is not None:
            try:
                history = find_historical_category(db, raw_payee, norm, account_id)
            except Exception as e:
                logger.debug("Error in find_historical_category: %s", e)

        if history is None:
            history = _fallback_find_historical(db, raw_payee, norm, account_id)

        if history:
            if hasattr(history, "category_id"):
                # HistoricalMatchResult object from historical_matcher.py
                if history.matched and history.confidence >= min_confidence:
                    return ClassificationResult(
                        matched=True,
                        category_id=history.category_id,
                        category_name=history.category_name,
                        category_color=history.category_color,
                        normalized_payee=history.normalized_payee or norm,
                        confidence=history.confidence,
                        tier=ClassificationTier.USER_HISTORY,
                        reason=history.reason,
                    )
            elif isinstance(history, tuple) and len(history) == 3:
                cat, conf, count = history
                if conf >= min_confidence:
                    return ClassificationResult(
                        matched=True,
                        category_id=cat.id,
                        category_name=cat.name,
                        category_color=cat.color,
                        normalized_payee=norm,
                        confidence=conf,
                        tier=ClassificationTier.USER_HISTORY,
                        reason=f"Matched historical user classification ({count} occurrences, {conf:.0%} consistency)",
                    )

        # Tier 3: Semantic Heuristics
        heur_match = classify_by_semantic_heuristics(raw_payee, amount, account_type)
        if heur_match and heur_match.confidence >= min_confidence:
            category = lookup_category_by_slug(db, heur_match.category_slug)
            if category:
                return ClassificationResult(
                    matched=True,
                    category_id=category.id,
                    category_name=category.name,
                    category_color=category.color,
                    normalized_payee=norm,
                    confidence=heur_match.confidence,
                    tier=ClassificationTier.HEURISTIC,
                    reason=f"Semantic heuristic match: {heur_match.matched_keyword}",
                )

        # Tier 4: AWS Bedrock AI Recourse
        bedrock_allowed = enable_bedrock or settings.FOLIO_BEDROCK_ENABLED
        if bedrock_allowed:
            categories = db.query(Category).all()
            cats_summary = [
                {
                    "id": c.id,
                    "slug": c.slug,
                    "name": c.name,
                    "type": c.type.value if hasattr(c.type, "value") else str(c.type),
                }
                for c in categories
            ]
            tx_data = [
                {
                    "raw_payee": raw_payee,
                    "amount": amount,
                    "currency": settings.DEFAULT_CURRENCY,
                    "account_type": account_type,
                }
            ]

            bedrock_results = classify_with_bedrock(tx_data, cats_summary)
            if bedrock_results and len(bedrock_results) > 0:
                b_res = bedrock_results[0]
                if b_res.confidence >= min_confidence:
                    cat = lookup_category_by_slug(db, b_res.category_slug)
                    if cat:
                        learned_norm = b_res.normalized_payee or norm
                        learned_rule = auto_learn_rule(db, raw_payee, cat.id, learned_norm)
                        db.commit()
                        return ClassificationResult(
                            matched=True,
                            category_id=cat.id,
                            category_name=cat.name,
                            category_color=cat.color,
                            normalized_payee=learned_norm,
                            confidence=b_res.confidence,
                            tier=ClassificationTier.BEDROCK_AI,
                            reason=f"Bedrock AI: {b_res.reasoning}",
                            rule_id=learned_rule.id if learned_rule else None,
                        )

        # Tier 5: Fallback Unclassified
        return ClassificationResult(
            matched=False,
            category_id=None,
            category_name=None,
            category_color=None,
            normalized_payee=norm,
            confidence=0.0,
            tier=ClassificationTier.UNCLASSIFIED,
            reason="No matching classification rule, history, or heuristic found",
        )

    @classmethod
    def classify_batch(
        cls,
        db: Session,
        items: list[dict[str, Any]],
        enable_bedrock: bool = False,
        min_confidence: float = 0.70,
    ) -> list[ClassificationResult]:
        """
        Batch classification: Evaluates Tiers 1-3 locally in-memory with pre-fetched rules
        and categories; batches any remaining uncategorized items into a single Bedrock call.
        """
        if not items:
            return []

        rules = (
            db.query(CategorizationRule)
            .filter(CategorizationRule.is_active.is_(True))
            .order_by(CategorizationRule.priority.asc())
            .all()
        )
        categories = db.query(Category).all()
        categories_by_slug = {c.slug: c for c in categories}

        # Populate synonyms
        for alias, target in SLUG_SYNONYMS.items():
            if target in categories_by_slug and alias not in categories_by_slug:
                categories_by_slug[alias] = categories_by_slug[target]

        results: list[ClassificationResult | None] = [None] * len(items)
        pending_bedrock: list[tuple[int, dict[str, Any], str]] = []

        for idx, item in enumerate(items):
            raw_payee = item.get("raw_payee", "")
            amount = item.get("amount")
            account_id = item.get("account_id")
            account_type = item.get("account_type")
            norm = normalize_payee(raw_payee)

            # Tier 1: Explicit Rules
            rule_match = evaluate_rules(db, raw_payee, amount, account_id, rules=rules)
            if rule_match.matched and rule_match.rule_id is not None:
                results[idx] = ClassificationResult(
                    matched=True,
                    category_id=rule_match.category_id,
                    category_name=rule_match.category_name,
                    category_color=rule_match.category_color,
                    normalized_payee=rule_match.normalized_payee or norm,
                    confidence=1.0,
                    tier=ClassificationTier.EXPLICIT_RULE,
                    reason=f"Matched explicit rule {rule_match.rule_id}",
                    rule_id=rule_match.rule_id,
                )
                continue

            # Tier 2: User History
            history = None
            if find_historical_category is not None:
                try:
                    history = find_historical_category(db, raw_payee, norm, account_id)
                except Exception as e:
                    logger.debug("Error in find_historical_category: %s", e)

            if history is None:
                history = _fallback_find_historical(db, raw_payee, norm, account_id)

            if history:
                if hasattr(history, "category_id"):
                    if history.matched and history.confidence >= min_confidence:
                        results[idx] = ClassificationResult(
                            matched=True,
                            category_id=history.category_id,
                            category_name=history.category_name,
                            category_color=history.category_color,
                            normalized_payee=history.normalized_payee or norm,
                            confidence=history.confidence,
                            tier=ClassificationTier.USER_HISTORY,
                            reason=history.reason,
                        )
                        continue
                elif isinstance(history, tuple) and len(history) == 3:
                    cat, conf, count = history
                    if conf >= min_confidence:
                        results[idx] = ClassificationResult(
                            matched=True,
                            category_id=cat.id,
                            category_name=cat.name,
                            category_color=cat.color,
                            normalized_payee=norm,
                            confidence=conf,
                            tier=ClassificationTier.USER_HISTORY,
                            reason=f"Matched historical user classification ({count} occurrences, {conf:.0%} consistency)",
                        )
                        continue

            # Tier 3: Semantic Heuristics
            heur_match = classify_by_semantic_heuristics(raw_payee, amount, account_type)
            if heur_match and heur_match.confidence >= min_confidence:
                cat = categories_by_slug.get(heur_match.category_slug)
                if not cat and "-" in heur_match.category_slug:
                    for part in heur_match.category_slug.split("-"):
                        if part in categories_by_slug:
                            cat = categories_by_slug[part]
                            break

                if cat:
                    results[idx] = ClassificationResult(
                        matched=True,
                        category_id=cat.id,
                        category_name=cat.name,
                        category_color=cat.color,
                        normalized_payee=norm,
                        confidence=heur_match.confidence,
                        tier=ClassificationTier.HEURISTIC,
                        reason=f"Semantic heuristic match: {heur_match.matched_keyword}",
                    )
                    continue

            # Pending recourse or fallback
            pending_bedrock.append((idx, item, norm))

        # Tier 4: Batch AWS Bedrock Recourse
        bedrock_allowed = enable_bedrock or settings.FOLIO_BEDROCK_ENABLED
        if pending_bedrock and bedrock_allowed:
            cats_summary = [
                {
                    "id": c.id,
                    "slug": c.slug,
                    "name": c.name,
                    "type": c.type.value if hasattr(c.type, "value") else str(c.type),
                }
                for c in categories
            ]
            bedrock_inputs = [item for _, item, _ in pending_bedrock]
            bedrock_results = classify_with_bedrock(bedrock_inputs, cats_summary)

            rules_to_commit = False
            for b_idx, (orig_idx, item, norm) in enumerate(pending_bedrock):
                if b_idx < len(bedrock_results):
                    b_res = bedrock_results[b_idx]
                    if b_res.confidence >= min_confidence:
                        cat = categories_by_slug.get(b_res.category_slug)
                        if not cat:
                            cat = lookup_category_by_slug(db, b_res.category_slug)
                        if cat:
                            learned_norm = b_res.normalized_payee or norm
                            learned_rule = auto_learn_rule(db, item.get("raw_payee", ""), cat.id, learned_norm)
                            rules_to_commit = True
                            results[orig_idx] = ClassificationResult(
                                matched=True,
                                category_id=cat.id,
                                category_name=cat.name,
                                category_color=cat.color,
                                normalized_payee=learned_norm,
                                confidence=b_res.confidence,
                                tier=ClassificationTier.BEDROCK_AI,
                                reason=f"Bedrock AI: {b_res.reasoning}",
                                rule_id=learned_rule.id if learned_rule else None,
                            )
            if rules_to_commit:
                db.commit()

        # Tier 5: Fill any remaining slots with UNCLASSIFIED
        for idx in range(len(items)):
            if results[idx] is None:
                norm = normalize_payee(items[idx].get("raw_payee", ""))
                results[idx] = ClassificationResult(
                    matched=False,
                    category_id=None,
                    category_name=None,
                    category_color=None,
                    normalized_payee=norm,
                    confidence=0.0,
                    tier=ClassificationTier.UNCLASSIFIED,
                    reason="No matching classification rule, history, or heuristic found",
                )

        return results
