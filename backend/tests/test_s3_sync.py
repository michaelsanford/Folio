"""S3 vault persistence (Lambda only): conditional uploads, fail-closed restore,
freshness, and discarding a change that could not be uploaded."""
import logging
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core import s3_sync
from app.core.config import settings
from app.core.s3_sync import (
    S3_DB_KEY,
    S3RestoreError,
    VaultConflictError,
    VaultSyncFailedError,
    discard_local_changes,
    ensure_db_fresh,
    restore_db_from_s3,
    startup_restore,
    sync_db_to_s3,
    sync_now,
)
from app.core.sync_scheduler import sync_scheduler
from tests.a_fake_s3 import FakeS3, client_error

BUCKET = "my-vault-bucket"


@pytest.fixture(autouse=True)
def clean_sync_state(monkeypatch):
    # S3 sync only ever runs on Lambda.
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio")
    s3_sync._last_known_etag = None
    s3_sync._last_fresh_check = 0.0
    s3_sync._local_untrusted = False
    sync_scheduler.reset()
    yield
    s3_sync._last_known_etag = None
    s3_sync._last_fresh_check = 0.0
    s3_sync._local_untrusted = False
    sync_scheduler.reset()


@pytest.fixture
def fake_s3():
    fake = FakeS3()
    with patch("app.core.s3_sync.get_s3_client", return_value=fake):
        yield fake


@pytest.fixture
def no_migrations():
    with patch("app.core.migrations.run_migrations") as run:
        yield run


def _make_db(path: Path, value: str = "local") -> Path:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE IF NOT EXISTS t (v TEXT)")
    conn.execute("DELETE FROM t")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    conn.close()
    return path


def _db_bytes(tmp_path: Path, value: str) -> bytes:
    path = _make_db(tmp_path / f"src-{value}.db", value)
    return path.read_bytes()


def _read_value(path: Path) -> str:
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute("SELECT v FROM t").fetchone()[0]
    finally:
        conn.close()


# ---------------------------------------------------------------- client cache

def test_s3_client_is_cached_per_region():
    s3_sync._clients.clear()
    try:
        first = s3_sync.get_s3_client("ca-central-1")
        assert first is s3_sync.get_s3_client("ca-central-1")
    finally:
        s3_sync._clients.clear()


# --------------------------------------------------------------------- restore

def test_restore_db_no_bucket_returns_false():
    assert restore_db_from_s3(Path("/tmp/test_folio.db"), "") is False


def test_restore_db_success_tracks_the_downloaded_etag(fake_s3, tmp_path):
    etag = fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "remote"))
    db_path = tmp_path / "folio.db"

    assert restore_db_from_s3(db_path, BUCKET) is True
    assert _read_value(db_path) == "remote"
    assert s3_sync._last_known_etag == etag


def test_restore_db_404_starts_fresh(fake_s3, tmp_path):
    assert restore_db_from_s3(tmp_path / "folio.db", BUCKET) is False
    assert s3_sync._last_known_etag is None


def test_restore_fails_closed(fake_s3, tmp_path, caplog):
    fake_s3.seed(BUCKET, S3_DB_KEY, b"x")
    fake_s3.fail_get_with = client_error("AccessDenied", 403, "GetObject")

    with caplog.at_level(logging.ERROR, logger="folio.s3_sync"):
        with pytest.raises(S3RestoreError):
            restore_db_from_s3(tmp_path / "folio.db", BUCKET)
    assert any(getattr(r, "event", None) == "s3_restore_failed" for r in caplog.records)


def test_restore_throttling_error_also_fails_closed(fake_s3, tmp_path):
    fake_s3.fail_get_with = client_error("SlowDown", 503, "GetObject")
    with pytest.raises(S3RestoreError):
        restore_db_from_s3(tmp_path / "folio.db", BUCKET)


def test_restore_without_a_client_fails_closed(tmp_path):
    with patch("app.core.s3_sync.get_s3_client", return_value=None):
        with pytest.raises(S3RestoreError):
            restore_db_from_s3(tmp_path / "folio.db", BUCKET)


def test_startup_always_restores_over_a_stale_local_file(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db", "stale")
    fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "remote"))

    assert startup_restore(db_path, BUCKET) is True
    assert _read_value(db_path) == "remote"


def test_startup_restores_when_local_db_missing(fake_s3, tmp_path):
    fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "remote"))
    db_path = tmp_path / "data" / "folio.db"

    assert startup_restore(db_path, BUCKET) is True
    assert _read_value(db_path) == "remote"


# ---------------------------------------------------------------------- upload

def test_first_upload_is_create_only(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db")

    assert sync_db_to_s3(db_path, BUCKET) is True
    call = fake_s3.put_calls[-1]
    assert call["IfNoneMatch"] == "*"
    assert "IfMatch" not in call
    assert "ServerSideEncryption" not in call, "bucket default encryption applies"
    assert s3_sync._last_known_etag == fake_s3.etag(BUCKET, S3_DB_KEY)


def test_subsequent_upload_is_conditional_on_last_etag(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db")
    assert sync_db_to_s3(db_path, BUCKET) is True
    first_etag = s3_sync._last_known_etag

    _make_db(db_path, "changed")
    assert sync_db_to_s3(db_path, BUCKET) is True
    assert fake_s3.put_calls[-1]["IfMatch"] == first_etag
    assert s3_sync._last_known_etag != first_etag


def test_upload_snapshot_is_a_valid_database(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db", "snap")
    assert sync_db_to_s3(db_path, BUCKET) is True
    uploaded = tmp_path / "uploaded.db"
    uploaded.write_bytes(fake_s3.read(BUCKET, S3_DB_KEY))
    assert _read_value(uploaded) == "snap"
    assert not list(tmp_path.glob(".folio-snapshot-*")), "temp snapshot must be removed"


def test_upload_refused_when_remote_exists_but_was_never_loaded(fake_s3, tmp_path, caplog):
    fake_s3.seed(BUCKET, S3_DB_KEY, b"the real vault")
    db_path = _make_db(tmp_path / "folio.db", "empty")

    with caplog.at_level(logging.ERROR, logger="folio.s3_sync"):
        assert sync_db_to_s3(db_path, BUCKET) is False
    assert fake_s3.put_calls == []
    assert fake_s3.read(BUCKET, S3_DB_KEY) == b"the real vault"
    assert any(getattr(r, "event", None) == "s3_sync_failed" for r in caplog.records)


def test_upload_failure_returns_false_and_logs(fake_s3, tmp_path, caplog):
    db_path = _make_db(tmp_path / "folio.db")
    fake_s3.fail_put_with = client_error("InternalError", 500, "PutObject")
    with caplog.at_level(logging.ERROR, logger="folio.s3_sync"):
        assert sync_db_to_s3(db_path, BUCKET) is False
    assert any(getattr(r, "event", None) == "s3_sync_failed" for r in caplog.records)


def test_conflict_reloads_remote_and_raises(fake_s3, tmp_path, no_migrations, caplog):
    db_path = _make_db(tmp_path / "folio.db", "mine")
    assert sync_db_to_s3(db_path, BUCKET) is True

    # Another container writes a newer vault.
    other_etag = fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "theirs"))
    _make_db(db_path, "mine-2")
    sync_scheduler._dirty = True

    with caplog.at_level(logging.WARNING, logger="folio.s3_sync"):
        with pytest.raises(VaultConflictError):
            sync_db_to_s3(db_path, BUCKET)

    assert any(getattr(r, "event", None) == "s3_sync_conflict" for r in caplog.records)
    assert _read_value(db_path) == "theirs", "local copy must be replaced by the winner"
    assert s3_sync._last_known_etag == other_etag
    assert sync_scheduler.has_pending_changes() is False
    no_migrations.assert_called_once()


# ------------------------------------------------------------------- freshness

def test_ensure_db_fresh_downloads_and_migrates_when_etag_changes(fake_s3, tmp_path, no_migrations):
    db_path = _make_db(tmp_path / "folio.db", "old")
    wal_path = Path(f"{db_path}-wal")
    wal_path.write_bytes(b"stale-wal")
    new_etag = fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "new"))
    s3_sync._last_known_etag = '"etag-old"'

    with patch("app.core.database.engine.dispose") as dispose:
        assert ensure_db_fresh(db_path, BUCKET) is True

    dispose.assert_called_once()
    assert not wal_path.exists()
    assert _read_value(db_path) == "new"
    assert s3_sync._last_known_etag == new_etag
    no_migrations.assert_called_once()


def test_ensure_db_fresh_skips_when_etag_matches(fake_s3, tmp_path):
    s3_sync._last_known_etag = fake_s3.seed(BUCKET, S3_DB_KEY, b"same")
    assert ensure_db_fresh(tmp_path / "folio.db", BUCKET) is False
    assert fake_s3.get_calls == 0


def test_ensure_db_fresh_skips_when_local_changes_pending(fake_s3, tmp_path):
    with patch.object(sync_scheduler, "has_pending_changes", return_value=True):
        assert ensure_db_fresh(tmp_path / "folio.db", BUCKET) is False
    assert fake_s3.head_calls == 0


def test_ensure_db_fresh_checks_s3_at_most_once_per_second(fake_s3, tmp_path):
    s3_sync._last_known_etag = fake_s3.seed(BUCKET, S3_DB_KEY, b"same")
    for _ in range(25):
        ensure_db_fresh(tmp_path / "folio.db", BUCKET)
    assert fake_s3.head_calls == 1

    s3_sync._last_fresh_check -= s3_sync.FRESHNESS_INTERVAL_SECONDS
    ensure_db_fresh(tmp_path / "folio.db", BUCKET)
    assert fake_s3.head_calls == 2


def test_ensure_db_fresh_logs_warning_when_head_fails(fake_s3, tmp_path, caplog):
    fake_s3.fail_head_with = client_error("AccessDenied", 403, "HeadObject")
    with caplog.at_level(logging.WARNING, logger="folio.s3_sync"):
        assert ensure_db_fresh(tmp_path / "folio.db", BUCKET) is False
    assert any(r.levelno == logging.WARNING for r in caplog.records)


# ------------------------------------------------- failed upload is discarded

@pytest.fixture
def lambda_vault(monkeypatch, tmp_path):
    """settings pointed at a tmp vault on Lambda with a bucket configured."""
    db_path = tmp_path / "folio.db"
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", BUCKET)
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", db_path)
    return db_path


def test_sync_now_discards_a_change_that_failed_to_upload(fake_s3, lambda_vault, tmp_path, no_migrations):
    s3_sync._last_known_etag = fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "durable"))
    _make_db(lambda_vault, "unsaved edit")
    sync_scheduler.mark_dirty()
    fake_s3.fail_put_with = client_error("InternalError", 500, "PutObject")

    with patch("app.core.database.engine.dispose"):
        with pytest.raises(VaultSyncFailedError):
            sync_now()

    assert _read_value(lambda_vault) == "durable", "the local copy must equal S3 again"
    assert sync_scheduler.has_pending_changes() is False
    assert s3_sync._local_untrusted is False


def test_sync_now_returns_false_when_sync_is_disabled(fake_s3, monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", BUCKET)
    assert sync_now() is False
    assert fake_s3.put_calls == [] and fake_s3.head_calls == 0 and fake_s3.get_calls == 0


def test_discard_when_the_vault_never_reached_s3_rebuilds_empty(fake_s3, tmp_path, no_migrations):
    db_path = _make_db(tmp_path / "folio.db", "never uploaded")
    with patch("app.core.database.engine.dispose"):
        assert discard_local_changes(db_path, BUCKET) is True
    assert not db_path.exists()
    no_migrations.assert_called_once()


def test_failed_reload_marks_the_local_copy_untrusted(fake_s3, tmp_path, no_migrations, caplog):
    db_path = _make_db(tmp_path / "folio.db", "unsaved edit")
    remote = fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "durable"))
    s3_sync._last_known_etag = remote
    fake_s3.fail_get_with = client_error("SlowDown", 503, "GetObject")

    with caplog.at_level(logging.ERROR, logger="folio.s3_sync"):
        with patch("app.core.database.engine.dispose"):
            assert discard_local_changes(db_path, BUCKET) is False
    assert any(getattr(r, "event", None) == "s3_sync_failed" for r in caplog.records)
    assert s3_sync._local_untrusted is True
    assert s3_sync._last_known_etag is None, "no upload may overwrite S3 from this copy"

    # The next request refuses to serve the untrusted copy while S3 is down...
    with patch("app.core.database.engine.dispose"):
        with pytest.raises(VaultSyncFailedError):
            ensure_db_fresh(db_path, BUCKET)
    assert _read_value(db_path) == "unsaved edit"

    # ...and reloads it, bypassing the freshness throttle, once S3 answers.
    fake_s3.fail_get_with = None
    s3_sync._last_fresh_check = 10**12
    with patch("app.core.database.engine.dispose"):
        assert ensure_db_fresh(db_path, BUCKET) is True
    assert _read_value(db_path) == "durable"
    assert s3_sync._local_untrusted is False
    assert s3_sync._last_known_etag == remote


def test_untrusted_copy_cannot_be_uploaded_over_the_vault(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db", "unsaved edit")
    fake_s3.seed(BUCKET, S3_DB_KEY, _db_bytes(tmp_path, "durable"))
    s3_sync._local_untrusted = True
    s3_sync._last_known_etag = None
    assert sync_db_to_s3(db_path, BUCKET) is False
    assert fake_s3.put_calls == []


# ------------------------------------------------------------- compression

def test_uploads_are_zstd_compressed(fake_s3, tmp_path):
    db_path = _make_db(tmp_path / "folio.db", "x" * 50_000)
    assert sync_db_to_s3(db_path, BUCKET) is True
    put = fake_s3.put_calls[-1]
    assert put["Key"] == "database/folio.db.zst"
    assert put["ContentType"] == "application/zstd"
    assert put["size"] < db_path.stat().st_size / 4
    restored = tmp_path / "check.db"
    restored.write_bytes(fake_s3.read(BUCKET, S3_DB_KEY))
    assert _read_value(restored) == "x" * 50_000


def test_a_legacy_plain_vault_is_restored_then_rewritten_compressed(fake_s3, tmp_path, no_migrations, monkeypatch):
    from app.core.s3_sync import LEGACY_DB_KEY

    monkeypatch.setattr(settings, "S3_BUCKET_NAME", BUCKET)  # Lambda with a bucket: changes are tracked

    fake_s3.seed(BUCKET, LEGACY_DB_KEY, _db_bytes(tmp_path, "from before compression"))
    db_path = tmp_path / "folio.db"

    assert restore_db_from_s3(db_path, BUCKET) is True
    assert _read_value(db_path) == "from before compression"
    # The compressed key does not exist yet; the vault waits to be written there.
    assert s3_sync._last_known_etag is None
    assert sync_scheduler.has_pending_changes() is True

    assert sync_db_to_s3(db_path, BUCKET) is True
    assert fake_s3.put_calls[-1]["IfNoneMatch"] == "*"
    copy = tmp_path / "copy.db"
    copy.write_bytes(fake_s3.read(BUCKET, S3_DB_KEY))
    assert _read_value(copy) == "from before compression"
    # From now on the compressed copy is the vault.
    assert restore_db_from_s3(tmp_path / "again.db", BUCKET) is True
    assert s3_sync._last_known_etag == fake_s3.etag(BUCKET, S3_DB_KEY)
