"""One-shot maintenance operations for existing installations.

These backfill data that older versions never recorded: balance history (so the
net worth chart has a real series) and transfer pairing (so historical
credit-card payments stop counting as both income and expense).

Production guard: endpoints that overwrite or wipe data in bulk
(seed-demo-data, which can wipe the vault with force=true, and
backfill-snapshots, which overwrites recorded balance history with
reconstructed values) return 403 when FOLIO_ENV is prod/production.
Both also need a household OWNER. detect-transfers stays available: it only links unpaired offsetting
transactions, never deletes or overwrites data, and is the supported way to
repair transfer pairing on an existing vault.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.actor import require_owner
from app.core.config import settings
from app.core.database import get_db
from app.services.categorization.transfer_matcher import link_offsetting_transfers
from app.services.snapshots.balance_history import backfill_all

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])


def forbid_in_production() -> None:
    """Dependency: refuse destructive bulk operations on a production vault."""
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This maintenance operation is disabled in production.",
        )


class BackfillSnapshotsResponse(BaseModel):
    snapshots_written: int
    months: int


class DetectTransfersResponse(BaseModel):
    pairs_linked: int
    transactions_scanned: int


@router.post(
    "/backfill-snapshots",
    response_model=BackfillSnapshotsResponse,
    dependencies=[Depends(require_owner), Depends(forbid_in_production)],
)
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
    linked, scanned = link_offsetting_transfers(db, window_days=window_days)
    return DetectTransfersResponse(pairs_linked=linked, transactions_scanned=scanned)

class SeedDemoDataResponse(BaseModel):
    message: str
    accounts_count: int
    transactions_count: int
    categories_count: int
    rules_count: int
    goals_count: int
    household_members_count: int
    snapshots_count: int


@router.post(
    "/seed-demo-data",
    response_model=SeedDemoDataResponse,
    dependencies=[Depends(require_owner), Depends(forbid_in_production)],
)
def seed_demo_data(
    force: bool = Query(False, description="Wipe and recreate demo data even if data exists"),
    db: Session = Depends(get_db),
):
    """Seed comprehensive Canadian demo dataset with household accounts, budgets, goals, and 90-day ledger history."""
    from app.services.seed.demo_seeder import seed_canadian_demo_dataset

    stats = seed_canadian_demo_dataset(db, force=force)
    return SeedDemoDataResponse(**stats)
