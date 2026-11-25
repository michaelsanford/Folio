"""Schema migrations at startup.

Local and Docker installs bring their Postgres database to head on startup:
each Alembic revision runs as one transaction, so a failed upgrade rolls back.

On AWS the schema belongs to the deploy step (deploy.ps1 runs `alembic upgrade
head` as the database admin), never to a request-serving container: the app's
own role cannot change the schema, and several cold starts must not race to
migrate. There the app only checks that the database is at a revision it knows.
"""
import logging

from alembic import command
from alembic.config import Config
from alembic.ddl.postgresql import PostgresqlImpl
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("folio.migrations")


class AuroraDSQLImpl(PostgresqlImpl):
    """Alembic's Postgres operations for the serverless database's dialect.

    Defining the subclass registers it for the "auroradsql" dialect name, for
    both migrations (env.py) and the startup revision check. DDL is not
    transactional there: the dialect commits after every statement.
    """

    __dialect__ = "auroradsql"
    transactional_ddl = False


ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"


class SchemaOutOfDateError(RuntimeError):
    """The database is behind this build and this process may not migrate it."""


def alembic_config(url: str | None = None) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    if url:
        cfg.attributes["url"] = url
    # env.py must not run fileConfig() here: it would replace the application's
    # JSON log handler and (by default) disable every existing logger.
    cfg.attributes["configure_logger"] = False
    return cfg


def current_revision(engine=None) -> str | None:
    """The revision recorded in alembic_version, or None for an empty database."""
    if engine is None:
        from app.core.database import engine
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def run_migrations(engine=None, url: str | None = None) -> bool:
    """Bring the database to head where allowed. Returns True when an upgrade ran."""
    cfg = alembic_config(url)
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()
    current = current_revision(engine)

    if current == head:
        logger.info(f"Database schema already at head ({head}).")
        return False

    if current is not None:
        try:
            known = script.get_revision(current) is not None
        except Exception:
            known = False
        if not known:
            # A newer deployment migrated the database past this code.
            # Downgrading is never safe; serve it and let the old code retire.
            logger.warning(
                f"Database revision {current} is unknown to this build (head {head}); "
                "skipping migrations."
            )
            return False

    if settings.is_dsql:
        raise SchemaOutOfDateError(
            f"Database schema is at {current or 'empty'}, this build needs {head}. "
            "Run the deploy step (alembic upgrade head) before serving traffic."
        )

    command.upgrade(cfg, "head")
    logger.info(f"Database schema migrated from {current or 'empty'} to {head}.")
    return True
