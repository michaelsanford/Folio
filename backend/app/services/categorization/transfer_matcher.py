from datetime import datetime, timedelta
from typing import Any
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, aliased
from app.models.transaction import Transaction
from app.models.account import Account
from app.core.money import to_cents


class TransferMatch:
    def __init__(self, account_id: str, account_name: str, transaction_id: str | None = None):
        self.account_id = account_id
        self.account_name = account_name
        self.transaction_id = transaction_id


def find_potential_transfers(
    db: Session,
    current_account_id: str,
    transaction_date: datetime,
    amount: float,
    window_days: int = 3,
) -> TransferMatch | None:
    """
    Searches for an opposing transaction in other accounts within ±window_days.
    e.g. If current transaction is -$500, looks for an existing +$500 transaction in another account.
    """
    # Exact integer comparison: with cents storage the old +/-0.01 float
    # tolerance is unnecessary and could match a genuinely different amount.
    opposing_cents = -to_cents(amount)
    start_date = transaction_date - timedelta(days=window_days)
    end_date = transaction_date + timedelta(days=window_days)

    # Search existing transactions in other accounts
    match = (
        db.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(
            Transaction.account_id != current_account_id,
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date,
            Transaction.amount_cents == opposing_cents,
            Transaction.transfer_transaction_id.is_(None),  # Not already paired
        )
        .first()
    )

    if match:
        return TransferMatch(
            account_id=match.account_id,
            account_name=match.account.name if match.account else "Unknown Account",
            transaction_id=match.id,
        )

    # If no exact transaction found, check if there is an active account that could be a target
    # e.g., if checking account payment says "AUTOPAY CHASE CREDIT CARD", detect Chase account
    return None


_ID_CHUNK = 500


def _candidate_pairs(db: Session, window_days: int, anchor_ids: list[str] | None) -> list[tuple]:
    """Offsetting (outflow, inflow) candidates from one self-join per id chunk.

    Matches opposite ``amount_cents`` in a *different* account where both sides
    are still unpaired. SQLite stores datetimes as text, so the join uses a
    window one day wider than requested (cheap, index-friendly) and the exact
    +/- ``window_days`` check is applied in Python on real datetimes.
    """
    a = aliased(Transaction)
    b = aliased(Transaction)
    slack = window_days + 1
    base = (
        db.query(
            a.id, a.amount_cents, a.transaction_date,
            b.id, b.transaction_date,
        )
        .join(
            b,
            and_(
                b.amount_cents == -a.amount_cents,
                b.account_id != a.account_id,
                b.transfer_transaction_id.is_(None),
                b.transaction_date >= func.datetime(a.transaction_date, f"-{slack} days"),
                b.transaction_date <= func.datetime(a.transaction_date, f"+{slack} days"),
            ),
        )
        .filter(a.transfer_transaction_id.is_(None), a.amount_cents != 0)
    )

    window = timedelta(days=window_days)
    pairs: list[tuple] = []

    def _collect(rows) -> None:
        for a_id, a_cents, a_date, b_id, b_date in rows:
            if abs(b_date - a_date) > window:
                continue
            # Normalise to (outflow, inflow) so each pair is seen once from one side.
            if a_cents < 0:
                pairs.append((a_date, abs(b_date - a_date), a_id, b_id))
            else:
                pairs.append((b_date, abs(b_date - a_date), b_id, a_id))

    if anchor_ids is None:
        _collect(base.filter(a.amount_cents < 0).all())
    else:
        for i in range(0, len(anchor_ids), _ID_CHUNK):
            _collect(base.filter(a.id.in_(anchor_ids[i : i + _ID_CHUNK])).all())
    return pairs


def link_offsetting_transfers(
    db: Session,
    window_days: int = 3,
    transaction_ids: list[str] | None = None,
) -> tuple[int, int]:
    """Link offsetting transactions across accounts so they stop reading as cash flow.

    With ``transaction_ids`` (the import path) only pairs involving those rows
    are considered -- the previous implementation walked every unpaired
    transaction in the vault with several queries each (~90k statements and
    30+ s at 50k rows) after every import. Without it, every unpaired outflow
    is considered (the maintenance ``detect-transfers`` repair).

    Pairing is greedy: outflows in date order, each taking the closest
    unpaired counterpart. Returns ``(pairs_linked, transactions_scanned)``.
    """
    if transaction_ids is not None:
        anchor_ids = list(dict.fromkeys(i for i in transaction_ids if i))
        if not anchor_ids:
            return 0, 0
        scanned = len(anchor_ids)
    else:
        anchor_ids = None
        scanned = (
            db.query(func.count(Transaction.id))
            .filter(Transaction.transfer_transaction_id.is_(None))
            .scalar()
        ) or 0

    pairs = _candidate_pairs(db, window_days, anchor_ids)
    if not pairs:
        return 0, scanned

    pairs.sort(key=lambda p: (p[0], p[1], p[2], p[3]))
    used: set[str] = set()
    chosen: list[tuple[str, str]] = []
    for _, _, out_id, in_id in pairs:
        if out_id in used or in_id in used:
            continue
        used.add(out_id)
        used.add(in_id)
        chosen.append((out_id, in_id))

    ids = list(used)
    by_id: dict[str, Transaction] = {}
    for i in range(0, len(ids), _ID_CHUNK):
        for txn in db.query(Transaction).filter(Transaction.id.in_(ids[i : i + _ID_CHUNK])).all():
            by_id[txn.id] = txn

    linked = 0
    for out_id, in_id in chosen:
        out_txn, in_txn = by_id.get(out_id), by_id.get(in_id)
        if out_txn is None or in_txn is None:
            continue
        if out_txn.transfer_transaction_id or in_txn.transfer_transaction_id:
            continue
        out_txn.transfer_transaction_id = in_txn.id
        in_txn.transfer_transaction_id = out_txn.id
        linked += 1

    if linked > 0:
        db.commit()

    return linked, scanned


def annotate_in_batch_transfers(
    items: list[Any],
    account_labels: dict[str, str],
    window_days: int = 3,
) -> None:
    """Highlight offsetting transfers across different accounts inside a multi-account preview."""
    parsed_meta: list[tuple[int, str, datetime, int]] = []
    for idx, item in enumerate(items):
        key = getattr(item, "source_account_key", None)
        cents = to_cents(getattr(item, "amount", 0.0))
        if not key or cents == 0:
            continue
        try:
            dt = datetime.strptime(str(item.transaction_date)[:10], "%Y-%m-%d")
        except ValueError:
            continue
        parsed_meta.append((idx, key, dt, cents))

    paired_indices: set[int] = set()
    for pos, (idx_a, key_a, dt_a, cents_a) in enumerate(parsed_meta):
        if idx_a in paired_indices or cents_a >= 0:
            continue
        for idx_b, key_b, dt_b, cents_b in parsed_meta[pos + 1 :]:
            if idx_b in paired_indices or key_a == key_b:
                continue
            if cents_a == -cents_b and abs((dt_a - dt_b).days) <= window_days:
                item_a = items[idx_a]
                item_b = items[idx_b]
                if not item_a.potential_transfer_account_name:
                    item_a.potential_transfer_account_name = account_labels.get(key_b)
                    if not item_a.potential_transfer_account_id and item_b.account_id:
                        item_a.potential_transfer_account_id = item_b.account_id
                if not item_b.potential_transfer_account_name:
                    item_b.potential_transfer_account_name = account_labels.get(key_a)
                    if not item_b.potential_transfer_account_id and item_a.account_id:
                        item_b.potential_transfer_account_id = item_a.account_id
                paired_indices.add(idx_a)
                paired_indices.add(idx_b)
                break
