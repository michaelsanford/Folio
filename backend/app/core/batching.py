"""Commit long-running bulk writes in bounded transactions.

The serverless database refuses a transaction that changes more than 3,000
rows (or 10 MiB). Bulk paths that can touch an unbounded number of rows --
applying rules to every uncategorized transaction, pairing transfers across
the whole ledger, deleting an account's history -- count the rows they change
and commit every ``ROWS_PER_COMMIT``.

Each batch is its own transaction: a failure part-way leaves the earlier
batches saved. Every caller here is idempotent (re-running applies only what
is still missing), so running it again finishes the job.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

# Leaves room under the 3,000-row limit for rows a flush adds on its own
# (learned rules, snapshots) alongside the counted ones.
ROWS_PER_COMMIT = 2000


class BatchCommitter:
    def __init__(self, db: Session, rows_per_commit: int = ROWS_PER_COMMIT):
        self.db = db
        self.rows_per_commit = rows_per_commit
        self.pending = 0
        self.commits = 0

    def changed(self, rows: int = 1) -> None:
        """Record ``rows`` changed rows; commit when the batch is full."""
        self.pending += rows
        if self.pending >= self.rows_per_commit:
            self.commit()

    def commit(self) -> None:
        if self.pending:
            self.db.commit()
            self.commits += 1
            self.pending = 0


@contextmanager
def batched_commits(db: Session, rows_per_commit: int = ROWS_PER_COMMIT):
    """Yield a BatchCommitter; commit the remainder on a clean exit.

    Loaded objects are not expired between batches (the loop keeps using
    them), so each commit costs no reload queries.
    """
    previous = db.expire_on_commit
    db.expire_on_commit = False
    committer = BatchCommitter(db, rows_per_commit)
    try:
        yield committer
        committer.commit()
    finally:
        db.expire_on_commit = previous


def delete_in_batches(db: Session, model, *where, batch: int = ROWS_PER_COMMIT) -> int:
    """DELETE the rows of ``model`` matching ``where``, committing every ``batch`` rows."""
    total = 0
    while True:
        ids = db.scalars(select(model.id).where(*where).limit(batch)).all()
        if not ids:
            return total
        db.execute(
            delete(model).where(model.id.in_(ids)),
            execution_options={"synchronize_session": False},
        )
        db.commit()
        total += len(ids)


def update_in_batches(db: Session, model, values: dict, *where, batch: int = ROWS_PER_COMMIT) -> int:
    """UPDATE the rows of ``model`` matching ``where`` (which must stop matching
    once updated), committing every ``batch`` rows."""
    total = 0
    while True:
        ids = db.scalars(select(model.id).where(*where).limit(batch)).all()
        if not ids:
            return total
        db.execute(
            update(model).where(model.id.in_(ids)).values(**values),
            execution_options={"synchronize_session": False},
        )
        db.commit()
        total += len(ids)
