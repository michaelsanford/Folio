from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.services.categorization.history_index import (
    TOKEN_RE,
    HistoryGroup,
    HistoryIndex,
    PayeeLookupSpec,
    payee_lookup_spec,
)


@dataclass
class HistoricalMatchResult:
    matched: bool
    category_id: str
    category_name: str
    category_color: str
    normalized_payee: str
    confidence: float
    match_count: int
    total_count: int
    reason: str


def _scaled_confidence(ratio: float, total_count: int) -> float:
    if total_count == 1:
        confidence = 0.85 * ratio
    elif 2 <= total_count <= 4:
        confidence = 0.90 * ratio
    else:
        confidence = 0.98 * ratio
    return round(confidence, 4)


def _category_totals(groups: list[HistoryGroup]) -> list[tuple[str, int, HistoryGroup]]:
    """Sum split counts per category, most frequent first (first-seen breaks ties)."""
    totals: dict[str, list] = {}
    for g in groups:
        entry = totals.get(g.category_id)
        if entry is None:
            totals[g.category_id] = [g.category_id, g.count, g]
        else:
            entry[1] += g.count
    return sorted((tuple(v) for v in totals.values()), key=lambda t: -t[1])


def find_historical_category(
    db: Session,
    raw_payee: str,
    normalized_payee: str | None = None,
    account_id: str | None = None,
    min_confidence: float = 0.80,
    index: HistoryIndex | None = None,
) -> HistoricalMatchResult | None:
    """
    Tier 2 auto-classification: Historical Matcher.
    Learns from past user-categorized transactions.

    1. Clean/normalize payee with normalize_payee(raw_payee).
    2. Find past categorized splits whose normalized or raw payee equals the
       payee (case-insensitively), preferring the same account.
    3. Calculate categorical distribution: count per category_id.
    4. If no exact normalized match, fallback to token-overlap or prefix match.
    5. Compute empirical probability: ratio = category_count / total_count.
    6. Scale confidence:
       - total_count == 1: 0.85 * ratio
       - 2 <= total_count <= 4: 0.90 * ratio
       - total_count >= 5: 0.98 * ratio
    7. If ratio >= min_confidence, return HistoricalMatchResult.

    Lookups are answered from a :class:`HistoryIndex` (pass one in to share it
    across a batch); without one, a narrow index is loaded for this payee only.
    """
    spec = payee_lookup_spec(raw_payee, normalized_payee)
    if spec is None:
        return None
    if index is None:
        index = HistoryIndex.build(db, full=False)

    norm = spec.norm

    # 1. Exact match
    exact_groups = index.exact_groups(spec)
    exact_results: list = []
    if account_id:
        exact_results = _category_totals([g for g in exact_groups if g.account_id == account_id])
    if not exact_results:
        exact_results = _category_totals(exact_groups)

    if exact_results:
        total_count = sum(r[1] for r in exact_results)
        top_cat_id, match_count, top_group = exact_results[0]
        ratio = match_count / total_count if total_count > 0 else 0.0
        confidence = _scaled_confidence(ratio, total_count)

        if ratio >= min_confidence:
            pct = int(round(ratio * 100))
            reason = f"Historical user preference: {match_count}/{total_count} past transactions ({pct}%)"
            return HistoricalMatchResult(
                matched=True,
                category_id=top_cat_id,
                category_name=top_group.category_name or "",
                category_color=top_group.category_color or "",
                normalized_payee=norm,
                confidence=confidence,
                match_count=match_count,
                total_count=total_count,
                reason=reason,
            )
        return None

    # 2. Fallback to token-overlap or prefix match
    if not spec.search_tokens and not spec.prefix:
        return None

    candidates = index.like_groups(spec)
    if account_id:
        scoped = [g for g in candidates if g.account_id == account_id]
        if scoped:
            candidates = scoped
    if not candidates:
        return None

    # Group candidate splits by merchant name
    target_tokens = set(spec.search_tokens)
    prefix = spec.prefix
    merchant_groups: dict[str, list[HistoryGroup]] = {}
    for g in candidates:
        cand_name = g.normalized_payee or g.raw_payee or "Unknown"
        merchant_groups.setdefault(cand_name, []).append(g)

    best_merchant = None
    best_score = 0.0
    best_groups: list[HistoryGroup] = []

    for cand_name, groups in merchant_groups.items():
        cand_toks = set(TOKEN_RE.findall(cand_name.lower()))
        overlap = target_tokens & cand_toks
        union = target_tokens | cand_toks
        jaccard = len(overlap) / len(union) if union else 0.0
        inclusion = len(overlap) / len(target_tokens) if target_tokens else 0.0
        pfx_match = 0.5 if (prefix and cand_name.lower().startswith(prefix)) else 0.0
        score = max(jaccard, inclusion, pfx_match)

        if score > best_score:
            best_score = score
            best_merchant = cand_name
            best_groups = groups

    if best_score < 0.3 or not best_groups:
        return None

    cat_totals = _category_totals(best_groups)
    total_count = sum(t[1] for t in cat_totals)
    top_cat_id, match_count, top_group = cat_totals[0]
    ratio = match_count / total_count if total_count > 0 else 0.0
    confidence = _scaled_confidence(ratio, total_count)

    if ratio >= min_confidence:
        pct = int(round(ratio * 100))
        reason = f"Historical user preference: {match_count}/{total_count} past transactions ({pct}%)"
        return HistoricalMatchResult(
            matched=True,
            category_id=top_cat_id,
            category_name=top_group.category_name or "",
            category_color=top_group.category_color or "",
            normalized_payee=best_merchant or norm,
            confidence=confidence,
            match_count=match_count,
            total_count=total_count,
            reason=reason,
        )

    return None


def find_historical_fallback(
    index: HistoryIndex,
    raw_payee: str,
    normalized_payee: str | None,
    account_id: str | None,
) -> tuple[str, float, int] | None:
    """Case-insensitive exact payee frequency (the engine's secondary history check).

    Returns ``(category_id, confidence, total_count)``. Tries, in order: raw payee
    in this account, raw payee anywhere, normalized payee in this account,
    normalized payee anywhere.
    """
    if not raw_payee and not normalized_payee:
        return None
    spec = payee_lookup_spec(raw_payee, normalized_payee) if raw_payee else None
    if spec is None:
        # Blank raw payee: only the normalized-payee lookups apply.
        spec = PayeeLookupSpec(
            raw_payee=raw_payee or "",
            normalized_payee=normalized_payee,
            cleaned_raw="",
            norm="",
            search_tokens=(),
            prefix=None,
            like_patterns=(),
            fallback_raw_upper=None,
            fallback_norm_upper=normalized_payee.upper().strip() if normalized_payee else None,
        )

    def _counts(groups: list[HistoryGroup], acc: str | None) -> list:
        if acc:
            groups = [g for g in groups if g.account_id == acc]
        return _category_totals(groups)

    cat_counts: list = []
    raw_groups = index.upper_raw_groups(spec) if spec.fallback_raw_upper else []
    if spec.fallback_raw_upper and account_id:
        cat_counts = _counts(raw_groups, account_id)
    if not cat_counts and spec.fallback_raw_upper:
        cat_counts = _counts(raw_groups, None)

    norm_groups = index.upper_norm_groups(spec) if spec.fallback_norm_upper else []
    if not cat_counts and spec.fallback_norm_upper and account_id:
        cat_counts = _counts(norm_groups, account_id)
    if not cat_counts and spec.fallback_norm_upper:
        cat_counts = _counts(norm_groups, None)

    if not cat_counts:
        return None

    total_count = sum(c[1] for c in cat_counts)
    top_cat_id, top_count, top_group = cat_counts[0]
    if not top_group.category_exists:
        return None
    confidence = round(float(top_count) / float(total_count), 2)
    return (top_cat_id, confidence, total_count)
