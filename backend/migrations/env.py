import os
from logging.config import fileConfig

from sqlalchemy import pool

from alembic import context

from app.core.config import settings
from app.core.database import Base, build_engine
import app.models  # noqa: F401 - registers every model with Base metadata

config = context.config

# The application runs migrations with configure_logger=False: its JSON logging
# is already set up and fileConfig would replace it. From the alembic CLI the
# ini's logging applies, without disabling loggers that already exist.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# Schema changes on the serverless database are made as its admin role, which
# owns the tables; the app's own role only reads and writes rows.
DSQL_MIGRATION_USER = os.getenv("DSQL_MIGRATION_USER", "admin")


def _url() -> str | None:
    """An explicit URL (tests, the CLI's -x url=...) wins over settings."""
    return (
        config.attributes.get("url")
        or context.get_x_argument(as_dictionary=True).get("url")
        or (None if settings.is_dsql else settings.DATABASE_URL)
    )


def run_migrations_offline() -> None:
    context.configure(
        url=_url() or settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _url()
    if url is None:
        from aurora_dsql_sqlalchemy import create_dsql_engine

        connectable = create_dsql_engine(
            host=settings.DSQL_ENDPOINT,
            user=DSQL_MIGRATION_USER,
            application_name="folio-migrate",
            pool_size=1,
            max_overflow=0,
            connect_args={"region": settings.AWS_REGION},
        )
    else:
        connectable = build_engine(url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # The serverless dialect commits after every DDL statement (one DDL per
        # transaction is all it allows), so each revision commits on its own;
        # Postgres runs each revision as one transaction.
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
