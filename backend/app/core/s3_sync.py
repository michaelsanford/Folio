"""SQLite vault persistence in S3.

The S3 object ``database/folio.db`` is the durable copy of the vault. Each
container works on a local file and uploads snapshots of it.

Consistency rules:

- Uploads are conditional. ``put_object(IfMatch=<etag we last saw>)`` only
  replaces the object when nobody else has written since; with no known ETag
  the upload is ``IfNoneMatch="*"`` (create only). A 412 means another writer
  won: the local copy is discarded, the current object is re-downloaded, and
  ``VaultConflictError`` is raised so the API can answer 409.
- Snapshots are taken with the SQLite online backup API, so a concurrent write
  cannot produce a torn file.
- Restore fails closed on Lambda: any error other than "object does not exist"
  raises, so the container never starts with an empty vault and then uploads
  it over the real one. As a second guard, an upload is refused when the remote
  object exists but this process never established its ETag.
"""
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import is_lambda_runtime
from app.core.logging import (
    EVENT_S3_RESTORE_FAILED,
    EVENT_S3_SYNC_CONFLICT,
    EVENT_S3_SYNC_FAILED,
    log_event,
)

logger = logging.getLogger("folio.s3_sync")

S3_DB_KEY = "database/folio.db"
BACKUP_PREFIX = "backups/"
FRESHNESS_INTERVAL_SECONDS = 1.0

_sync_lock = threading.RLock()
_last_known_etag: str | None = None
# Monotonic time of the last freshness HEAD, so ensure_db_fresh costs at most
# one S3 round trip per second per container.
_last_fresh_check: float = 0.0

_client_lock = threading.Lock()
_clients: dict[str, object] = {}


class VaultConflictError(Exception):
    """Another writer replaced the S3 vault since this container last saw it.

    The local copy has already been replaced by the current S3 object when this
    is raised; the caller's write is lost and the client must reload.
    """


class S3RestoreError(RuntimeError):
    """The vault exists (or may exist) in S3 but could not be downloaded."""


def _error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None) or {}
    code = str(response.get("Error", {}).get("Code", ""))
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return code or (str(status) if status else "")


def _is_not_found(exc: Exception) -> bool:
    return _error_code(exc) in ("404", "NoSuchKey", "NotFound")


def _is_precondition_failed(exc: Exception) -> bool:
    return _error_code(exc) in ("412", "PreconditionFailed")


def _remove_sqlite_sidecars(db_path: Path) -> None:
    """Remove stale SQLite WAL/SHM sidecar files before replacing the DB file."""
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{db_path}{suffix}")
        try:
            sidecar.unlink(missing_ok=True)
        except OSError as exc:
            logger.debug(f"Could not remove SQLite sidecar {sidecar}: {exc}")


def _head_etag(client, bucket_name: str, s3_key: str = S3_DB_KEY) -> str | None:
    """ETag of the remote object, None when it does not exist. Other errors raise."""
    try:
        head = client.head_object(Bucket=bucket_name, Key=s3_key)
    except Exception as exc:
        if _is_not_found(exc):
            return None
        raise
    etag = head.get("ETag") if isinstance(head, dict) else None
    return str(etag) if etag else None


def _fetch_remote_etag(client, bucket_name: str, s3_key: str = S3_DB_KEY) -> str | None:
    """Best-effort ETag lookup: None if absent or unreadable."""
    try:
        return _head_etag(client, bucket_name, s3_key)
    except Exception as exc:
        logger.warning(f"head_object failed for s3://{bucket_name}/{s3_key}: {exc}")
        return None


def get_s3_client(region: str | None = None):
    """Return a cached boto3 S3 client (one per region, created thread-safely)."""
    region = region or os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    client = _clients.get(region)
    if client is not None:
        return client
    with _client_lock:
        client = _clients.get(region)
        if client is None:
            try:
                import boto3

                client = boto3.client("s3", region_name=region)
            except Exception as e:
                logger.warning(f"boto3 S3 client unavailable: {e}")
                return None
            _clients[region] = client
        return client


def _download_object(client, bucket_name: str, db_path: Path) -> str | None:
    """Download the vault atomically and return the ETag of exactly that version.

    get_object returns the body and its ETag together, so the ETag we keep is
    the one for the bytes we hold (a separate HEAD could describe a newer
    version written in between).
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    response = client.get_object(Bucket=bucket_name, Key=S3_DB_KEY)
    fd, tmp_name = tempfile.mkstemp(prefix=".folio-download-", dir=str(db_path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            body = response["Body"]
            if hasattr(body, "read"):
                shutil.copyfileobj(body, fh)
            else:
                fh.write(body)
        _remove_sqlite_sidecars(db_path)
        os.replace(tmp_name, db_path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    etag = response.get("ETag")
    return str(etag) if etag else None


def _replace_local_from_s3(client, bucket_name: str, db_path: Path) -> str | None:
    """Swap the local file for the current S3 object and migrate it to head."""
    global _last_known_etag
    from app.core.database import engine

    engine.dispose()
    etag = _download_object(client, bucket_name, db_path)
    _last_known_etag = etag
    _migrate_after_swap()
    return etag


def _migrate_after_swap() -> None:
    """A newer file from another container may predate this code's schema."""
    try:
        from app.core.migrations import run_migrations

        run_migrations()
    except Exception:
        logger.exception("Migrating the refreshed database failed")


def restore_db_from_s3(
    db_path: Path,
    bucket_name: str,
    region: str = "ca-central-1",
    *,
    fail_closed: bool | None = None,
) -> bool:
    """Download the vault from S3 into ``db_path``.

    Returns True when restored and False when there is nothing to restore. When
    the object exists but cannot be read, raises S3RestoreError in fail-closed
    mode (the Lambda default) and returns False otherwise.
    """
    global _last_known_etag

    if fail_closed is None:
        fail_closed = is_lambda_runtime()

    if not bucket_name:
        logger.info("No S3_BUCKET_NAME configured. Skipping S3 database restore.")
        return False

    client = get_s3_client(region)
    if not client:
        if fail_closed:
            log_event(logger, logging.ERROR, EVENT_S3_RESTORE_FAILED, "No S3 client available to restore the vault")
            raise S3RestoreError("No S3 client available to restore the vault")
        return False

    with _sync_lock:
        try:
            logger.info(f"Restoring SQLite database from s3://{bucket_name}/{S3_DB_KEY}")
            _last_known_etag = _download_object(client, bucket_name, db_path)
            logger.info(f"Restored SQLite database from S3 ({db_path}).")
            return True
        except Exception as e:
            if _is_not_found(e):
                logger.info("No existing database found in S3. Initializing fresh database.")
                _last_known_etag = None
                return False
            log_event(
                logger,
                logging.ERROR,
                EVENT_S3_RESTORE_FAILED,
                f"Unable to download database from S3: {e}",
                exc_info=True,
            )
            if fail_closed:
                raise S3RestoreError(f"Unable to restore vault from S3: {e}") from e
            return False


def startup_restore(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Startup policy.

    Lambda: always restore (local /tmp is empty or stale), failing closed.
    Docker: the volume's local file is authoritative; restore only when it is
    missing, otherwise adopt the remote ETag so conditional uploads can proceed.
    """
    global _last_known_etag

    if not bucket_name:
        return False
    if is_lambda_runtime() or not db_path.exists():
        return restore_db_from_s3(db_path, bucket_name, region)

    client = get_s3_client(region)
    if client is None:
        return False
    try:
        with _sync_lock:
            _last_known_etag = _head_etag(client, bucket_name)
        logger.info("Local database present; keeping it and tracking the S3 copy's ETag.")
    except Exception as exc:
        logger.warning(f"Could not read the S3 vault's ETag at startup: {exc}")
    return False


def _snapshot(db_path: Path) -> Path:
    """Consistent copy of the live database via the SQLite online backup API."""
    fd, tmp_name = tempfile.mkstemp(prefix=".folio-snapshot-", suffix=".db", dir=str(db_path.parent))
    os.close(fd)
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(tmp_name)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return Path(tmp_name)


def _handle_conflict(client, bucket_name: str, db_path: Path, exc: Exception) -> None:
    log_event(
        logger,
        logging.WARNING,
        EVENT_S3_SYNC_CONFLICT,
        "S3 vault changed since this container last read it; discarding local changes and reloading.",
    )
    try:
        _replace_local_from_s3(client, bucket_name, db_path)
    except Exception:
        log_event(
            logger,
            logging.ERROR,
            EVENT_S3_RESTORE_FAILED,
            "Reloading the vault after a conflict failed",
            exc_info=True,
        )
    from app.core.sync_scheduler import sync_scheduler

    sync_scheduler.reset()
    raise VaultConflictError("The vault was changed elsewhere; local changes were discarded.") from exc


def sync_db_to_s3(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Upload a consistent snapshot to S3 with a conditional write.

    Returns True on success and False on failure (logged as s3_sync_failed; the
    caller keeps the database dirty and retries). Raises VaultConflictError when
    S3 rejects the write because another writer got there first.
    """
    global _last_known_etag

    if not bucket_name or not db_path.exists():
        return False

    client = get_s3_client(region)
    if not client:
        log_event(logger, logging.ERROR, EVENT_S3_SYNC_FAILED, "No S3 client available for vault upload")
        return False

    with _sync_lock:
        if _last_known_etag is None:
            # Never overwrite a vault we have not seen: if the object exists but
            # restore failed (or never ran), uploading would replace real data.
            try:
                remote = _head_etag(client, bucket_name)
            except Exception as exc:
                log_event(
                    logger,
                    logging.ERROR,
                    EVENT_S3_SYNC_FAILED,
                    f"Cannot confirm the S3 vault state before upload: {exc}",
                )
                return False
            if remote is not None:
                log_event(
                    logger,
                    logging.ERROR,
                    EVENT_S3_SYNC_FAILED,
                    "Refusing to upload: the S3 vault exists but this container never loaded it.",
                )
                return False

        snapshot: Path | None = None
        try:
            snapshot = _snapshot(db_path)
            conditions = {"IfMatch": _last_known_etag} if _last_known_etag else {"IfNoneMatch": "*"}
            with snapshot.open("rb") as body:
                response = client.put_object(Bucket=bucket_name, Key=S3_DB_KEY, Body=body, **conditions)
            etag = response.get("ETag") if isinstance(response, dict) else None
            _last_known_etag = str(etag) if etag else _fetch_remote_etag(client, bucket_name)
            logger.info("Database snapshot uploaded to S3.")
            return True
        except Exception as e:
            if _is_precondition_failed(e):
                _handle_conflict(client, bucket_name, db_path, e)
            log_event(
                logger,
                logging.ERROR,
                EVENT_S3_SYNC_FAILED,
                f"Failed to sync SQLite database to S3: {e}",
                exc_info=True,
            )
            return False
        finally:
            if snapshot is not None:
                snapshot.unlink(missing_ok=True)


def upload_backup(file_path: Path, key: str, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Unconditional upload of a backup copy (e.g. backups/pre-migrate-*.db)."""
    client = get_s3_client(region)
    if not client or not bucket_name:
        return False
    try:
        with Path(file_path).open("rb") as body:
            client.put_object(Bucket=bucket_name, Key=key, Body=body)
        logger.info(f"Uploaded backup to s3://{bucket_name}/{key}")
        return True
    except Exception as exc:
        logger.warning(f"Backup upload to s3://{bucket_name}/{key} failed: {exc}")
        return False


def backup_key(label: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{BACKUP_PREFIX}{label}-{ts}.db"


def ensure_db_fresh(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Pull a newer S3 snapshot if another container updated it.

    Checks S3 at most once per FRESHNESS_INTERVAL_SECONDS, never while local
    changes are waiting to upload, and migrates a swapped-in file before use.
    """
    global _last_fresh_check

    if not bucket_name:
        return False

    from app.core.sync_scheduler import sync_scheduler

    if sync_scheduler.has_pending_changes():
        return False
    if time.monotonic() - _last_fresh_check < FRESHNESS_INTERVAL_SECONDS:
        return False

    with _sync_lock:
        if sync_scheduler.has_pending_changes():
            return False
        now = time.monotonic()
        if now - _last_fresh_check < FRESHNESS_INTERVAL_SECONDS:
            return False
        _last_fresh_check = now

        client = get_s3_client(region)
        if not client:
            return False

        try:
            remote_etag = _head_etag(client, bucket_name)
        except Exception as exc:
            logger.warning(f"S3 freshness check failed; serving the local copy: {exc}")
            return False
        if not remote_etag or remote_etag == _last_known_etag:
            return False

        try:
            _replace_local_from_s3(client, bucket_name, db_path)
            logger.info(f"Refreshed SQLite database from S3 (ETag {_last_known_etag}).")
            return True
        except Exception as exc:
            logger.warning(f"Failed to refresh SQLite database from S3: {exc}")
            return False


def sync_db_if_configured() -> bool:
    """Mark the database as needing an S3 snapshot.

    Kept for compatibility: commits now mark the database dirty automatically
    (see app.core.database session events), so callers no longer need this.
    """
    from app.core.sync_scheduler import sync_scheduler

    sync_scheduler.mark_dirty()
    return True


def sync_now() -> bool:
    """Upload immediately, bypassing the debounce.

    Returns whether the upload succeeded. Raises VaultConflictError when another
    writer replaced the vault (the local copy has been reloaded from S3).
    """
    from app.core.sync_scheduler import sync_scheduler

    return sync_scheduler.flush()
