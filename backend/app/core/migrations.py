"""Alembic migration runner invoked from the application lifespan.

Replaces ``Base.metadata.create_all()``, which creates missing tables but never
alters existing ones -- so every column change to a deployed database was
silently ignored.
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import settings

logger = logging.getLogger("folio.migrations")

ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.SQLALCHEMY_DATABASE_URI)
    return cfg


def run_migrations() -> None:
    """Bring the database to head, creating it from scratch if it is empty."""
    command.upgrade(_alembic_config(), "head")
    logger.info("Database schema is at head.")
