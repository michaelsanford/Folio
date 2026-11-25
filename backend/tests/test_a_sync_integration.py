"""Central dirty tracking (session events), the Lambda flush middleware, and
the guarantee that Docker / local runs never talk to S3."""
import logging
import sqlite3
from unittest.mock import patch

import pytest
from sqlalchemy import text, update

from app.core import s3_sync
from app.core.config import settings
from app.core.s3_sync import S3_DB_KEY, VaultConflictError
from app.core.sync_scheduler import sync_scheduler
from app.models.household import HouseholdMember
from tests.a_fake_s3 import FakeS3, client_error


@pytest.fixture
def mark_dirty():
    with patch.object(sync_scheduler, "mark_dirty") as mocked:
        yield mocked


# ------------------------------------------------------------- session events

def test_commit_with_orm_changes_marks_dirty(db_session, mark_dirty):
    mark_dirty.reset_mock()
    db_session.add(HouseholdMember(name="Alex"))
    db_session.commit()
    mark_dirty.assert_called_once()


def test_read_only_commit_does_not_mark_dirty(db_session, mark_dirty):
    mark_dirty.reset_mock()
    db_session.query(HouseholdMember).all()
    db_session.commit()
    db_session.execute(text("SELECT 1"))
    db_session.commit()
    mark_dirty.assert_not_called()


def test_bulk_update_marks_dirty(db_session, mark_dirty):
    db_session.add(HouseholdMember(name="Sam"))
    db_session.commit()
    mark_dirty.reset_mock()

    db_session.execute(update(HouseholdMember).values(name="Sam R."))
    db_session.commit()
    mark_dirty.assert_called_once()


def test_raw_sql_write_marks_dirty(db_session, mark_dirty):
    db_session.add(HouseholdMember(name="Kim"))
    db_session.commit()
    mark_dirty.reset_mock()

    db_session.execute(text("UPDATE household_members SET name = 'Kim L.'"))
    db_session.commit()
    mark_dirty.assert_called_once()


def test_rolled_back_changes_do_not_mark_dirty(db_session, mark_dirty):
    mark_dirty.reset_mock()
    db_session.add(HouseholdMember(name="Pat"))
    db_session.flush()
    db_session.rollback()
    db_session.commit()
    mark_dirty.assert_not_called()


def test_endpoint_commit_marks_dirty_without_explicit_sync_call(client, mark_dirty):
    mark_dirty.reset_mock()
    resp = client.post("/api/household/members", json={"name": "Jordan", "role": "Self"})
    assert resp.status_code in (200, 201), resp.text
    assert mark_dirty.called


# ------------------------------------------------------------ Lambda middleware

@pytest.fixture
def lambda_mode(client, monkeypatch, tmp_path):
    """Lambda runtime with a bucket; requested after `client` so it is undone
    before the app's shutdown flush runs."""
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "vault-bucket")
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", tmp_path / "folio.db")
    sync_scheduler.reset()
    yield
    sync_scheduler.reset()
    s3_sync._last_known_etag = None
    s3_sync._local_untrusted = False


def _local_vault(value: str) -> None:
    """The local file the middleware snapshots (the test API uses in-memory SQLite)."""
    conn = sqlite3.connect(str(settings.SQLITE_DB_PATH))
    conn.execute("CREATE TABLE IF NOT EXISTS t (v TEXT)")
    conn.execute("DELETE FROM t")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    conn.close()


def test_lambda_mutation_is_flushed_before_the_response(client, lambda_mode):
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        resp = client.post("/api/household/members", json={"name": "Robin", "role": "Self"})
    assert resp.status_code in (200, 201), resp.text
    upload.assert_called_once()
    assert sync_scheduler.has_pending_changes() is False


def test_lambda_read_does_not_upload(client, lambda_mode):
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        assert client.get("/api/household/members").status_code == 200
    upload.assert_not_called()


def test_lambda_failed_upload_returns_503_and_discards_the_change(client, lambda_mode, tmp_path):
    durable = tmp_path / "durable.db"
    conn = sqlite3.connect(str(durable))
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES ('durable')")
    conn.commit()
    conn.close()
    durable_bytes = durable.read_bytes()

    fake = FakeS3()
    s3_sync._last_known_etag = fake.seed("vault-bucket", S3_DB_KEY, durable_bytes)
    _local_vault("unsaved edit")
    fake.fail_put_with = client_error("InternalError", 500, "PutObject")

    with (
        patch("app.core.s3_sync.get_s3_client", return_value=fake),
        patch("app.core.migrations.run_migrations"),
        patch("app.core.database.engine.dispose"),
    ):
        resp = client.post("/api/household/members", json={"name": "Lee", "role": "Self"})

    assert resp.status_code == 503
    assert resp.json() == {
        "detail": {"code": "vault_sync_failed", "message": "Your change wasn't saved. Please try again."}
    }
    assert len(fake.put_calls) == 1, "a failed upload is not retried within the request"
    # The un-uploaded change is gone: the local vault is the S3 copy again.
    assert settings.SQLITE_DB_PATH.read_bytes() == durable_bytes
    assert sync_scheduler.has_pending_changes() is False
    assert s3_sync._local_untrusted is False


def test_lambda_failed_upload_and_failed_reload_still_503(client, lambda_mode, tmp_path, caplog):
    fake = FakeS3()
    s3_sync._last_known_etag = fake.seed("vault-bucket", S3_DB_KEY, b"durable")
    _local_vault("unsaved edit")
    fake.fail_put_with = client_error("InternalError", 500, "PutObject")
    fake.fail_get_with = client_error("SlowDown", 503, "GetObject")

    with (
        caplog.at_level(logging.ERROR, logger="folio.s3_sync"),
        patch("app.core.s3_sync.get_s3_client", return_value=fake),
        patch("app.core.migrations.run_migrations"),
        patch("app.core.database.engine.dispose"),
    ):
        resp = client.post("/api/household/members", json={"name": "Lee", "role": "Self"})

    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "vault_sync_failed"
    assert any(getattr(r, "event", None) == "s3_sync_failed" for r in caplog.records)
    # The copy holding the unsaved change is never served or uploaded again.
    assert s3_sync._local_untrusted is True
    assert s3_sync._last_known_etag is None


def test_explicit_sync_failure_in_an_endpoint_maps_to_503(client, lambda_mode, db_session, sample_checking_account):
    from app.api import ingestion as ingestion_api
    from app.core.s3_sync import VaultSyncFailedError

    def failed():
        sync_scheduler.reset()  # as the real sync_now does after discarding
        raise VaultSyncFailedError("upload failed")

    with patch.object(ingestion_api, "sync_now", failed):
        resp = client.post("/api/ingestion/commit", json={
            "account_id": sample_checking_account.id,
            "items": [{
                "transaction_date": "2026-03-01", "raw_payee": "X", "normalized_payee": "X",
                "amount": -1.0, "import_hash": "h-sync-failed",
            }],
        })
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "vault_sync_failed"


# ------------------------------------------------- Docker / local: never S3

def test_bucket_outside_lambda_makes_no_s3_calls(db_session, monkeypatch, caplog):
    """S3_BUCKET_NAME set in Docker / local: startup, writes and reads never
    create or call an S3 client, and startup warns that the bucket is ignored."""
    from fastapi.testclient import TestClient

    from app.core import config
    from app.core.database import get_db
    from app.core.security import require_auth
    from app.main import app

    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "vault-bucket")
    monkeypatch.setattr(config, "_s3_ignored_warned", False)
    assert settings.s3_sync_enabled is False

    # Reuse the real get_db's freshness gate, but hand back the test session.
    def gated_get_db():
        real = get_db()
        next(real)  # runs the s3_sync_enabled check
        real.close()
        yield db_session

    sync_scheduler.reset()
    app.dependency_overrides[get_db] = gated_get_db
    app.dependency_overrides[require_auth] = lambda: {"sub": "test-owner"}
    try:
        with (
            patch("boto3.client", side_effect=AssertionError("no AWS client outside Lambda")) as make_client,
            patch("app.core.s3_sync.get_s3_client", side_effect=AssertionError("no S3 outside Lambda")) as get_client,
            caplog.at_level(logging.WARNING, logger="folio.config"),
        ):
            with TestClient(app) as test_client:
                created = test_client.post("/api/household/members", json={"name": "Dev", "role": "Self"})
                listed = test_client.get("/api/household/members")
    finally:
        app.dependency_overrides.clear()

    assert created.status_code in (200, 201), created.text
    assert listed.status_code == 200
    make_client.assert_not_called()
    get_client.assert_not_called()
    assert sync_scheduler.has_pending_changes() is False
    warnings = [r for r in caplog.records if "S3_BUCKET_NAME is set but ignored" in r.getMessage()]
    assert len(warnings) == 1


def _sqlite_bytes(path, value: str) -> bytes:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE IF NOT EXISTS t (v TEXT)")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    conn.close()
    return path.read_bytes()


@pytest.fixture
def no_replay_pause():
    async def instant(_seconds):
        return None

    with patch("app.core.vault_middleware.asyncio.sleep", instant):
        yield


def test_lambda_conflict_is_replayed_on_the_reloaded_vault(client, lambda_mode, tmp_path, no_replay_pause):
    """Two people save at once: the loser's request runs again on the winner's
    vault and lands, instead of answering 409."""
    _local_vault("mine")
    fake = FakeS3()
    winner = fake.seed("vault-bucket", S3_DB_KEY, _sqlite_bytes(tmp_path / "winner.db", "theirs"))
    s3_sync._last_known_etag = '"an-older-version"'

    with (
        patch("app.core.s3_sync.get_s3_client", return_value=fake),
        patch("app.core.migrations.run_migrations"),
        patch("app.core.database.engine.dispose"),
    ):
        resp = client.post("/api/household/members", json={"name": "Casey", "role": "Self"})

    assert resp.status_code == 201, resp.text
    assert [c["IfMatch"] for c in fake.put_calls] == ['"an-older-version"', winner]
    assert sync_scheduler.has_pending_changes() is False


def test_lambda_conflict_gives_up_after_three_attempts(client, lambda_mode, tmp_path, no_replay_pause):
    _local_vault("mine")
    fake = FakeS3()
    s3_sync._last_known_etag = fake.seed("vault-bucket", S3_DB_KEY, _sqlite_bytes(tmp_path / "w.db", "theirs"))
    fake.fail_put_with = client_error("PreconditionFailed", 412, "PutObject")

    with (
        patch("app.core.s3_sync.get_s3_client", return_value=fake),
        patch("app.core.migrations.run_migrations"),
        patch("app.core.database.engine.dispose"),
    ):
        resp = client.post("/api/household/members", json={"name": "Casey", "role": "Self"})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "vault_conflict"
    assert len(fake.put_calls) == 3
    assert sync_scheduler.has_pending_changes() is False


def _temporary_route(path: str, methods: list[str], endpoint):
    from app.main import app

    app.add_api_route(path, endpoint, methods=methods)
    # Ahead of the SPA catch-all route when a frontend build is present.
    app.router.routes.insert(0, app.router.routes.pop())
    return lambda: setattr(app.router, "routes", [r for r in app.router.routes if getattr(r, "path", "") != path])


def test_replay_sends_the_same_body_and_skips_no_replay_routes(client, lambda_mode, no_replay_pause):
    from fastapi import Request

    seen: list[bytes] = []
    outcomes = iter([VaultConflictError("lost"), True])

    async def echo(request: Request):
        seen.append(await request.body())
        if request.query_params.get("once"):
            request.state.no_replay = True
        sync_scheduler.mark_dirty()
        return {"ok": True}

    def flaky_sync():
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            sync_scheduler.reset()
            raise outcome
        sync_scheduler.reset()
        return True

    remove = _temporary_route("/api/_test_echo", ["POST"], echo)
    try:
        with patch("app.core.vault_middleware.sync_now", flaky_sync):
            resp = client.post("/api/_test_echo", content=b'{"amount": 12.5}', headers={"content-type": "application/json"})
        assert resp.status_code == 200
        assert seen == [b'{"amount": 12.5}', b'{"amount": 12.5}']

        seen.clear()
        outcomes = iter([VaultConflictError("lost")])
        with patch("app.core.vault_middleware.sync_now", lambda: (_ for _ in ()).throw(next(outcomes))):
            resp = client.post("/api/_test_echo?once=1", content=b"x")
        assert resp.status_code == 409
        assert seen == [b"x"], "an invitation-style request is never sent twice"
    finally:
        remove()
        sync_scheduler.reset()


def test_a_read_that_wrote_is_uploaded_before_it_returns(client, lambda_mode):
    from fastapi import Request

    def first_sign_in(request: Request):
        request.state.vault_write = True
        sync_scheduler.mark_dirty()
        return {"ok": True}

    remove = _temporary_route("/api/_test_first_sign_in", ["GET"], first_sign_in)
    try:
        with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
            assert client.get("/api/_test_first_sign_in").status_code == 200
        upload.assert_called_once()
    finally:
        remove()


def test_vault_conflict_raised_by_an_endpoint_maps_to_409(client):
    from app.main import app

    @app.get("/api/_test_conflict")
    def _raise_conflict():
        raise VaultConflictError("boom")

    # Ahead of the SPA catch-all route when a frontend build is present.
    app.router.routes.insert(0, app.router.routes.pop())
    try:
        resp = client.get("/api/_test_conflict")
        assert resp.status_code == 409
        assert resp.json() == {
            "detail": {"code": "vault_conflict", "message": resp.json()["detail"]["message"]}
        }
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", "") != "/api/_test_conflict"]
