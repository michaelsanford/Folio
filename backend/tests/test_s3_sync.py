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

