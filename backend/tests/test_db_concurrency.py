"""Write conflicts, request replay and bounded transactions."""
import psycopg
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from datetime import datetime

from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session

from app.api import ingestion as ingestion_api
from app.core.batching import batched_commits, delete_in_batches
from app.core.db_retry import (
    DbRetryMiddleware,
    is_write_conflict,
    retry_on_conflict,
    write_conflict_response,
)
from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit
from tests.conftest import engine


def _conflict() -> OperationalError:
    return OperationalError("UPDATE ...", {}, psycopg.errors.SerializationFailure("could not serialize access"))


def _app(fail_times: int, *, no_replay: bool = False):
    calls = {"n": 0, "bodies": []}
    app = FastAPI()

    @app.exception_handler(DBAPIError)
    async def _handler(request: Request, exc: DBAPIError):
        request.state.db_conflict = True
        return write_conflict_response()

    @app.post("/save")
    async def save(request: Request):
        calls["n"] += 1
        calls["bodies"].append(await request.body())
        if no_replay:
            request.state.no_replay = True
        if calls["n"] <= fail_times:
            raise _conflict()
        return {"ok": True, "attempt": calls["n"]}

    app.add_middleware(DbRetryMiddleware, delay_seconds=0)
    return app, calls


def test_a_conflict_is_replayed_with_the_same_body():
    app, calls = _app(fail_times=2)
    resp = TestClient(app).post("/save", content=b'{"amount": 12}', headers={"content-type": "application/json"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "attempt": 3}
    assert calls["bodies"] == [b'{"amount": 12}'] * 3


def test_every_attempt_losing_answers_write_conflict():
    app, calls = _app(fail_times=10)
    resp = TestClient(app).post("/save", json={})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "write_conflict"
    assert calls["n"] == 3


def test_no_replay_routes_are_not_repeated():
    app, calls = _app(fail_times=1, no_replay=True)
    resp = TestClient(app).post("/save", json={})
    assert resp.status_code == 409
    assert calls["n"] == 1


def test_conflict_codes_are_recognised():
    assert is_write_conflict(_conflict())
    assert not is_write_conflict(OperationalError("x", {}, psycopg.errors.UniqueViolation("dup")))
    assert not is_write_conflict(ValueError("nope"))


def test_two_sessions_saving_the_same_row_conflict():
    """REPEATABLE READ: the second writer of a row fails instead of overwriting."""
    with Session(engine) as setup:
        setup.add(Account(id="race-acct", name="race", type=AccountType.CHECKING, current_balance=0.0))
        setup.commit()
    first, second = Session(engine), Session(engine)
    try:
        a = first.get(Account, "race-acct")
        b = second.get(Account, "race-acct")
        a.current_balance_cents = 100
        first.commit()
        b.current_balance_cents = 200
        with pytest.raises(DBAPIError) as caught:
            second.commit()
        assert is_write_conflict(caught.value)
    finally:
        first.close()
        second.close()
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM accounts WHERE id = 'race-acct'"))


def test_retry_on_conflict_runs_the_step_again(db_session):
    attempts = []

    def work():
        attempts.append(1)
        if len(attempts) < 3:
            raise _conflict()
        return "done"

    assert retry_on_conflict(db_session, work) == "done"
    assert len(attempts) == 3


def _count_commits(db):
    commits = []
    listener = lambda session: commits.append(1)  # noqa: E731
    event.listen(db, "after_commit", listener)
    return commits, lambda: event.remove(db, "after_commit", listener)


def test_batched_commits_bound_each_transaction(db_session, sample_checking_account):
    commits, stop = _count_commits(db_session)
    try:
        with batched_commits(db_session, rows_per_commit=10) as batch:
            for i in range(25):
                db_session.add(Transaction(transaction_date=datetime(2026, 3, 1), account_id=sample_checking_account.id, raw_payee=f"r{i}", amount=-1.0))
                batch.changed()
    finally:
        stop()
    assert len(commits) == 3  # 10 + 10 + the remaining 5
    assert db_session.query(Transaction).count() == 25


def test_delete_in_batches_removes_every_row(db_session, sample_checking_account):
    for i in range(7):
        db_session.add(Transaction(transaction_date=datetime(2026, 3, 1), account_id=sample_checking_account.id, raw_payee=f"d{i}", amount=-1.0))
    db_session.commit()
    deleted = delete_in_batches(db_session, Transaction, Transaction.account_id == sample_checking_account.id, batch=3)
    assert deleted == 7
    assert db_session.query(Transaction).count() == 0


def _items(n: int, prefix: str = "h"):
    return [
        {
            "transaction_date": f"2026-0{1 + i % 9}-{1 + i % 28:02d}",
            "raw_payee": f"Shop {i}",
            "normalized_payee": f"Shop {i}",
            "amount": -1.0 - i,
            "import_hash": f"{prefix}-{i}",
        }
        for i in range(n)
    ]


def test_a_large_import_lands_in_batches(client, db_session, sample_checking_account, monkeypatch):
    monkeypatch.setattr(ingestion_api, "IMPORT_BATCH_ROWS", 40)
    commits, stop = _count_commits(db_session)
    try:
        resp = client.post(
            "/api/ingestion/commit",
            json={"account_id": sample_checking_account.id, "items": _items(130), "auto_detect_transfers": False},
        )
    finally:
        stop()
    assert resp.status_code == 200, resp.text
    assert resp.json()["committed_count"] == 130
    assert len(commits) >= 4  # three full batches, then the rest with the rules
    assert db_session.query(Transaction).count() == 130


def test_an_interrupted_import_finishes_when_run_again(client, db_session, sample_checking_account, monkeypatch):
    monkeypatch.setattr(ingestion_api, "IMPORT_BATCH_ROWS", 40)
    items = _items(100)
    calls = {"n": 0}
    real = ingestion_api.auto_learn_rules_bulk

    def fail_once(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("lost the connection")
        return real(*args, **kwargs)

    monkeypatch.setattr(ingestion_api, "auto_learn_rules_bulk", fail_once)
    first = client.post("/api/ingestion/commit", json={"account_id": sample_checking_account.id, "items": items})
    assert first.status_code == 500
    assert "80 rows were already saved" in first.json()["detail"]
    assert db_session.query(Transaction).count() == 80

    second = client.post("/api/ingestion/commit", json={"account_id": sample_checking_account.id, "items": items})
    assert second.status_code == 200, second.text
    assert second.json()["committed_count"] == 20
    assert db_session.query(Transaction).count() == 100


def test_deleting_an_account_clears_the_other_half_of_its_transfers(client, db_session, sample_checking_account):
    savings = Account(name="Savings", type=AccountType.SAVINGS, current_balance=0.0)
    db_session.add(savings)
    db_session.flush()
    out = Transaction(transaction_date=datetime(2026, 3, 1), account_id=sample_checking_account.id, raw_payee="To savings", amount=-50.0)
    inn = Transaction(transaction_date=datetime(2026, 3, 1), account_id=savings.id, raw_payee="From chequing", amount=50.0)
    out.splits.append(TransactionSplit(amount=-50.0))
    db_session.add_all([out, inn])
    db_session.flush()
    out.transfer_transaction_id, inn.transfer_transaction_id = inn.id, out.id
    db_session.commit()

    resp = client.delete(f"/api/accounts/{sample_checking_account.id}")
    assert resp.status_code == 204
    db_session.expire_all()
    remaining = db_session.get(Transaction, inn.id)
    assert remaining is not None and remaining.transfer_transaction_id is None
    assert db_session.query(Transaction).filter(Transaction.account_id == sample_checking_account.id).count() == 0
    assert db_session.get(Account, sample_checking_account.id) is None
