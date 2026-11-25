from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

# Every session runs at REPEATABLE READ, the only level the serverless database
# offers. Using it locally too means a write that loses a race fails the same
# way in development and tests as it does on AWS (see core/db_retry.py).
ISOLATION_LEVEL = "REPEATABLE READ"

# Connections live at most 60 minutes on the serverless database; recycle well
# before that so a pooled connection is never cut mid-request.
POOL_RECYCLE_SECONDS = 50 * 60


def build_engine(url: str | None = None, **kwargs) -> Engine:
    """Engine for the configured database.

    With DSQL_ENDPOINT set the engine signs in with short-lived IAM tokens
    through the DSQL connector; otherwise DATABASE_URL (local Postgres) is used.
    """
    options = {"pool_pre_ping": True, "pool_recycle": POOL_RECYCLE_SECONDS, **kwargs}
    if url is None and settings.is_dsql:
        from aurora_dsql_sqlalchemy import create_dsql_engine

        engine = create_dsql_engine(
            host=settings.DSQL_ENDPOINT,
            user=settings.DSQL_USER,
            application_name="folio",
            # One Lambda container serves one request at a time.
            pool_size=options.pop("pool_size", 2),
            max_overflow=options.pop("max_overflow", 2),
            connect_args={"region": settings.AWS_REGION},
            **options,
        )
    else:
        options.setdefault("isolation_level", ISOLATION_LEVEL)
        engine = create_engine(url or settings.DATABASE_URL, **options)
    _use_utc_sessions(engine)
    return engine


def _use_utc_sessions(engine: Engine) -> None:
    """Store and read timestamps as UTC wall time on every connection.

    Columns are `timestamp without time zone`; the app writes aware UTC values,
    which Postgres converts using the session time zone.
    """

    @event.listens_for(engine, "connect")
    def _set_utc(dbapi_connection, connection_record):
        autocommit = getattr(dbapi_connection, "autocommit", None)
        if autocommit is False:
            dbapi_connection.autocommit = True
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET TIME ZONE 'UTC'")
        finally:
            cursor.close()
            if autocommit is False:
                dbapi_connection.autocommit = False


engine = build_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator:
    """FastAPI database session dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
