"""Deploy-time database tasks.

    uv run python -m app.cli migrate [--app-role-arn ARN]
    uv run python -m app.cli export folio-backup.db.zst
    uv run python -m app.cli import folio-backup.db.zst

Brings the schema to head, seeds the default categories and rules, and, on the
serverless database, makes sure the app's own database role exists, may read
and write every table, and is mapped to the Lambda's IAM role. deploy.ps1 runs
it from the deployer's machine after `sam deploy`, signed in as the database
admin; the app itself never changes the schema on AWS.

Locally the same command migrates and seeds the DATABASE_URL database.

``export`` writes every table to a portable, compressed SQLite file (the
teardown backup); ``import`` loads one into an empty, migrated database
(run ``migrate`` first, then import before anything else writes to it).
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys

from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger("folio.cli")

_ROLE_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
_ARN_RE = re.compile(r"^arn:aws[a-z-]*:iam::\d{12}:role/[\w+=,.@/-]{1,512}$")


def _admin_engine():
    if not settings.is_dsql:
        from app.core.database import build_engine

        return build_engine(settings.DATABASE_URL)
    from app.core.database import dsql_engine

    return dsql_engine(os.getenv("DSQL_MIGRATION_USER", "admin"), "folio-migrate", pool_size=1, max_overflow=0)


def ensure_app_role(engine, role: str, iam_role_arn: str | None) -> None:
    """Create the app's login role, grant it row access, and map it to IAM."""
    if not _ROLE_RE.match(role):
        raise ValueError(f"Invalid database role name: {role!r}")
    if iam_role_arn and not _ARN_RE.match(iam_role_arn):
        raise ValueError(f"Invalid IAM role ARN: {iam_role_arn!r}")

    # Each statement in its own transaction: the serverless database allows one
    # DDL statement per transaction.
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        exists = conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first()
        if not exists:
            conn.execute(text(f"CREATE ROLE {role} WITH LOGIN"))
            logger.info("Created database role %s", role)
        # Every role may use the public schema already (it is a system entity
        # there and cannot be granted on); grant row access table by table.
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        ).scalars().all()
        for table in tables:
            if not _ROLE_RE.match(table):
                continue
            conn.execute(text(f'GRANT SELECT, INSERT, UPDATE, DELETE ON public."{table}" TO {role}'))
        if iam_role_arn:
            mapped = conn.execute(
                text("SELECT 1 FROM sys.iam_pg_role_mappings WHERE pg_role_name = :r AND arn = :a"),
                {"r": role, "a": iam_role_arn},
            ).first()
            if not mapped:
                conn.execute(text(f"AWS IAM GRANT {role} TO '{iam_role_arn}'"))
                logger.info("Mapped database role %s to %s", role, iam_role_arn)


def seed(engine, attempts: int = 5) -> None:
    """Seed default categories and rules, retrying a conflict (idempotent).

    After schema changes a pooled connection's catalog can be stale (OC001);
    a retry on a fresh connection picks up the new catalog.
    """
    from app.core.db_retry import is_write_conflict
    from app.main import seed_defaults_with
    from sqlalchemy.exc import DBAPIError

    for attempt in range(1, attempts + 1):
        engine.dispose()
        try:
            with Session(engine) as db:
                seed_defaults_with(db)
            return
        except DBAPIError as exc:
            if not is_write_conflict(exc) or attempt == attempts:
                raise
            logger.info("Seeding conflicted (%s); retrying", exc.orig.__class__.__name__)


def migrate(app_role_arn: str | None = None) -> None:
    from app.core.migrations import alembic_config

    command.upgrade(alembic_config(), "head")
    engine = _admin_engine()
    try:
        if settings.is_dsql:
            ensure_app_role(engine, settings.DSQL_USER, app_role_arn)
        seed(engine)
    finally:
        engine.dispose()
    logger.info("Database ready")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    m = sub.add_parser("migrate", help="migrate, grant the app role and seed defaults")
    m.add_argument("--app-role-arn", help="IAM role the app runs as (serverless database only)")
    e = sub.add_parser("export", help="write every table to a .db.zst file")
    e.add_argument("path")
    i = sub.add_parser("import", help="load a .db.zst export into an empty database")
    i.add_argument("path")
    args = parser.parse_args(argv)
    if args.command == "migrate":
        migrate(args.app_role_arn)
    elif args.command in ("export", "import"):
        from pathlib import Path

        from app.services.archive.export import export_database, import_database

        engine = _admin_engine()
        try:
            with Session(engine) as db:
                if args.command == "export":
                    counts = export_database(db, Path(args.path))
                else:
                    _clear_seeded_defaults(db)
                    counts = import_database(db, Path(args.path))
        finally:
            engine.dispose()
        total = sum(counts.values())
        logger.info("%s %d rows (%s)", "Exported" if args.command == "export" else "Imported", total,
                    ", ".join(f"{k} {v}" for k, v in counts.items() if v))
    return 0


def _clear_seeded_defaults(db: Session) -> None:
    """A fresh install seeds categories and rules; the export brings its own."""
    from app.models.category import Category
    from app.models.rule import CategorizationRule
    from app.models.transaction import Transaction

    if db.query(Transaction.id).first() is not None:
        raise RuntimeError("This database already has transactions; import only into a fresh install.")
    db.query(CategorizationRule).delete(synchronize_session=False)
    db.commit()
    db.query(Category).filter(Category.parent_id.isnot(None)).delete(synchronize_session=False)
    db.query(Category).delete(synchronize_session=False)
    db.commit()


if __name__ == "__main__":
    sys.exit(main())
