from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

from app.core.config import settings
from app.core.database import Base
import app.models  # noqa: F401 - registers every model with Base.metadata

config = context.config

# Connection URL always comes from application settings, never from alembic.ini,
# so migrations follow SQLITE_DB_PATH in every environment (local, Docker, Lambda /tmp).
config.set_main_option("sqlalchemy.url", settings.SQLALCHEMY_DATABASE_URI)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _set_sqlite_foreign_keys(connection, enabled: bool) -> None:
    """Toggle FK enforcement on the raw DBAPI connection.

    Batch mode rebuilds a table by copying it and dropping the original. With
    foreign keys enforced, dropping the old table fires ON DELETE CASCADE and
    wipes dependent rows -- migrating `accounts` would silently delete every
    transaction and split.

    Issued through the raw DBAPI cursor on purpose: `PRAGMA foreign_keys` is a
    no-op inside a transaction, and going through the SQLAlchemy connection would
    implicitly open one, which would also swallow the migration's own commit.
    """
    if connection.dialect.name != "sqlite":
        return
    cursor = connection.connection.cursor()
    try:
        cursor.execute(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}")
    finally:
        cursor.close()


def _assert_no_dangling_references(connection) -> None:
    """Fail loudly if a rebuild left orphaned rows behind."""
    if connection.dialect.name != "sqlite":
        return
    cursor = connection.connection.cursor()
    try:
        violations = cursor.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        cursor.close()
    if violations:
        raise RuntimeError(f"Migration left dangling references: {violations[:5]}")


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _set_sqlite_foreign_keys(connection, False)

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite cannot ALTER COLUMN; batch mode rebuilds the table instead.
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()

        _assert_no_dangling_references(connection)
        _set_sqlite_foreign_keys(connection, True)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
