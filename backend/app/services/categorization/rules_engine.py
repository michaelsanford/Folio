import re
from sqlalchemy.orm import Session
from app.models.rule import CategorizationRule, RulePatternType
from app.models.category import Category
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.semantic_classifier import classify_by_semantic_keywords


class RuleMatchResult:
    def __init__(
        self,
        matched: bool,
        rule_id: str | None = None,
        category_id: str | None = None,
        category_name: str | None = None,
        category_color: str | None = None,
        normalized_payee: str | None = None,
        confidence: float = 0.0,
    ):
        self.matched = matched
        self.rule_id = rule_id
        self.category_id = category_id
        self.category_name = category_name
        self.category_color = category_color
        self.normalized_payee = normalized_payee
        self.confidence = confidence


def evaluate_rules(
    db: Session,
    raw_payee: str,
    amount: float | None = None,
    account_id: str | None = None,
    rules: list[CategorizationRule] | None = None,
) -> RuleMatchResult:
    """
    Multi-tier transaction evaluation:
    - Tier 1: Explicit user and default priority rules (100% confidence)
    - Tier 2: Semantic Keyword Classifier (85% confidence)
    """
    if not raw_payee:
        return RuleMatchResult(matched=False)

    if rules is None:
        rules = (
            db.query(CategorizationRule)
            .filter(CategorizationRule.is_active.is_(True))
            .order_by(CategorizationRule.priority.asc())
            .all()
        )

    target_text = raw_payee.upper().strip()
    abs_amount = abs(amount) if amount is not None else None

    # Tier 1: Explicit Rules Engine
    for rule in rules:
        # Check account constraint
        if rule.target_account_id and rule.target_account_id != account_id:
            continue

        # Check amount constraints (absolute amount comparison) if amount is provided
        if abs_amount is not None:
            if rule.min_amount is not None and abs_amount < rule.min_amount:
                continue
            if rule.max_amount is not None and abs_amount > rule.max_amount:
                continue

        rule_pattern = rule.pattern.upper().strip()
        is_match = False

        if rule.pattern_type == RulePatternType.EXACT:
            is_match = (target_text == rule_pattern)
        elif rule.pattern_type == RulePatternType.CONTAINS:
            is_match = (rule_pattern in target_text)
        elif rule.pattern_type == RulePatternType.STARTS_WITH:
            is_match = target_text.startswith(rule_pattern)
        elif rule.pattern_type == RulePatternType.REGEX:
            try:
                is_match = bool(re.search(rule.pattern, raw_payee, re.IGNORECASE))
            except re.error:
                is_match = False

        if is_match:
            category = rule.category
            cat_name = category.name if category else None
            cat_color = category.color if category else None
            norm_name = rule.normalized_payee_override or normalize_payee(raw_payee)
            
            return RuleMatchResult(
                matched=True,
                rule_id=rule.id,
                category_id=rule.category_id,
                category_name=cat_name,
                category_color=cat_color,
                normalized_payee=norm_name,
                confidence=1.0,
            )

    # Tier 2: Semantic Keyword Classification
    semantic_match = classify_by_semantic_keywords(raw_payee)
    if semantic_match:
        category = db.query(Category).filter(Category.slug == semantic_match.category_slug).first()
        if category:
            return RuleMatchResult(
                matched=True,
                rule_id=None,
                category_id=category.id,
                category_name=category.name,
                category_color=category.color,
                normalized_payee=normalize_payee(raw_payee),
                confidence=semantic_match.confidence,
            )

    return RuleMatchResult(matched=False, normalized_payee=normalize_payee(raw_payee))
