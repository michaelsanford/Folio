"""Alembic migration runner invoked from the application lifespan.

Replaces ``Base.metadata.create_all()``, which creates missing tables but never
alters existing ones -- so every column change to a deployed database was
silently ignored.

Cold starts are cheap: when ``alembic_version`` already equals the script head,
Alembic is not invoked at all. When a real upgrade is needed the database is
first copied with the SQLite backup API (keeping the last few copies locally)
and, when an S3 bucket is configured, uploaded to
``backups/pre-migrate-<rev>-<ts>.db``.
"""
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.core.config import settings

logger = logging.getLogger("folio.migrations")

ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"
LOCAL_BACKUPS_TO_KEEP = 3


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.SQLALCHEMY_DATABASE_URI)
    # env.py must not run fileConfig() here: it would replace the application's
    # JSON log handler and (by default) disable every existing logger.
    cfg.attributes["configure_logger"] = False
    return cfg


def current_revision(db_path: Path) -> str | None:
    """The revision recorded in alembic_version, or None (missing DB or table)."""
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def _has_user_tables(db_path: Path) -> bool:
    if not db_path.exists() or db_path.stat().st_size == 0:
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).fetchone()
        return row is not None
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def backup_database(db_path: Path, revision: str | None) -> Path:
    """Copy the database next to itself with the online backup API.

    Named <db>.pre-migrate-<rev>-<ts>.bak; only the newest LOCAL_BACKUPS_TO_KEEP
    are kept so repeated deploys cannot fill the disk (Lambda /tmp especially).
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    label = revision or "base"
    target = db_path.with_name(f"{db_path.name}.pre-migrate-{label}-{ts}.bak")
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(str(target))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()

    existing = sorted(
        db_path.parent.glob(f"{db_path.name}.pre-migrate-*.bak"),
        key=lambda p: (p.stat().st_mtime, p.name),
        reverse=True,
    )
    for stale in existing[LOCAL_BACKUPS_TO_KEEP:]:
        try:
            stale.unlink()
        except OSError as exc:
            logger.warning(f"Could not prune old migration backup {stale}: {exc}")
    logger.info(f"Pre-migration backup written to {target}")

    if settings.S3_BUCKET_NAME:
        from app.core.s3_sync import BACKUP_PREFIX, upload_backup

        key = f"{BACKUP_PREFIX}pre-migrate-{label}-{ts}.db"
        upload_backup(target, key, settings.S3_BUCKET_NAME, settings.AWS_REGION)
    return target


def run_migrations() -> bool:
    """Bring the database to head. Returns True when an upgrade actually ran."""
    cfg = _alembic_config()
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()
    db_path = settings.SQLITE_DB_PATH
    current = current_revision(db_path)

    if current is not None and current == head:
        logger.info(f"Database schema already at head ({head}); skipping migrations.")
        return False

    if current is not None:
        try:
            known = script.get_revision(current) is not None
        except Exception:
            known = False
        if not known:
            # A newer deployment migrated the shared vault past this code.
            # Downgrading is never safe; serve it and let the old code retire.
            logger.warning(
                f"Database revision {current} is unknown to this build (head {head}); "
                "skipping migrations."
            )
            return False

    if _has_user_tables(db_path):
        backup_database(db_path, current)

    command.upgrade(cfg, "head")
    logger.info(f"Database schema migrated from {current or 'empty'} to {head}.")
    return True
