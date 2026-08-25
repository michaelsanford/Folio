import re
from sqlalchemy.orm import Session
from app.models.rule import CategorizationRule, RulePatternType
from app.models.category import Category


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
    Evaluates active CategorizationRules against a transaction.
    Rules are sorted by priority ASC (lower integer = higher precedence).
    """
    if rules is None:
        rules = (
            db.query(CategorizationRule)
            .filter(CategorizationRule.is_active.is_(True))
            .order_by(CategorizationRule.priority.asc())
            .all()
        )

    target_text = raw_payee.upper().strip()
    abs_amount = abs(amount) if amount is not None else None

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
            
            return RuleMatchResult(
                matched=True,
                rule_id=rule.id,
                category_id=rule.category_id,
                category_name=cat_name,
                category_color=cat_color,
                normalized_payee=rule.normalized_payee_override,
                confidence=1.0,
            )

    return RuleMatchResult(matched=False)
