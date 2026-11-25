"""Closed years cannot change.

Closing year Y (``period_closures``) locks every transaction dated before
Jan 1 of Y+1: the books are closed *through* Dec 31 of the latest open
closure. A ``before_flush`` listener refuses any new, changed or deleted
transaction (or split of one) on a locked date, wherever it comes from, with
``PeriodClosedError`` (409 ``period_closed``).

Bulk paths (applying rules, auto-classification, transfer matching, imports)
filter locked rows out first with ``locked_before`` / ``open_period``, so one
old row never fails a whole batch.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import event, func, inspect, select, true
from sqlalchemy.orm import Session

from app.models.period_closure import PeriodClosure
from app.models.transaction import Transaction, TransactionSplit


class PeriodClosedError(Exception):
    """A change touched a transaction in a closed year."""

    def __init__(self, year: int):
        self.year = year
        super().__init__(f"{year} is closed. An owner can reopen it.")


def closed_through_year(db: Session) -> int | None:
    """Latest year whose books are closed (and not reopened), if any."""
    return db.scalar(select(func.max(PeriodClosure.year)).where(PeriodClosure.reopened_at.is_(None)))


_CACHE_KEY = "folio_locked_before"
_UNSET = object()


def locked_before(db: Session) -> datetime | None:
    """Transactions dated before this instant are locked; None when nothing is.

    Looked up once per session transaction (the flush check and a bulk path's
    filter share it); a commit or rollback forgets it.
    """
    cached = db.info.get(_CACHE_KEY, _UNSET)
    if cached is not _UNSET:
        return cached
    year = closed_through_year(db)
    boundary = datetime(year + 1, 1, 1) if year is not None else None
    db.info[_CACHE_KEY] = boundary
    return boundary


@event.listens_for(Session, "after_commit")
@event.listens_for(Session, "after_rollback")
def _forget_boundary(session: Session) -> None:
    session.info.pop(_CACHE_KEY, None)


def open_period(db: Session, column=Transaction.transaction_date):
    """SQL condition keeping rows that are still editable (always true when none are locked)."""
    boundary = locked_before(db)
    return column >= boundary if boundary is not None else true()


def _naive(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return datetime(value.year, value.month, value.day)


def _parent(session: Session, split: TransactionSplit) -> Transaction | None:
    parent = split.__dict__.get("transaction")
    if parent is None and split.transaction_id:
        with session.no_autoflush:
            parent = session.get(Transaction, split.transaction_id)
    return parent


@event.listens_for(Session, "before_flush")
def _refuse_changes_in_closed_years(session: Session, flush_context, instances) -> None:
    touched = [
        obj
        for obj in (*session.new, *session.dirty, *session.deleted)
        if isinstance(obj, (Transaction, TransactionSplit))
    ]
    if not touched:
        return
    with session.no_autoflush:
        boundary = locked_before(session)
    if boundary is None:
        return

    def check(when) -> None:
        when = _naive(when)
        if when is not None and when < boundary:
            raise PeriodClosedError(boundary.year - 1)

    for obj in touched:
        if obj in session.dirty and not session.is_modified(obj, include_collections=False):
            continue
        if isinstance(obj, Transaction):
            check(obj.transaction_date)
            if obj in session.dirty:
                # Moving a transaction out of (or into) a closed year is a change to it too.
                for old in inspect(obj).attrs.transaction_date.history.deleted:
                    check(old)
        else:
            parent = _parent(session, obj)
            if parent is not None:
                check(parent.transaction_date)
