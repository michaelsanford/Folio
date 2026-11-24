"""Pending-change tracking for the Lambda S3 flush."""
from unittest.mock import patch

import pytest

from app.core.config import settings
from app.core.sync_scheduler import VaultSyncState


@pytest.fixture
def lambda_with_bucket(monkeypatch, tmp_path):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", tmp_path / "folio.db")


def test_mark_dirty_only_records_a_pending_change(lambda_with_bucket):
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        for _ in range(50):
            state.mark_dirty()
    upload.assert_not_called()
    assert state.has_pending_changes() is True


def test_nothing_is_tracked_or_uploaded_without_a_bucket(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3") as upload:
        state.mark_dirty()
        assert state.has_pending_changes() is False
        assert state.flush() is False
    upload.assert_not_called()


def test_nothing_is_tracked_or_uploaded_outside_lambda(monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "test-bucket")
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3") as upload:
        state.mark_dirty()
        assert state.has_pending_changes() is False
        assert state.flush() is False
    upload.assert_not_called()


def test_flush_uploads_and_clears_pending(lambda_with_bucket):
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        state.mark_dirty()
        assert state.flush() is True
    assert upload.call_count == 1
    assert state.has_pending_changes() is False


def test_a_failed_flush_leaves_the_change_pending(lambda_with_bucket):
    """sync_db_to_s3 reports failure by returning False; the caller decides."""
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=False):
        state.mark_dirty()
        assert state.flush() is False
    assert state.has_pending_changes() is True


def test_an_exception_from_the_uploader_is_a_failed_flush(lambda_with_bucket):
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", side_effect=RuntimeError("network")):
        assert state.flush() is False
    assert state.has_pending_changes() is True


def test_conflict_resets_pending_and_propagates(lambda_with_bucket):
    from app.core.s3_sync import VaultConflictError

    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", side_effect=VaultConflictError("x")):
        state.mark_dirty()
        with pytest.raises(VaultConflictError):
            state.flush()
    assert state.has_pending_changes() is False


def test_flush_with_no_pending_changes_still_snapshots(lambda_with_bucket):
    state = VaultSyncState()
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        assert state.flush() is True
    assert upload.call_count == 1


def test_reset_forgets_pending_changes(lambda_with_bucket):
    state = VaultSyncState()
    state.mark_dirty()
    state.reset()
    assert state.has_pending_changes() is False
