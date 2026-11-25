"""Read-only archive of one closed year.

The archive is a small SQLite database holding that year's transactions and
splits, its budgets, its month-end balance snapshots, and the accounts,
categories and household members they refer to, plus an ``archive_info``
row. It is built from the live session with the app's own table definitions
(so it opens in any SQLite tool and matches the vault's schema), then
compressed with zstd and checksummed.

On AWS it is stored in S3 under ``archives/<year>/`` in the Glacier Instant
Retrieval storage class; elsewhere under ``<data dir>/archives/<year>/``.
Nothing is removed from the live vault: the year is locked instead
(``app.core.period_lock``), so the archive stays accurate.
"""
from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.s3_sync import ARCHIVE_PREFIX, compress_file, download_archive, upload_archive
from app.models.account import Account
from app.models.budget import Budget, BudgetItem
from app.models.category import Category
from app.models.household import HouseholdMember
from app.models.snapshot import AccountBalanceSnapshot
from app.models.transaction import Transaction, TransactionSplit

INSERT_CHUNK = 500


@dataclass
class ArchiveResult:
    key: str
    sha256: str
    size: int
    row_counts: dict[str, int]


def _copy(db: Session, conn, table: Table, condition=None) -> int:
    stmt = select(table)
    if condition is not None:
        stmt = stmt.where(condition)
    rows = [dict(r) for r in db.execute(stmt).mappings()]
    for i in range(0, len(rows), INSERT_CHUNK):
        conn.execute(table.insert(), rows[i : i + INSERT_CHUNK])
    return len(rows)


def build_archive_file(db: Session, year: int, closed_by: str | None, dest: Path) -> dict[str, int]:
    """Write the year's plain SQLite archive to ``dest``; returns row counts."""
    start, end = datetime(year, 1, 1), datetime(year + 1, 1, 1)
    in_year = (Transaction.transaction_date >= start) & (Transaction.transaction_date < end)
    year_txn_ids = select(Transaction.id).where(in_year)
    year_budget_ids = select(Budget.id).where(Budget.year == year)

    copies: list[tuple[str, Table, object]] = [
        ("household_members", HouseholdMember.__table__, None),
        ("accounts", Account.__table__, None),
        ("categories", Category.__table__, None),
        ("transactions", Transaction.__table__, in_year),
        ("transaction_splits", TransactionSplit.__table__, TransactionSplit.transaction_id.in_(year_txn_ids)),
        ("budgets", Budget.__table__, Budget.year == year),
        ("budget_items", BudgetItem.__table__, BudgetItem.budget_id.in_(year_budget_ids)),
        (
            "account_balance_snapshots",
            AccountBalanceSnapshot.__table__,
            (AccountBalanceSnapshot.as_of_date >= date(year, 1, 1))
            & (AccountBalanceSnapshot.as_of_date <= date(year, 12, 31)),
        ),
    ]
    info = Table(
        "archive_info",
        MetaData(),
        Column("year", Integer, primary_key=True),
        Column("created_at", String(40)),
        Column("closed_by", String(128)),
        Column("app", String(40)),
    )

    engine = create_engine(f"sqlite:///{dest}")
    try:
        with engine.connect() as conn:
            # Rows point at things that are not archived (statement files, a
            # transfer's other half in another year): keep them as plain ids.
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.exec_driver_sql("PRAGMA journal_mode=DELETE")
            for _, table, _ in copies:
                table.create(conn)
            info.create(conn)
            counts = {name: _copy(db, conn, table, condition) for name, table, condition in copies}
            conn.execute(
                info.insert(),
                {
                    "year": year,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "closed_by": closed_by,
                    "app": settings.PROJECT_NAME,
                },
            )
            conn.commit()
    finally:
        engine.dispose()
    return counts


def _local_archive_dir() -> Path:
    return settings.SQLITE_DB_PATH.parent / "archives"


def create_year_archive(db: Session, year: int, closed_by: str | None) -> ArchiveResult:
    """Build, compress, checksum and store the archive of ``year``."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"folio-{year}-{stamp}.db.zst"
    key = f"{ARCHIVE_PREFIX}{year}/{name}"
    with tempfile.TemporaryDirectory(prefix="folio-archive-") as tmp:
        plain = Path(tmp) / f"folio-{year}.db"
        packed = Path(tmp) / name
        counts = build_archive_file(db, year, closed_by, plain)
        compress_file(plain, packed)
        data = packed.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if settings.s3_sync_enabled:
            upload_archive(packed, key, settings.S3_BUCKET_NAME, settings.AWS_REGION)
        else:
            target = _local_archive_dir() / str(year) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return ArchiveResult(key=key, sha256=digest, size=len(data), row_counts=counts)


def read_year_archive(key: str) -> bytes:
    """Stored (compressed) bytes of an archive."""
    if not key.startswith(ARCHIVE_PREFIX) or ".." in key:
        raise ValueError("Not an archive key")
    if settings.s3_sync_enabled:
        return download_archive(key, settings.S3_BUCKET_NAME, settings.AWS_REGION)
    return (_local_archive_dir() / key.removeprefix(ARCHIVE_PREFIX)).read_bytes()
