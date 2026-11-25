"""Test helper: record the SQL statements a block of code executes."""
from contextlib import contextmanager

from sqlalchemy import event


@contextmanager
def count_queries(db):
    engine = db.get_bind()
    statements: list[str] = []

    def _record(conn, cursor, statement, *args):
        # The test fixture's savepoints are bookkeeping, not the code's queries.
        if not statement.lstrip().upper().startswith(("SAVEPOINT", "RELEASE SAVEPOINT", "ROLLBACK TO SAVEPOINT")):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _record)
