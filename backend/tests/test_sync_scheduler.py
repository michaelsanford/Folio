"""S3 snapshots must be coalesced, not issued once per mutation."""
import time
from unittest.mock import patch

import pytest

from app.core.sync_scheduler import DebouncedSync


@pytest.fixture
def bucket_configured():
    with patch("app.core.sync_scheduler.settings") as mock_settings:
        mock_settings.S3_BUCKET_NAME = "test-bucket"
        mock_settings.SQLITE_DB_PATH = "/tmp/test.db"
        mock_settings.AWS_REGION = "ca-central-1"
        yield mock_settings


def test_a_burst_of_writes_produces_a_single_upload(bucket_configured):
    scheduler = DebouncedSync(debounce_seconds=0.05)
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        for _ in range(50):
            scheduler.mark_dirty()
        time.sleep(0.25)

    assert upload.call_count == 1, (
        f"50 mutations issued {upload.call_count} uploads; they must coalesce"
    )


def test_nothing_uploads_without_a_bucket():
    with patch("app.core.sync_scheduler.settings") as mock_settings:
        mock_settings.S3_BUCKET_NAME = ""
        scheduler = DebouncedSync(debounce_seconds=0.01)
        with patch("app.core.s3_sync.sync_db_to_s3") as upload:
            scheduler.mark_dirty()
            assert scheduler.flush() is False
            time.sleep(0.05)
        upload.assert_not_called()


def test_flush_uploads_immediately(bucket_configured):
    scheduler = DebouncedSync(debounce_seconds=30.0)
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        scheduler.mark_dirty()
        assert scheduler.flush() is True
        assert upload.call_count == 1, "flush must not wait for the debounce window"


def test_a_failed_upload_is_retried_rather_than_lost(bucket_configured):
    scheduler = DebouncedSync(debounce_seconds=30.0)
    with patch("app.core.s3_sync.sync_db_to_s3", side_effect=RuntimeError("network")) as upload:
        scheduler.mark_dirty()
        assert scheduler.flush() is False
        assert upload.call_count == 1

    # The dirty flag survived the failure, so the next flush tries again.
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        assert scheduler.flush() is True
        assert upload.call_count == 1


def test_flush_with_no_pending_changes_still_snapshots(bucket_configured):
    """Shutdown should snapshot even if the debounce already ran."""
    scheduler = DebouncedSync(debounce_seconds=30.0)
    with patch("app.core.s3_sync.sync_db_to_s3", return_value=True) as upload:
        assert scheduler.flush() is True
        assert upload.call_count == 1
