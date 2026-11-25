"""Whole-vault export to a portable SQLite file, and import back.

An export holds every table with the app's own definitions, so it opens in any
SQLite tool. It is the backup format for teardown and for moving a household
between installs (Docker <-> AWS): the serverless database has no full
``pg_dump``. Exports are zstd-compressed (``.db.zst``).

Import loads an export into an empty database in bounded transactions, so it
works on the serverless database's 3,000-row transaction limit.
"""
from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

from alembic.runtime.migration import MigrationContext
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, func, select, update
from sqlalchemy.orm import Session

from app.core.archive_store import compress_file, decompress_file
from app.core.database import Base
from app.services.archive.yearly import _copy

IMPORT_BATCH = 1000
TRANSFER_COLUMN = "transfer_transaction_id"


def _tables() -> list[Table]:
    return [t for t in Base.metadata.sorted_tables]


def export_database(db: Session, dest: Path) -> dict[str, int]:
    """Write every table to ``dest`` (``.db.zst``); returns row counts."""
    info = Table(
        "export_info",
        MetaData(),
        Column("id", Integer, primary_key=True),
        Column("created_at", String(40)),
        Column("schema_revision", String(40)),
    )
    revision = MigrationContext.configure(db.connection()).get_current_revision()
    with tempfile.TemporaryDirectory(prefix="folio-export-") as tmp:
        plain = Path(tmp) / "folio.db"
        engine = create_engine(f"sqlite:///{plain}")
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
                conn.exec_driver_sql("PRAGMA journal_mode=DELETE")
                for table in _tables():
                    table.create(conn)
                info.create(conn)
                counts = {table.name: _copy(db, conn, table) for table in _tables()}
                conn.execute(
                    info.insert(),
                    {"id": 1, "created_at": datetime.now(timezone.utc).isoformat(), "schema_revision": revision},
                )
                conn.commit()
        finally:
            engine.dispose()
        compress_file(plain, Path(dest))
    return counts


def import_database(db: Session, src: Path) -> dict[str, int]:
    """Load an export into an empty database; returns row counts."""
    for table in _tables():
        if db.execute(select(func.count()).select_from(table)).scalar():
            raise RuntimeError(
                f"Table {table.name} already has rows. Import only into an empty database "
                "(categories and rules seeded by a fresh install count too)."
            )
    counts: dict[str, int] = {}
    with tempfile.TemporaryDirectory(prefix="folio-import-") as tmp:
        plain = Path(tmp) / "folio.db"
        decompress_file(Path(src), plain)
        engine = create_engine(f"sqlite:///{plain}")
        try:
            with engine.connect() as source:
                links: list[tuple[str, str]] = []
                for table in _tables():
                    rows = [dict(r) for r in source.execute(select(table)).mappings()]
                    if TRANSFER_COLUMN in table.c:
                        # Self-references go in after every row exists.
                        links = [(r["id"], r[TRANSFER_COLUMN]) for r in rows if r.get(TRANSFER_COLUMN)]
                        rows = [{**r, TRANSFER_COLUMN: None} for r in rows]
                    for i in range(0, len(rows), IMPORT_BATCH):
                        db.execute(table.insert(), rows[i : i + IMPORT_BATCH])
                        db.commit()
                    counts[table.name] = len(rows)
                    if links:
                        for i in range(0, len(links), IMPORT_BATCH):
                            for row_id, other in links[i : i + IMPORT_BATCH]:
                                db.execute(
                                    update(table).where(table.c.id == row_id).values({TRANSFER_COLUMN: other})
                                )
                            db.commit()
                        links = []
        finally:
            engine.dispose()
    return counts
