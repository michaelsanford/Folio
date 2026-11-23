from datetime import datetime, timedelta
from typing import Any
from sqlalchemy.orm import Session
from app.models.transaction import Transaction
from app.models.account import Account
from app.models.category import Category, CategoryType
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


def link_offsetting_transfers(db: Session, window_days: int = 3) -> tuple[int, int]:
    """Link offsetting transactions across accounts so they stop reading as cash flow.

    Returns ``(pairs_linked, transactions_scanned)``.
    """
    transfer_category_ids = {
        c.id for c in db.query(Category).filter(Category.type == CategoryType.TRANSFER).all()
    }

    unpaired = (
        db.query(Transaction)
        .filter(Transaction.transfer_transaction_id.is_(None))
        .order_by(Transaction.transaction_date.asc())
        .all()
    )

    linked = 0
    for txn in unpaired:
        if txn.transfer_transaction_id:
            continue  # paired earlier in this same pass

        # Only consider outflows, so each pair is examined once from one side.
        if txn.amount >= 0:
            continue

        is_tagged_transfer = any(
            s.category_id in transfer_category_ids for s in txn.splits
        )

        match = find_potential_transfers(
            db,
            current_account_id=txn.account_id,
            transaction_date=txn.transaction_date,
            amount=txn.amount,
            window_days=window_days,
        )
        if not match or not match.transaction_id:
            continue

        counterpart = db.query(Transaction).filter(Transaction.id == match.transaction_id).first()
        if not counterpart or counterpart.transfer_transaction_id:
            continue

        if not is_tagged_transfer and abs(counterpart.amount + txn.amount) > 0.01:
            continue

        txn.transfer_transaction_id = counterpart.id
        counterpart.transfer_transaction_id = txn.id
        linked += 1

    if linked > 0:
        db.commit()

    return linked, len(unpaired)


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
