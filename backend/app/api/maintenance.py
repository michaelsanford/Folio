"""One-shot maintenance operations for existing installations.

These backfill data that older versions never recorded: balance history (so the
net worth chart has a real series) and transfer pairing (so historical
credit-card payments stop counting as both income and expense).
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.category import Category, CategoryType
from app.models.transaction import Transaction
from app.services.categorization.transfer_matcher import find_potential_transfers
from app.services.snapshots.balance_history import backfill_all

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])


class BackfillSnapshotsResponse(BaseModel):
    snapshots_written: int
    months: int


class DetectTransfersResponse(BaseModel):
    pairs_linked: int
    transactions_scanned: int


@router.post("/backfill-snapshots", response_model=BackfillSnapshotsResponse)
def backfill_snapshots(
    months: int = Query(24, ge=1, le=120, description="How many months of history to reconstruct"),
    db: Session = Depends(get_db),
):
    """Reconstruct month-end balances by replaying transactions from today backwards."""
    written = backfill_all(db, months=months)
    return BackfillSnapshotsResponse(snapshots_written=written, months=months)


@router.post("/detect-transfers", response_model=DetectTransfersResponse)
def detect_transfers(
    window_days: int = Query(3, ge=0, le=14, description="Date tolerance when matching the opposite half"),
    db: Session = Depends(get_db),
):
    """Link offsetting transactions across accounts so they stop reading as cash flow."""
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

        # Either the user already tagged it as a transfer, or we let the amount
        # match speak for itself.
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

        # A tagged transfer is linked outright; an untagged match still needs the
        # amounts to offset exactly, which find_potential_transfers guarantees.
        if not is_tagged_transfer and abs(counterpart.amount + txn.amount) > 0.01:
            continue

        txn.transfer_transaction_id = counterpart.id
        counterpart.transfer_transaction_id = txn.id
        linked += 1

    db.commit()
    return DetectTransfersResponse(pairs_linked=linked, transactions_scanned=len(unpaired))
