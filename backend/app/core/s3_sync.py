import os
import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger("folio.s3_sync")


def get_s3_client(region: str | None = None):
    """Attempt to initialize boto3 S3 client."""
    try:
        import boto3
        return boto3.client("s3", region_name=region or os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    except Exception as e:
        logger.debug(f"boto3 not available or credentials missing: {e}")
        return None


def restore_db_from_s3(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """
    On serverless cold-start, pulls the latest SQLite database from S3 into local /tmp storage.
    """
    if not bucket_name:
        logger.info("No S3_BUCKET_NAME configured. Skipping S3 database restore.")
        return False

    client = get_s3_client(region)
    if not client:
        logger.info("No AWS S3 client available. Operating with local database.")
        return False

    db_path.parent.mkdir(parents=True, exist_ok=True)
    s3_key = "database/folio.db"

    try:
        logger.info(f"Checking for existing SQLite database in S3 bucket '{bucket_name}' ({s3_key})...")
        client.download_file(bucket_name, s3_key, str(db_path))
        logger.info(f"Successfully restored SQLite database from S3 ({db_path}).")
        return True
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code in ("404", "NoSuchKey"):
            logger.info("No existing database found in S3. Initializing fresh database.")
        else:
            logger.warning(f"Unable to download database from S3: {e}. Starting with local instance.")
        return False


def sync_db_to_s3(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """
    Checkpoints SQLite WAL and syncs database snapshot to S3 bucket.
    """
    if not bucket_name or not db_path.exists():
        return False

    client = get_s3_client(region)
    if not client:
        return False

    try:
        # Checkpoint WAL pages into the main database file before uploading
        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

        s3_key = "database/folio.db"
        logger.info(f"Synchronizing database snapshot to S3 ({bucket_name}/{s3_key})...")
        client.upload_file(
            str(db_path),
            bucket_name,
            s3_key,
            ExtraArgs={"ServerSideEncryption": "AES256"},
        )
        logger.info("Database snapshot successfully uploaded to S3.")
        return True
    except Exception as e:
        logger.error(f"Failed to sync SQLite database to S3: {e}")
        return False


def sync_db_if_configured() -> bool:
    """Convenience helper to checkpoint and push DB snapshot to S3 if S3_BUCKET_NAME is configured."""
    from app.core.config import settings
    if settings.S3_BUCKET_NAME:
        return sync_db_to_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)
    return False

