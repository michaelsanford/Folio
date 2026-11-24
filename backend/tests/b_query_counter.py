"""Test helper: record the SQL statements a block of code executes."""
from contextlib import contextmanager

from sqlalchemy import event


@contextmanager
def count_queries(db):
    engine = db.get_bind()
    statements: list[str] = []

    def _record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _record)
