from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.sql.elements import TextClause

from app.core.config import settings

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and foreign key constraints for SQLite."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ---------------------------------------------------------------------------
# Central change tracking for S3 sync.
#
# Every commit that actually wrote something marks the database dirty, so no
# endpoint has to remember to call sync_db_if_configured(). A flush that emitted
# ORM changes, or a bulk UPDATE/DELETE/INSERT executed through the session, sets
# session.info[_CHANGED]; after_commit consumes the flag and a rollback clears it.
# Read-only requests (whose sessions still "commit" or close) never mark dirty.
# ---------------------------------------------------------------------------
_CHANGED = "folio_changed"
_DML_PREFIXES = ("insert", "update", "delete", "replace")


@event.listens_for(Session, "after_flush")
def _flag_flush_changes(session, flush_context):
    if session.new or session.dirty or session.deleted:
        session.info[_CHANGED] = True


@event.listens_for(Session, "do_orm_execute")
def _flag_bulk_dml(orm_execute_state):
    statement = orm_execute_state.statement
    if orm_execute_state.is_insert or orm_execute_state.is_update or orm_execute_state.is_delete:
        orm_execute_state.session.info[_CHANGED] = True
    elif isinstance(statement, TextClause) and statement.text.lstrip().lower().startswith(_DML_PREFIXES):
        orm_execute_state.session.info[_CHANGED] = True


@event.listens_for(Session, "after_commit")
def _mark_dirty_on_commit(session):
    if session.info.pop(_CHANGED, False):
        from app.core.sync_scheduler import sync_scheduler

        sync_scheduler.mark_dirty()


@event.listens_for(Session, "after_rollback")
def _clear_on_rollback(session):
    session.info.pop(_CHANGED, None)


def get_db() -> Generator[Session, None, None]:
    """FastAPI database session dependency."""
    if settings.s3_sync_enabled:
        from app.core.s3_sync import ensure_db_fresh

        ensure_db_fresh(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
