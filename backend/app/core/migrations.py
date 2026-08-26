"""Alembic migration runner invoked from the application lifespan.

Replaces ``Base.metadata.create_all()``, which creates missing tables but never
alters existing ones -- so every column change to a deployed database was
silently ignored.
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect

from app.core.config import settings
from app.core.database import engine

logger = logging.getLogger("folio.migrations")

ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"

# Revision that represents the schema as it existed under the create_all era.
BASELINE_REVISION = "0001"


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.SQLALCHEMY_DATABASE_URI)
    return cfg


def _needs_baseline_stamp() -> bool:
    """True when tables exist but Alembic has never tracked this database.

    That is a database created by the old ``create_all()`` startup path; stamping
    it at the baseline lets subsequent revisions apply without trying to recreate
    tables that are already there.
    """
    with engine.connect() as conn:
        if MigrationContext.configure(conn).get_current_revision() is not None:
            return False
        return bool(inspect(conn).get_table_names())


def run_migrations() -> None:
    cfg = _alembic_config()
    if _needs_baseline_stamp():
        logger.info("Untracked pre-existing database detected; stamping baseline %s.", BASELINE_REVISION)
        command.stamp(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")
    logger.info("Database schema is at head.")
