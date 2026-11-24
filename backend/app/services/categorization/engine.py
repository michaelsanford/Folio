import enum
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.api.rules import auto_learn_rule
from app.core.config import settings
from app.models.category import Category
from app.models.rule import CategorizationRule
from app.services.categorization.bedrock_classifier import classify_with_bedrock
from app.services.categorization.generic_payees import (
    clean_bank_note_for_matching,
    is_generic_bank_note,
    is_generic_bank_payee,
)
from app.services.categorization.history_index import HistoryIndex, payee_lookup_spec
from app.services.categorization.historical_matcher import (
    find_historical_category,
    find_historical_fallback,
)
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.rules_engine import evaluate_rules, load_active_rules
from app.services.categorization.semantic_classifier import classify_by_semantic_heuristics

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


@dataclass
class ClassificationContext:
    """Everything a classification pass reads, loaded once per request.

    Rules, categories and the history index used to be re-queried for every
    transaction (and several times per transaction); a 300-row preview on a
    large vault ran thousands of full-table scans.
    """

    db: Session
    rules: list[CategorizationRule]
    categories: list[Category]
    categories_by_slug: dict[str, Category]
    categories_by_id: dict[str, Category]
    history: HistoryIndex
    _summary: list[dict[str, Any]] | None = field(default=None, repr=False)

    @classmethod
    def build(cls, db: Session, *, full_history: bool = False) -> "ClassificationContext":
        categories = db.query(Category).all()
        categories_by_slug = {c.slug: c for c in categories}
        for alias, target in SLUG_SYNONYMS.items():
            if target in categories_by_slug and alias not in categories_by_slug:
                categories_by_slug[alias] = categories_by_slug[target]
        return cls(
            db=db,
            rules=load_active_rules(db),
            categories=categories,
            categories_by_slug=categories_by_slug,
            categories_by_id={c.id: c for c in categories},
            history=HistoryIndex.build(db, full=full_history),
        )

    def resolve_slug(self, slug: str) -> Category | None:
        return _resolve_category_by_slug(self.db, slug, self.categories_by_slug)

    def bedrock_category_summary(self) -> list[dict[str, Any]]:
        if self._summary is None:
            self._summary = [
                {
                    "id": c.id,
                    "slug": c.slug,
                    "name": c.name,
                    "type": c.type.value if hasattr(c.type, "value") else str(c.type),
                }
                for c in self.categories
            ]
        return self._summary


def _resolve_category_by_slug(
    db: Session,
    slug: str,
    categories_by_slug: dict[str, Category] | None = None,
) -> Category | None:
    if categories_by_slug is not None:
        cat = categories_by_slug.get(slug)
        if cat:
            return cat
        mapped = SLUG_SYNONYMS.get(slug)
        if mapped and mapped in categories_by_slug:
            return categories_by_slug[mapped]
        if "-" in slug:
            for part in slug.split("-"):
                if part in categories_by_slug:
                    return categories_by_slug[part]
        return None
    return lookup_category_by_slug(db, slug)


def _find_historical_by_notes(
    ctx: ClassificationContext,
    notes: str,
    account_id: str | None = None,
    min_confidence: float = 0.70,
) -> tuple[Category, float, int, str] | None:
    """Find past categorized transactions whose cleaned notes match ``notes``."""
    cleaned_note = clean_bank_note_for_matching(notes)
    if not cleaned_note or is_generic_bank_note(notes):
        return None

    target_upper = cleaned_note.upper()
    alpha_tokens = [tok for tok in cleaned_note.split() if sum(ch.isalpha() for ch in tok) >= 3]
    anchor = max(alpha_tokens, key=len) if alpha_tokens else cleaned_note

    matching = [
        g for g in ctx.history.note_groups(anchor)
        if clean_bank_note_for_matching(g.notes).upper() == target_upper
    ]
    if account_id:
        acc_rows = [g for g in matching if g.account_id == account_id]
        if acc_rows:
            matching = acc_rows

    if not matching:
        return None

    counts: dict[str, int] = {}
    for g in matching:
        counts[g.category_id] = counts.get(g.category_id, 0) + g.count

    total_count = sum(counts.values())
    top_cat_id, top_count = max(counts.items(), key=lambda kv: kv[1])
    ratio = top_count / total_count
    scale = 0.85 if total_count == 1 else (0.90 if total_count <= 4 else 0.98)
    confidence = round(scale * ratio, 4)
    if ratio < min_confidence or confidence < min_confidence:
        return None

    cat = ctx.categories_by_id.get(top_cat_id)
    if not cat:
        return None
    return (cat, confidence, total_count, normalize_payee(cleaned_note))


def _match_tier1_rule(
    ctx: ClassificationContext,
    text: str,
    default_norm: str,
    amount: float | None,
    account_id: str | None,
) -> ClassificationResult | None:
    if not text or not text.strip():
        return None
    # semantic=False: only an explicit rule counts here; the keyword tier runs
    # later as tier 3, so evaluating it now was wasted work (and a query).
    rule_match = evaluate_rules(ctx.db, text, amount, account_id, rules=ctx.rules, semantic=False)
    if rule_match.matched and rule_match.rule_id is not None:
        return ClassificationResult(
            matched=True,
            category_id=rule_match.category_id,
            category_name=rule_match.category_name,
            category_color=rule_match.category_color,
            normalized_payee=rule_match.normalized_payee or default_norm,
            confidence=1.0,
            tier=ClassificationTier.EXPLICIT_RULE,
            reason=f"Matched explicit rule {rule_match.rule_id}",
            rule_id=rule_match.rule_id,
        )
    return None


def _match_tier2_history(
    ctx: ClassificationContext,
    raw_payee: str,
    norm: str,
    account_id: str | None,
    min_confidence: float,
) -> ClassificationResult | None:
    history = None
    try:
        history = find_historical_category(ctx.db, raw_payee, norm, account_id, index=ctx.history)
    except Exception as e:
        logger.debug("Error in find_historical_category: %s", e)

    if history is not None:
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
        return None

    fallback = find_historical_fallback(ctx.history, raw_payee, norm, account_id)
    if not fallback:
        return None
    cat_id, conf, count = fallback
    cat = ctx.categories_by_id.get(cat_id)
    if cat is None or conf < min_confidence:
        return None
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


def _match_tier3_heuristic(
    ctx: ClassificationContext,
    text: str,
    display_norm: str,
    amount: float | None,
    account_type: str | None,
    min_confidence: float,
) -> ClassificationResult | None:
    if not text or not text.strip():
        return None
    heur_match = classify_by_semantic_heuristics(text, amount, account_type)
    if heur_match and heur_match.confidence >= min_confidence:
        category = ctx.resolve_slug(heur_match.category_slug)
        if category:
            return ClassificationResult(
                matched=True,
                category_id=category.id,
                category_name=category.name,
                category_color=category.color,
                normalized_payee=display_norm,
                confidence=heur_match.confidence,
                tier=ClassificationTier.HEURISTIC,
                reason=f"Semantic heuristic match: {heur_match.matched_keyword}",
            )
    return None


def _unclassified(norm: str) -> ClassificationResult:
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


class ClassificationEngine:
    """
    Master 4-tier cascading classification orchestrator for Folio.
    Waterfall:
      1. Explicit Rules (priority-ordered user & default rules) - 100% confidence
      2. User History (frequently assigned category in past transactions)
      3. Semantic Heuristics (financial flow heuristics & commercial taxonomy keywords)
      4. AWS Bedrock AI Recourse (Nova Micro / Claude 3 with auto-learning caching)
      5. Fallback Unclassified

    Pass ``persist=False`` on preview paths: Bedrock answers are still returned
    but no learned rule is written or committed.
    """

    @classmethod
    def _classify_local(
        cls,
        ctx: ClassificationContext,
        raw_payee: str,
        amount: float | None = None,
        account_id: str | None = None,
        account_type: str | None = None,
        min_confidence: float = 0.70,
        notes: str | None = None,
    ) -> ClassificationResult | None:
        base_norm = normalize_payee(raw_payee)
        clean_notes = (notes or "").strip()

        if is_generic_bank_payee(raw_payee):
            if clean_notes:
                # 1. Explicit rules against specific notes before generic raw_payee fallbacks
                for candidate in (clean_notes, f"{raw_payee} {clean_notes}"):
                    res = _match_tier1_rule(ctx, candidate, base_norm, amount, account_id)
                    if res:
                        return res

                # 2. User history on specific cleaned note (never bare generic raw_payee)
                if not is_generic_bank_note(clean_notes):
                    cleaned_note_text = clean_bank_note_for_matching(clean_notes)
                    note_hist = _find_historical_by_notes(
                        ctx, clean_notes, account_id=account_id, min_confidence=min_confidence
                    )
                    if note_hist:
                        cat, conf, count, note_norm = note_hist
                        return ClassificationResult(
                            matched=True,
                            category_id=cat.id,
                            category_name=cat.name,
                            category_color=cat.color,
                            normalized_payee=note_norm or base_norm,
                            confidence=conf,
                            tier=ClassificationTier.USER_HISTORY,
                            reason=f"Matched historical note classification ({count} occurrences, {conf:.0%} consistency)",
                        )
                    note_norm_text = normalize_payee(cleaned_note_text)
                    res = _match_tier2_history(
                        ctx, cleaned_note_text, note_norm_text, account_id, min_confidence
                    )
                    if res:
                        return res

                # 3. Semantic heuristics on combined text and notes
                for candidate in (f"{raw_payee} {clean_notes}", clean_notes):
                    res = _match_tier3_heuristic(
                        ctx, candidate, base_norm, amount, account_type, min_confidence
                    )
                    if res:
                        return res

            # Fallback for generic bank labels: exact/prefix rules & heuristics on raw_payee alone
            res = _match_tier1_rule(ctx, raw_payee, base_norm, amount, account_id)
            if res:
                return res

            return _match_tier3_heuristic(
                ctx, raw_payee, base_norm, amount, account_type, min_confidence
            )

        # Non-generic raw_payee: standard Tiers 1 -> 2 -> 3 on raw_payee
        res = _match_tier1_rule(ctx, raw_payee, base_norm, amount, account_id)
        if res:
            return res

        res = _match_tier2_history(ctx, raw_payee, base_norm, account_id, min_confidence)
        if res:
            return res

        res = _match_tier3_heuristic(
            ctx, raw_payee, base_norm, amount, account_type, min_confidence
        )
        if res:
            return res

        # If unmatched and notes are provided, check Tiers 1 and 3 using notes context
        if clean_notes:
            for candidate in (f"{raw_payee} {clean_notes}", clean_notes):
                res = _match_tier1_rule(ctx, candidate, base_norm, amount, account_id)
                if res:
                    return res
            for candidate in (f"{raw_payee} {clean_notes}", clean_notes):
                res = _match_tier3_heuristic(
                    ctx, candidate, base_norm, amount, account_type, min_confidence
                )
                if res:
                    return res

        return None

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
        notes: str | None = None,
        persist: bool = True,
        context: ClassificationContext | None = None,
    ) -> ClassificationResult:
        ctx = context or ClassificationContext.build(db)
        norm = normalize_payee(raw_payee)

        local_result = cls._classify_local(
            ctx,
            raw_payee=raw_payee,
            amount=amount,
            account_id=account_id,
            account_type=account_type,
            min_confidence=min_confidence,
            notes=notes,
        )
        if local_result:
            return local_result

        # Tier 4: AWS Bedrock AI Recourse
        bedrock_allowed = enable_bedrock or settings.FOLIO_BEDROCK_ENABLED
        if bedrock_allowed:
            tx_data = [
                {
                    "raw_payee": raw_payee,
                    "notes": notes,
                    "amount": amount,
                    "currency": settings.DEFAULT_CURRENCY,
                    "account_type": account_type,
                }
            ]

            bedrock_results = classify_with_bedrock(tx_data, ctx.bedrock_category_summary())
            if bedrock_results:
                b_res = bedrock_results[0]
                if b_res.confidence >= min_confidence:
                    cat = ctx.resolve_slug(b_res.category_slug)
                    if cat:
                        learned_norm = b_res.normalized_payee or norm
                        learned_rule = None
                        if persist:
                            learned_rule = auto_learn_rule(
                                db, raw_payee, cat.id, learned_norm, notes=notes
                            )
                            db.commit()
                        return ClassificationResult(
                            matched=True,
                            category_id=cat.id,
                            category_name=cat.name,
                            category_color=cat.color,
                            normalized_payee=learned_norm,
                            confidence=b_res.confidence,
                            tier=ClassificationTier.BEDROCK_AI,
                            reason=f"AI: {b_res.reasoning}",
                            rule_id=learned_rule.id if learned_rule else None,
                        )

        # Tier 5: Fallback Unclassified
        return _unclassified(norm)

    @classmethod
    def classify_batch(
        cls,
        db: Session,
        items: list[dict[str, Any]],
        enable_bedrock: bool = False,
        min_confidence: float = 0.70,
        persist: bool = True,
        context: ClassificationContext | None = None,
    ) -> list[ClassificationResult]:
        """
        Batch classification: Evaluates Tiers 1-3 locally in-memory with pre-fetched rules,
        categories and history; batches any remaining uncategorized items into Bedrock.
        """
        if not items:
            return []

        ctx = context or ClassificationContext.build(db)
        # Load the history every row's payee lookup can touch in one round trip,
        # rather than one lazy fetch per row.
        ctx.history.prefetch(
            payee_lookup_spec(raw, normalize_payee(raw))
            for raw in dict.fromkeys((it.get("raw_payee") or "") for it in items)
            if raw.strip()
        )

        results: list[ClassificationResult | None] = [None] * len(items)
        pending_bedrock: list[tuple[int, dict[str, Any], str]] = []

        for idx, item in enumerate(items):
            raw_payee = item.get("raw_payee", "") or ""
            local_result = cls._classify_local(
                ctx,
                raw_payee=raw_payee,
                amount=item.get("amount"),
                account_id=item.get("account_id"),
                account_type=item.get("account_type"),
                min_confidence=min_confidence,
                notes=item.get("notes"),
            )
            if local_result:
                results[idx] = local_result
                continue

            # Pending recourse or fallback
            pending_bedrock.append((idx, item, normalize_payee(raw_payee)))

        # Tier 4: Batch AWS Bedrock Recourse
        bedrock_allowed = enable_bedrock or settings.FOLIO_BEDROCK_ENABLED
        if pending_bedrock and bedrock_allowed:
            bedrock_inputs = [item for _, item, _ in pending_bedrock]
            bedrock_results = classify_with_bedrock(bedrock_inputs, ctx.bedrock_category_summary())

            rules_to_commit = False
            for b_idx, (orig_idx, item, norm) in enumerate(pending_bedrock):
                if b_idx >= len(bedrock_results):
                    break
                b_res = bedrock_results[b_idx]
                if b_res.confidence < min_confidence:
                    continue
                cat = ctx.resolve_slug(b_res.category_slug)
                if not cat:
                    continue
                learned_norm = b_res.normalized_payee or norm
                learned_rule = None
                if persist:
                    learned_rule = auto_learn_rule(
                        db,
                        item.get("raw_payee", ""),
                        cat.id,
                        learned_norm,
                        notes=item.get("notes"),
                    )
                    rules_to_commit = True
                results[orig_idx] = ClassificationResult(
                    matched=True,
                    category_id=cat.id,
                    category_name=cat.name,
                    category_color=cat.color,
                    normalized_payee=learned_norm,
                    confidence=b_res.confidence,
                    tier=ClassificationTier.BEDROCK_AI,
                    reason=f"AI: {b_res.reasoning}",
                    rule_id=learned_rule.id if learned_rule else None,
                )
            if rules_to_commit:
                db.commit()

        # Tier 5: Fill any remaining slots with UNCLASSIFIED
        for idx in range(len(items)):
            if results[idx] is None:
                results[idx] = _unclassified(normalize_payee(items[idx].get("raw_payee", "") or ""))

        return results
