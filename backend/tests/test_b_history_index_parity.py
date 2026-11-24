"""HistoryIndex must answer exactly like the legacy per-transaction SQL matchers.

The legacy implementations are kept here verbatim (minus logging) as the oracle.
Fixtures deliberately mix case, accents, whitespace, LIKE wildcards in payees,
per-account splits, deleted categories, and notes.
"""
import random
import re
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event, func, literal_column, or_

from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.engine import ClassificationContext, _find_historical_by_notes
from app.services.categorization.generic_payees import (
    clean_bank_note_for_matching,
    is_generic_bank_note,
)
from app.services.categorization.history_index import HistoryIndex
from app.services.categorization.historical_matcher import (
    find_historical_category,
    find_historical_fallback,
)
from app.services.categorization.normalizer import normalize_payee


# --------------------------------------------------------------------------- legacy oracle


def legacy_find_historical_category(db, raw_payee, normalized_payee=None, account_id=None, min_confidence=0.80):
    if not raw_payee or not raw_payee.strip():
        return None
    cleaned_raw = raw_payee.strip()
    norm = (normalized_payee or normalize_payee(cleaned_raw)).strip()
    if not norm or norm.lower() == "unknown":
        norm = cleaned_raw
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
        .filter(TransactionSplit.category_id.isnot(None), exact_filter)
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
        ratio = top.count / total_count
        if ratio >= min_confidence:
            return (top.category_id, norm, top.count, total_count)
        return None

    norm_tokens = [t for t in re.findall(r"[\wÀ-ſ]+", norm.lower()) if len(t) >= 4]
    raw_tokens = [t for t in re.findall(r"[\wÀ-ſ]+", cleaned_raw.lower()) if len(t) >= 4]
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
            Transaction.id, Transaction.account_id, Transaction.raw_payee, Transaction.normalized_payee,
            TransactionSplit.category_id,
        )
        .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
        .join(Category, TransactionSplit.category_id == Category.id)
        .filter(TransactionSplit.category_id.isnot(None), or_(*cand_conditions))
        .order_by(literal_column("transactions.rowid"))
    )
    candidate_rows = []
    if account_id:
        candidate_rows = cand_query.filter(Transaction.account_id == account_id).all()
    if not candidate_rows:
        candidate_rows = cand_query.all()
    if not candidate_rows:
        return None
    target_tokens = set(search_tokens)
    merchant_groups = {}
    for row in candidate_rows:
        merchant_groups.setdefault(row.normalized_payee or row.raw_payee or "Unknown", []).append(row)
    best_merchant, best_score, best_rows = None, 0.0, []
    for cand_name, rows in merchant_groups.items():
        cand_toks = set(re.findall(r"[\wÀ-ſ]+", cand_name.lower()))
        overlap = target_tokens & cand_toks
        jaccard = len(overlap) / len(target_tokens | cand_toks) if (target_tokens | cand_toks) else 0.0
        inclusion = len(overlap) / len(target_tokens) if target_tokens else 0.0
        pfx_match = 0.5 if (prefix and cand_name.lower().startswith(prefix)) else 0.0
        score = max(jaccard, inclusion, pfx_match)
        if score > best_score:
            best_score, best_merchant, best_rows = score, cand_name, rows
    if best_score < 0.3 or not best_rows:
        return None
    counts = {}
    for r in best_rows:
        counts[r.category_id] = counts.get(r.category_id, 0) + 1
    top_cat_id, match_count = sorted(counts.items(), key=lambda x: x[1], reverse=True)[0]
    total_count = len(best_rows)
    if match_count / total_count >= min_confidence:
        return (top_cat_id, best_merchant or norm, match_count, total_count)
    return None


def legacy_fallback(db, raw_payee, normalized_payee=None, account_id=None):
    if not raw_payee and not normalized_payee:
        return None

    def _query(payee_filter, target_acc=None):
        q = (
            db.query(TransactionSplit.category_id, func.count(TransactionSplit.id).label("freq"))
            .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
            .filter(TransactionSplit.category_id.isnot(None), payee_filter)
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
    total = sum(c for _, c in cat_counts)
    top_count = cat_counts[0][1]
    # SQL leaves the order of equal counts unspecified, so a tie admits any of them.
    tied = {cid for cid, c in cat_counts if c == top_count}
    return (tied, round(float(top_count) / float(total), 2), total)


def legacy_notes(db, notes, account_id=None, min_confidence=0.70):
    cleaned_note = clean_bank_note_for_matching(notes)
    if not cleaned_note or is_generic_bank_note(notes):
        return None
    target_upper = cleaned_note.upper()
    alpha_tokens = [tok for tok in cleaned_note.split() if sum(ch.isalpha() for ch in tok) >= 3]
    anchor = max(alpha_tokens, key=len) if alpha_tokens else cleaned_note
    rows = (
        db.query(Transaction.account_id, Transaction.notes, TransactionSplit.category_id)
        .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
        .filter(
            TransactionSplit.category_id.isnot(None),
            Transaction.notes.isnot(None),
            func.lower(Transaction.notes).like(f"%{anchor.lower()}%"),
        )
        .all()
    )
    matching = [r for r in rows if clean_bank_note_for_matching(r.notes).upper() == target_upper]
    if account_id:
        acc_rows = [r for r in matching if r.account_id == account_id]
        if acc_rows:
            matching = acc_rows
    if not matching:
        return None
    counts = {}
    for r in matching:
        counts[r.category_id] = counts.get(r.category_id, 0) + 1
    total = sum(counts.values())
    top_cat_id, top_count = max(counts.items(), key=lambda kv: kv[1])
    ratio = top_count / total
    scale = 0.85 if total == 1 else (0.90 if total <= 4 else 0.98)
    confidence = round(scale * ratio, 4)
    if ratio < min_confidence or confidence < min_confidence:
        return None
    if not db.query(Category).filter(Category.id == top_cat_id).first():
        return None
    return (top_cat_id, confidence, total, normalize_payee(cleaned_note))


# --------------------------------------------------------------------------- fixtures

MERCHANTS = [
    "METRO MONTREAL #123", "Metro", "metro montreal", "WHOLE FOODS MARKET #1042", "Whole Foods",
    "CAFÉ OLIMPICO", "café olimpico", "Café Olimpico", "COSTCO WHOLESALE", "Costco", "PROVIGO EXPRESS",
    "AMZN_MKTP CA", "AMZN%MKTP", "SHELL 1234", "Shell Canada", "STM OPUS", "NETFLIX.COM",
    "  PADDED PAYEE  ", "PHARMAPRIX", "Pharmaprix 555", "UBER *TRIP", "UBER EATS",
]
NOTES = [None, None, "Rent payment John", "rent payment JOHN", "Hydro bill", "E-TRANSFER Marie Dupont",
         "Cheque #123", "Gym membership", "gym MEMBERSHIP", "Œuvre café"]
QUERIES = MERCHANTS + [
    "METRO", "metro montreal #999", "WHOLE FOODS", "CAFE OLIMPICO", "COSTCO #5", "AMZN MKTP", "UBER",
    "PHARMAPRIX 777", "Brand New Merchant", "XYZ", "Shell", "   ", "STM", "Netflix", "Café",
]
NOTE_QUERIES = ["Rent payment John", "RENT PAYMENT JOHN", "Hydro bill", "Marie Dupont", "gym membership",
                "Œuvre café", "Unknown memo text", "Cheque #123"]


@pytest.fixture
def history_db(db_session):
    rnd = random.Random(42)
    accounts = [Account(name=f"Acc {i}", type=AccountType.CHECKING) for i in range(3)]
    db_session.add_all(accounts)
    db_session.flush()
    cats = db_session.query(Category).limit(6).all()
    doomed = Category(name="Doomed", slug="doomed-parity", type=CategoryType.EXPENSE)
    db_session.add(doomed)
    db_session.flush()
    start = datetime(2025, 1, 1)
    for i in range(400):
        raw = rnd.choice(MERCHANTS)
        txn = Transaction(
            account_id=rnd.choice(accounts).id,
            transaction_date=start + timedelta(days=rnd.randint(0, 300)),
            raw_payee=raw,
            normalized_payee=rnd.choice([None, normalize_payee(raw), raw.upper(), raw.lower()]),
            amount_cents=-rnd.randint(100, 9999),
            notes=rnd.choice(NOTES),
        )
        # Skew towards one category per merchant so the confidence thresholds are reachable.
        cat_pool = [cats[MERCHANTS.index(raw) % len(cats)]] * 6 + cats + [doomed]
        if txn.notes and rnd.random() < 0.85:
            chosen = cats[NOTES.index(txn.notes) % len(cats)]
        else:
            chosen = rnd.choice(cat_pool)
        txn.splits.append(TransactionSplit(
            category_id=(chosen.id if rnd.random() < 0.9 else None),
            amount_cents=txn.amount_cents,
        ))
        db_session.add(txn)
    db_session.commit()
    # A deleted category leaves dangling split category ids (no FK enforcement in tests).
    db_session.execute(Category.__table__.delete().where(Category.id == doomed.id))
    db_session.commit()
    return db_session, [a.id for a in accounts] + [None]


def test_historical_category_parity(history_db):
    db, account_ids = history_db
    full = HistoryIndex.build(db, full=True)
    lazy = HistoryIndex.build(db, full=False)
    hits = 0
    for q in QUERIES:
        for norm in (None, normalize_payee(q) if q.strip() else None, "Unknown"):
            for acc in account_ids:
                for conf in (0.8, 0.55):
                    expected = legacy_find_historical_category(db, q, norm, acc, conf)
                    hits += expected is not None
                    for idx in (full, lazy, None):
                        got = find_historical_category(db, q, norm, acc, conf, index=idx)
                        got_t = (got.category_id, got.normalized_payee, got.match_count, got.total_count) if got else None
                        assert got_t == expected, (q, norm, acc, conf, idx is full)
    assert hits > 50  # the fixture must exercise real matches, not just misses


def test_fallback_parity(history_db):
    db, account_ids = history_db
    full = HistoryIndex.build(db, full=True)
    lazy = HistoryIndex.build(db, full=False)
    for q in QUERIES + [""]:
        for norm in (None, normalize_payee(q) if q.strip() else None, "metro"):
            for acc in account_ids:
                expected = legacy_fallback(db, q, norm, acc)
                existing = {c.id for c in db.query(Category).all()}
                for idx in (full, lazy):
                    got = find_historical_fallback(idx, q, norm, acc)
                    if expected is None:
                        assert got is None, (q, norm, acc)
                        continue
                    tied, conf, total = expected
                    if len(tied) == 1 and not (tied & existing):
                        assert got is None, (q, norm, acc)  # top category was deleted
                        continue
                    if got is None:
                        # Only possible when the first-seen tied winner is a deleted category.
                        assert len(tied) > 1, (q, norm, acc)
                        continue
                    assert got[0] in tied and got[1:] == (conf, total), (q, norm, acc)


def test_notes_parity(history_db):
    db, account_ids = history_db
    hits = 0
    for full in (True, False):
        ctx = ClassificationContext.build(db, full_history=full)
        for note in NOTE_QUERIES:
            for acc in account_ids:
                expected = legacy_notes(db, note, acc)
                hits += expected is not None
                got = _find_historical_by_notes(ctx, note, acc)
                got_t = (got[0].id, got[1], got[2], got[3]) if got else None
                assert got_t == expected, (note, acc, full)
    assert hits > 0


def test_full_index_is_one_query(history_db):
    db, _ = history_db
    engine = db.get_bind()
    count = [0]

    def _count(*_a, **_k):
        count[0] += 1

    event.listen(engine, "before_cursor_execute", _count)
    try:
        idx = HistoryIndex.build(db, full=True)
        for q in QUERIES:
            find_historical_category(db, q, None, None, index=idx)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert count[0] == 1
