from pathlib import Path
from unittest.mock import MagicMock, patch
from app.core.s3_sync import restore_db_from_s3, sync_db_to_s3


def test_restore_db_no_bucket_returns_false():
    db_path = Path("/tmp/test_folio.db")
    result = restore_db_from_s3(db_path, "")
    assert result is False


@patch("app.core.s3_sync.get_s3_client")
def test_restore_db_success(mock_get_client, tmp_path):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    db_path = tmp_path / "folio.db"
    result = restore_db_from_s3(db_path, "my-vault-bucket", "ca-central-1")

    assert result is True
    mock_client.download_file.assert_called_once_with(
        "my-vault-bucket", "database/folio.db", str(db_path)
    )


@patch("app.core.s3_sync.get_s3_client")
def test_restore_db_404_handled_gracefully(mock_get_client, tmp_path):
    mock_client = MagicMock()
    mock_client.download_file.side_effect = Exception("Not Found")
    mock_get_client.return_value = mock_client

    db_path = tmp_path / "folio.db"
    result = restore_db_from_s3(db_path, "my-vault-bucket", "ca-central-1")
    assert result is False


@patch("app.core.s3_sync.get_s3_client")
def test_sync_db_to_s3_success(mock_get_client, tmp_path):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    # Create dummy sqlite db
    import sqlite3
    db_path = tmp_path / "folio.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INT);")
    conn.commit()
    conn.close()

    result = sync_db_to_s3(db_path, "my-vault-bucket", "ca-central-1")
    assert result is True
    mock_client.upload_file.assert_called_once_with(
        str(db_path),
        "my-vault-bucket",
        "database/folio.db",
        ExtraArgs={"ServerSideEncryption": "AES256"},
    )



@patch("app.core.database.engine.dispose")
@patch("app.core.s3_sync.get_s3_client")
def test_ensure_db_fresh_downloads_when_etag_changes(mock_get_client, mock_dispose, tmp_path):
    from app.core import s3_sync
    from app.core.sync_scheduler import sync_scheduler

    db_path = tmp_path / "folio.db"
    db_path.write_bytes(b"old")
    wal_path = Path(f"{db_path}-wal")
    shm_path = Path(f"{db_path}-shm")
    wal_path.write_bytes(b"stale-wal")
    shm_path.write_bytes(b"stale-shm")

    mock_client = MagicMock()
    mock_client.head_object.return_value = {"ETag": '"etag-new"'}
    mock_get_client.return_value = mock_client

    orig_etag = s3_sync._last_known_etag
    s3_sync._last_known_etag = '"etag-old"'
    try:
        with patch.object(sync_scheduler, "has_pending_changes", return_value=False):
            refreshed = s3_sync.ensure_db_fresh(db_path, "my-vault-bucket", "ca-central-1")

        assert refreshed is True
        mock_dispose.assert_called_once()
        assert not wal_path.exists()
        assert not shm_path.exists()
        mock_client.download_file.assert_called_once_with(
            "my-vault-bucket", "database/folio.db", str(db_path)
        )
        assert s3_sync._last_known_etag == '"etag-new"'
    finally:
        s3_sync._last_known_etag = orig_etag


@patch("app.core.s3_sync.get_s3_client")
def test_ensure_db_fresh_skips_when_etag_matches(mock_get_client, tmp_path):
    from app.core import s3_sync
    from app.core.sync_scheduler import sync_scheduler

    db_path = tmp_path / "folio.db"
    mock_client = MagicMock()
    mock_client.head_object.return_value = {"ETag": '"etag-same"'}
    mock_get_client.return_value = mock_client

    orig_etag = s3_sync._last_known_etag
    s3_sync._last_known_etag = '"etag-same"'
    try:
        with patch.object(sync_scheduler, "has_pending_changes", return_value=False):
            refreshed = s3_sync.ensure_db_fresh(db_path, "my-vault-bucket", "ca-central-1")

        assert refreshed is False
        mock_client.download_file.assert_not_called()
    finally:
        s3_sync._last_known_etag = orig_etag


@patch("app.core.s3_sync.get_s3_client")
def test_ensure_db_fresh_skips_when_local_changes_pending(mock_get_client, tmp_path):
    from app.core import s3_sync
    from app.core.sync_scheduler import sync_scheduler

    db_path = tmp_path / "folio.db"
    orig_etag = s3_sync._last_known_etag
    s3_sync._last_known_etag = '"etag-old"'
    try:
        with patch.object(sync_scheduler, "has_pending_changes", return_value=True):
            refreshed = s3_sync.ensure_db_fresh(db_path, "my-vault-bucket", "ca-central-1")

        assert refreshed is False
        mock_get_client.assert_not_called()
    finally:
        s3_sync._last_known_etag = orig_etag
