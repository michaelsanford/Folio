"""Central dirty tracking (session events) and the Lambda flush middleware."""
from unittest.mock import patch

import pytest
from sqlalchemy import text, update

from app.core import s3_sync
from app.core.config import settings
from app.core.s3_sync import S3_DB_KEY, VaultConflictError
from app.core.sync_scheduler import sync_scheduler
from app.models.household import HouseholdMember
from tests.a_fake_s3 import FakeS3


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


def test_lambda_failed_flush_keeps_changes_pending(client, lambda_mode):
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=False):
        resp = client.post("/api/household/members", json={"name": "Lee", "role": "Self"})
    assert resp.status_code in (200, 201)
    assert sync_scheduler.has_pending_changes() is True


def test_lambda_conflict_returns_409_vault_conflict(client, lambda_mode, tmp_path):
    import sqlite3

    # The local file the snapshot is taken from.
    conn = sqlite3.connect(str(settings.SQLITE_DB_PATH))
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.commit()
    conn.close()

    fake = FakeS3()
    fake.seed("vault-bucket", S3_DB_KEY, b"written by another container")
    s3_sync._last_known_etag = '"an-older-version"'

    with (
        patch("app.core.s3_sync.get_s3_client", return_value=fake),
        patch("app.core.migrations.run_migrations"),
        patch("app.core.database.engine.dispose"),
    ):
        resp = client.post("/api/household/members", json={"name": "Casey", "role": "Self"})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "vault_conflict"
    assert fake.put_calls[-1]["IfMatch"] == '"an-older-version"'
    # The winner was re-downloaded and nothing is left pending.
    assert settings.SQLITE_DB_PATH.read_bytes() == b"written by another container"
    assert sync_scheduler.has_pending_changes() is False


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
