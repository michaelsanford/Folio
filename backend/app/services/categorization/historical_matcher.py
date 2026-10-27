from dataclasses import dataclass
import re
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.normalizer import normalize_payee


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


def find_historical_category(
    db: Session,
    raw_payee: str,
    normalized_payee: str | None = None,
    account_id: str | None = None,
    min_confidence: float = 0.80,
) -> HistoricalMatchResult | None:
    """
    Tier 2 auto-classification: Historical Matcher.
    Learns from past user-categorized transactions.
    
    1. Clean/normalize payee with normalize_payee(raw_payee).
    2. Query existing transactions in db (joined with TransactionSplit and Category)
       where Transaction.normalized_payee == norm or Transaction.raw_payee == raw_payee
       and TransactionSplit.category_id.isnot(None).
    3. Calculate categorical distribution: count per category_id.
    4. If no exact normalized match, fallback to token-overlap query or prefix if length >= 4.
    5. Compute empirical probability: ratio = category_count / total_count.
    6. Scale confidence:
       - total_count == 1: 0.85 * ratio
       - 2 <= total_count <= 4: 0.90 * ratio
       - total_count >= 5: 0.98 * ratio
    7. If ratio >= min_confidence, return HistoricalMatchResult.
    """
    if not raw_payee or not raw_payee.strip():
        return None

    cleaned_raw = raw_payee.strip()
    norm = (normalized_payee or normalize_payee(cleaned_raw)).strip()
    if not norm or norm.lower() == "unknown":
        norm = cleaned_raw

    # 1. Exact match query
    exact_filter = or_(
        func.lower(Transaction.normalized_payee) == norm.lower(),
        func.lower(Transaction.raw_payee) == cleaned_raw.lower(),
        Transaction.normalized_payee == norm,
        Transaction.raw_payee == cleaned_raw,
    )

    base_query = (
        db.query(
            TransactionSplit.category_id,
            Category.name.label("category_name"),
            Category.color.label("category_color"),
            func.count(TransactionSplit.id).label("count"),
        )
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .join(Category, TransactionSplit.category_id == Category.id)
        .filter(
            TransactionSplit.category_id.isnot(None),
            exact_filter,
        )
    )

    exact_results = []
    if account_id:
        exact_results = (
            base_query.filter(Transaction.account_id == account_id)
            .group_by(TransactionSplit.category_id, Category.name, Category.color)
            .order_by(func.count(TransactionSplit.id).desc())
            .all()
        )
    if not exact_results:
        exact_results = (
            base_query.group_by(TransactionSplit.category_id, Category.name, Category.color)
            .order_by(func.count(TransactionSplit.id).desc())
            .all()
        )

    if exact_results:
        total_count = sum(r.count for r in exact_results)
        top = exact_results[0]
        match_count = top.count
        ratio = match_count / total_count if total_count > 0 else 0.0

        if total_count == 1:
            confidence = 0.85 * ratio
        elif 2 <= total_count <= 4:
            confidence = 0.90 * ratio
        else:
            confidence = 0.98 * ratio
        confidence = round(confidence, 4)

        if ratio >= min_confidence:
            pct = int(round(ratio * 100))
            reason = f"Historical user preference: {match_count}/{total_count} past transactions ({pct}%)"
            return HistoricalMatchResult(
                matched=True,
                category_id=top.category_id,
                category_name=top.category_name or "",
                category_color=top.category_color or "",
                normalized_payee=norm,
                confidence=confidence,
                match_count=match_count,
                total_count=total_count,
                reason=reason,
            )
        return None

    # 2. Fallback to token-overlap query or prefix if length >= 4
    norm_tokens = [t for t in re.findall(r"[\w\u00C0-\u017F]+", norm.lower()) if len(t) >= 4]
    raw_tokens = [t for t in re.findall(r"[\w\u00C0-\u017F]+", cleaned_raw.lower()) if len(t) >= 4]
    search_tokens = list(dict.fromkeys(norm_tokens + raw_tokens))
    prefix = norm[:4].lower() if len(norm) >= 4 else (cleaned_raw[:4].lower() if len(cleaned_raw) >= 4 else None)

    if not search_tokens and not prefix:
        return None

    cand_conditions = []
    if prefix:
        cand_conditions.append(func.lower(Transaction.normalized_payee).like(f"{prefix}%"))
        cand_conditions.append(func.lower(Transaction.raw_payee).like(f"{prefix}%"))
    for tok in search_tokens:
        cand_conditions.append(func.lower(Transaction.normalized_payee).like(f"%{tok}%"))
        cand_conditions.append(func.lower(Transaction.raw_payee).like(f"%{tok}%"))

    cand_query = (
        db.query(
            Transaction.id,
            Transaction.account_id,
            Transaction.raw_payee,
            Transaction.normalized_payee,
            TransactionSplit.category_id,
            Category.name.label("category_name"),
            Category.color.label("category_color"),
        )
        .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
        .join(Category, TransactionSplit.category_id == Category.id)
        .filter(
            TransactionSplit.category_id.isnot(None),
            or_(*cand_conditions),
        )
    )

    candidate_rows = []
    if account_id:
        candidate_rows = cand_query.filter(Transaction.account_id == account_id).all()
    if not candidate_rows:
        candidate_rows = cand_query.all()

    if not candidate_rows:
        return None

    # Group candidate rows by merchant name
    target_tokens = set(search_tokens)
    merchant_groups: dict[str, list] = {}
    for row in candidate_rows:
        cand_name = row.normalized_payee or row.raw_payee or "Unknown"
        merchant_groups.setdefault(cand_name, []).append(row)

    best_merchant = None
    best_score = 0.0
    best_rows: list = []

    for cand_name, rows in merchant_groups.items():
        cand_toks = set(re.findall(r"[\w\u00C0-\u017F]+", cand_name.lower()))
        overlap = target_tokens & cand_toks
        jaccard = len(overlap) / len(target_tokens | cand_toks) if (target_tokens | cand_toks) else 0.0
        inclusion = len(overlap) / len(target_tokens) if target_tokens else 0.0
        pfx_match = 0.5 if (prefix and cand_name.lower().startswith(prefix)) else 0.0
        score = max(jaccard, inclusion, pfx_match)

        if score > best_score:
            best_score = score
            best_merchant = cand_name
            best_rows = rows

    if best_score < 0.3 or not best_rows:
        return None

    cat_counts: dict[str, dict] = {}
    for r in best_rows:
        cid = r.category_id
        if cid not in cat_counts:
            cat_counts[cid] = {
                "count": 0,
                "name": r.category_name or "",
                "color": r.category_color or "",
            }
        cat_counts[cid]["count"] += 1

    total_count = len(best_rows)
    sorted_cats = sorted(cat_counts.items(), key=lambda x: x[1]["count"], reverse=True)
    top_cat_id, top_info = sorted_cats[0]
    match_count = top_info["count"]
    ratio = match_count / total_count if total_count > 0 else 0.0

    if total_count == 1:
        confidence = 0.85 * ratio
    elif 2 <= total_count <= 4:
        confidence = 0.90 * ratio
    else:
        confidence = 0.98 * ratio
    confidence = round(confidence, 4)

    if ratio >= min_confidence:
        pct = int(round(ratio * 100))
        reason = f"Historical user preference: {match_count}/{total_count} past transactions ({pct}%)"
        return HistoricalMatchResult(
            matched=True,
            category_id=top_cat_id,
            category_name=top_info["name"],
            category_color=top_info["color"],
            normalized_payee=best_merchant or norm,
            confidence=confidence,
            match_count=match_count,
            total_count=total_count,
            reason=reason,
        )

    return None
