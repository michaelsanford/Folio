"""Closing a year: lock its transactions and keep a read-only archive.

Closing year Y locks every transaction dated on or before Dec 31 of Y (see
``app.core.period_lock``) and stores an archive of the year in cold storage.
Reopening clears the lock and keeps the archive. Owners close and reopen;
anyone signed in can see which years are closed and download an archive.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.core.actor import Actor, attribution_labels, require_owner
from app.core.database import get_db
from app.core.period_lock import closed_through_year
from app.core.visibility import can_see_all, unrestricted
from app.models.period_closure import PeriodClosure
from app.models.transaction import Transaction
from app.services.archive.yearly import archive_account_ids, create_year_archive, read_year_archive

logger = logging.getLogger("folio.periods")

router = APIRouter(prefix="/periods", tags=["Closed years"])


class ClosureResponse(BaseModel):
    year: int
    closed_through: date
    closed_at: datetime
    closed_by_name: str | None = None
    is_active: bool
    reopened_at: datetime | None = None
    archive_available: bool
    archive_bytes: int | None = None
    archive_sha256: str | None = None
    row_counts: dict[str, int] | None = None


class PeriodsResponse(BaseModel):
    # Transactions dated on or before Dec 31 of this year are locked.
    closed_through_year: int | None
    closures: list[ClosureResponse]
    # Past years that have transactions and are not closed.
    closable_years: list[int]


def _error(code: int, slug: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": slug, "message": message})


def _closure_response(row: PeriodClosure, labels: dict[str, str]) -> ClosureResponse:
    return ClosureResponse(
        year=row.year,
        closed_through=row.closed_through,
        closed_at=row.closed_at,
        closed_by_name=labels.get(row.closed_by) if row.closed_by else None,
        is_active=row.is_active,
        reopened_at=row.reopened_at,
        archive_available=bool(row.archive_key),
        archive_bytes=row.archive_bytes,
        archive_sha256=row.archive_sha256,
        row_counts=row.row_counts,
    )


def _transaction_years(db: Session) -> list[int]:
    # Closing locks the whole household's year, private accounts included.
    with unrestricted():
        years = db.scalars(
            select(func.distinct(extract("year", Transaction.transaction_date)))
        ).all()
    return sorted(int(y) for y in years if y)


@router.get("", response_model=PeriodsResponse)
def list_periods(db: Session = Depends(get_db)):
    rows = db.scalars(select(PeriodClosure).order_by(PeriodClosure.year.desc())).all()
    labels = attribution_labels(db, [r.closed_by for r in rows])
    through = closed_through_year(db)
    current_year = date.today().year
    closable = [
        y
        for y in _transaction_years(db)
        if y < current_year and (through is None or y > through)
    ]
    return PeriodsResponse(
        closed_through_year=through,
        closures=[_closure_response(r, labels) for r in rows],
        closable_years=sorted(closable, reverse=True),
    )


@router.post("/{year}/close", response_model=ClosureResponse)
def close_year(
    year: int,
    request: Request,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Lock the year and archive it. Only a year that has ended can be closed."""
    # The archive is written outside the vault; never build it twice.
    request.state.no_replay = True
    if year >= date.today().year:
        raise _error(status.HTTP_400_BAD_REQUEST, "year_not_over", f"{year} isn't over yet.")
    if year < 1900:
        raise _error(status.HTTP_400_BAD_REQUEST, "invalid_year", "That year can't be closed.")
    row = db.get(PeriodClosure, year)
    if row is not None and row.is_active:
        raise _error(status.HTTP_409_CONFLICT, "already_closed", f"{year} is already closed.")

    try:
        # Complete whoever closes it: the archive is the household's record.
        with unrestricted():
            archive = create_year_archive(db, year, actor.user_key)
    except Exception as exc:
        logger.exception("Archiving %s failed", year)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "archive_failed",
            f"{year} wasn't closed: its archive couldn't be saved. Please try again.",
        ) from exc

    now = datetime.now(timezone.utc)
    if row is None:
        row = PeriodClosure(year=year)
        db.add(row)
    row.closed_through = date(year, 12, 31)
    row.closed_by = actor.user_key
    row.closed_at = now
    row.archive_key = archive.key
    row.archive_sha256 = archive.sha256
    row.archive_bytes = archive.size
    row.row_counts = archive.row_counts
    row.reopened_at = None
    row.reopened_by = None
    db.commit()
    db.refresh(row)
    logger.info("Closed %s (%s transactions archived)", year, archive.row_counts.get("transactions"))
    return _closure_response(row, attribution_labels(db, [row.closed_by]))


@router.post("/{year}/reopen", response_model=ClosureResponse)
def reopen_year(year: int, actor: Actor = Depends(require_owner), db: Session = Depends(get_db)):
    """Unlock the year. Its archive is kept as it was when the year was closed."""
    row = db.get(PeriodClosure, year)
    if row is None or not row.is_active:
        raise _error(status.HTTP_404_NOT_FOUND, "not_closed", f"{year} isn't closed.")
    row.reopened_at = datetime.now(timezone.utc)
    row.reopened_by = actor.user_key
    db.commit()
    db.refresh(row)
    return _closure_response(row, attribution_labels(db, [row.closed_by]))


@router.get("/{year}/archive")
def download_year_archive(year: int, db: Session = Depends(get_db)):
    """The year's archive: a zstd-compressed SQLite file."""
    row = db.get(PeriodClosure, year)
    if row is None or not row.archive_key:
        raise _error(status.HTTP_404_NOT_FOUND, "no_archive", f"There is no archive of {year}.")
    try:
        data = read_year_archive(row.archive_key)
        hidden = not can_see_all(db, archive_account_ids(data))
    except FileNotFoundError as exc:
        raise _error(status.HTTP_404_NOT_FOUND, "no_archive", f"The archive of {year} is missing.") from exc
    except Exception as exc:
        logger.exception("Reading the archive of %s failed", year)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "archive_unavailable", "The archive couldn't be read. Please try again."
        ) from exc
    if hidden:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "archive_has_hidden_accounts",
            "This archive includes accounts that aren’t visible to you.",
        )
    return Response(
        content=data,
        media_type="application/zstd",
        headers={
            "Content-Disposition": f'attachment; filename="folio-{year}.db.zst"',
            "X-Archive-SHA256": row.archive_sha256 or "",
        },
    )
