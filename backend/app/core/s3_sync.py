"""SQLite vault persistence in S3 (AWS Lambda only).

The S3 object ``database/folio.db.zst`` (the SQLite file, zstd-compressed)
is the durable copy of the vault. Each Lambda container works on a local file
in /tmp and uploads compressed snapshots of it. A vault written by an older
release as plain ``database/folio.db`` is read once and rewritten under the
new key.
Docker and local runs never reach this module's network paths: they are
development environments and keep the vault on local disk only (see
``Settings.s3_sync_enabled``).

Consistency rules:

- Uploads are conditional. ``put_object(IfMatch=<etag we last saw>)`` only
  replaces the object when nobody else has written since; with no known ETag
  the upload is ``IfNoneMatch="*"`` (create only). A 412 means another writer
  won: the local copy is discarded, the current object is re-downloaded, and
  ``VaultConflictError`` is raised so the API can answer 409.
- Snapshots are taken with the SQLite online backup API, so a concurrent write
  cannot produce a torn file.
- A failed upload (anything but a conflict) also discards the local change:
  the vault is re-downloaded and ``VaultSyncFailedError`` is raised so the API
  can answer 503 vault_sync_failed. A save is either durable or visibly
  rejected. If even the re-download fails, the local copy is marked untrusted
  and the next request must reload it before anything is served.
- Restore fails closed: any error other than "object does not exist" raises,
  so the container never starts with an empty vault and then uploads it over
  the real one. As a second guard, an upload is refused when the remote object
  exists but this process never established its ETag.
"""
import io
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from compression import zstd

from app.core.logging import (
    EVENT_S3_RESTORE_FAILED,
    EVENT_S3_SYNC_CONFLICT,
    EVENT_S3_SYNC_FAILED,
    log_event,
)

logger = logging.getLogger("folio.s3_sync")

S3_DB_KEY = "database/folio.db.zst"
# Where releases before compression kept the vault (plain SQLite).
LEGACY_DB_KEY = "database/folio.db"
ZSTD_LEVEL = 3
CHUNK = 1024 * 1024
BACKUP_PREFIX = "backups/"
FRESHNESS_INTERVAL_SECONDS = 1.0

_sync_lock = threading.RLock()
_last_known_etag: str | None = None
# Monotonic time of the last freshness HEAD, so ensure_db_fresh costs at most
# one S3 round trip per second per container.
_last_fresh_check: float = 0.0
# Set when a failed upload could not be undone by re-downloading the vault: the
# local file may hold a change S3 never received, so it must not be served.
_local_untrusted: bool = False

_client_lock = threading.Lock()
_clients: dict[str, object] = {}


class VaultConflictError(Exception):
    """Another writer replaced the S3 vault since this container last saw it.

    The local copy has already been replaced by the current S3 object when this
    is raised; the caller's write is lost and the client must reload.
    """


class VaultSyncFailedError(Exception):
    """A change could not be uploaded to S3 and was discarded locally.

    The API answers 503 vault_sync_failed: the client's change was not saved.
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


def compress_file(src: Path, dst: Path) -> None:
    """zstd-compress ``src`` into ``dst`` (streamed, constant memory)."""
    with src.open("rb") as fin, zstd.open(dst, "wb", level=ZSTD_LEVEL) as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def decompress_file(src: Path, dst: Path) -> None:
    with zstd.open(src, "rb") as fin, dst.open("wb") as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def _download_object(client, bucket_name: str, db_path: Path) -> str | None:
    """Download the vault atomically and return the ETag of exactly that version.

    get_object returns the body and its ETag together, so the ETag we keep is
    the one for the bytes we hold (a separate HEAD could describe a newer
    version written in between).

    When only the legacy plain object exists, it is restored instead and None
    is returned: the compressed key does not exist yet, so the next upload
    creates it (``If-None-Match: *``). The vault is marked changed so that
    upload happens at startup rather than at the next edit.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    legacy = False
    try:
        response = client.get_object(Bucket=bucket_name, Key=S3_DB_KEY)
    except Exception as exc:
        if not _is_not_found(exc):
            raise
        response = client.get_object(Bucket=bucket_name, Key=LEGACY_DB_KEY)
        legacy = True
    fd, tmp_name = tempfile.mkstemp(prefix=".folio-download-", dir=str(db_path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            body = response["Body"]
            if not hasattr(body, "read"):
                body = io.BytesIO(body)
            if legacy:
                shutil.copyfileobj(body, fh, CHUNK)
            else:
                with zstd.open(body, "rb") as plain:
                    shutil.copyfileobj(plain, fh, CHUNK)
        _remove_sqlite_sidecars(db_path)
        os.replace(tmp_name, db_path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    if legacy:
        logger.info("Restored the vault from the legacy uncompressed object; it will be rewritten compressed.")
        from app.core.sync_scheduler import sync_scheduler

        sync_scheduler.mark_dirty()
        return None
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


def restore_db_from_s3(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Download the vault from S3 into ``db_path``, failing closed.

    Returns True when restored and False when there is nothing to restore (no
    bucket, or the object does not exist yet). When the object exists but
    cannot be read, raises S3RestoreError.
    """
    global _last_known_etag

    if not bucket_name:
        logger.info("No S3_BUCKET_NAME configured. Skipping S3 database restore.")
        return False

    client = get_s3_client(region)
    if not client:
        log_event(logger, logging.ERROR, EVENT_S3_RESTORE_FAILED, "No S3 client available to restore the vault")
        raise S3RestoreError("No S3 client available to restore the vault")

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
            raise S3RestoreError(f"Unable to restore vault from S3: {e}") from e


def startup_restore(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Startup policy (Lambda only): always restore, failing closed.

    The container's /tmp copy is empty or stale, so S3 is authoritative.
    """
    if not bucket_name:
        return False
    return restore_db_from_s3(db_path, bucket_name, region)


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
    global _local_untrusted, _last_known_etag
    log_event(
        logger,
        logging.WARNING,
        EVENT_S3_SYNC_CONFLICT,
        "S3 vault changed since this container last read it; discarding local changes and reloading.",
    )
    try:
        _replace_local_from_s3(client, bucket_name, db_path)
    except Exception:
        # The losing change is still in the local file: never serve it.
        _local_untrusted = True
        _last_known_etag = None
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


def _reset_local_to_s3(client, bucket_name: str, db_path: Path) -> None:
    """Make the local file equal to S3's current vault.

    When the object does not exist yet (a brand-new vault whose first upload
    failed), the local file is removed and the schema rebuilt empty, which is
    what S3 holds: nothing.
    """
    global _last_known_etag
    try:
        _replace_local_from_s3(client, bucket_name, db_path)
    except Exception as exc:
        if not _is_not_found(exc):
            raise
        from app.core.database import engine

        engine.dispose()
        _remove_sqlite_sidecars(db_path)
        db_path.unlink(missing_ok=True)
        _last_known_etag = None
        _migrate_after_swap()


def discard_local_changes(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Throw away this container's un-uploaded changes by reloading the vault.

    Returns True when the local copy now equals S3. On failure the local copy
    is marked untrusted, so ensure_db_fresh reloads it (or refuses to serve it)
    on the next request instead of serving a change S3 never received.
    """
    global _local_untrusted, _last_known_etag
    from app.core.sync_scheduler import sync_scheduler

    with _sync_lock:
        sync_scheduler.reset()
        try:
            client = get_s3_client(region)
            if client is None:
                raise S3RestoreError("No S3 client available to reload the vault")
            _reset_local_to_s3(client, bucket_name, db_path)
            _local_untrusted = False
            return True
        except Exception:
            _local_untrusted = True
            # Also blocks uploads from this container until it reloads: with no
            # known ETag, sync_db_to_s3 refuses to overwrite an existing vault.
            _last_known_etag = None
            log_event(
                logger,
                logging.ERROR,
                EVENT_S3_SYNC_FAILED,
                "Reloading the vault after a failed upload failed; the local copy must be "
                "reloaded before the next request is served.",
                exc_info=True,
            )
            return False


def sync_db_to_s3(db_path: Path, bucket_name: str, region: str = "ca-central-1") -> bool:
    """Upload a consistent snapshot to S3 with a conditional write.

    Returns True on success and False on failure (logged as s3_sync_failed).
    Raises VaultConflictError when S3 rejects the write because another writer
    got there first. A plain failure discards nothing here; sync_now does.
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
        packed: Path | None = None
        try:
            snapshot = _snapshot(db_path)
            packed = snapshot.with_suffix(".db.zst")
            compress_file(snapshot, packed)
            conditions = {"IfMatch": _last_known_etag} if _last_known_etag else {"IfNoneMatch": "*"}
            with packed.open("rb") as body:
                response = client.put_object(
                    Bucket=bucket_name,
                    Key=S3_DB_KEY,
                    Body=body,
                    ContentType="application/zstd",
                    **conditions,
                )
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
            for path in (snapshot, packed):
                if path is not None:
                    path.unlink(missing_ok=True)


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
    An untrusted local copy (see discard_local_changes) is always reloaded
    first; if that fails, VaultSyncFailedError is raised rather than serving it.
    """
    global _last_fresh_check

    if not bucket_name:
        return False

    if _local_untrusted:
        if discard_local_changes(db_path, bucket_name, region):
            logger.info("Reloaded the vault after an earlier failed upload.")
            return True
        raise VaultSyncFailedError("The local vault copy could not be reloaded from S3.")

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
    """Upload the vault now, so a change is durable before the response.

    Returns True when uploaded and False when S3 sync is not enabled (Docker /
    local, or no bucket). It never returns success without an upload:

    - VaultConflictError: another writer replaced the vault; the local copy
      has been reloaded from S3 (API: 409 vault_conflict).
    - VaultSyncFailedError: the upload failed for another reason; the local
      change has been discarded by reloading the vault (API: 503
      vault_sync_failed).
    """
    from app.core.config import settings
    from app.core.sync_scheduler import sync_scheduler

    if not settings.s3_sync_enabled:
        return False
    if sync_scheduler.flush():
        return True
    discard_local_changes(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)
    raise VaultSyncFailedError("The change could not be uploaded to S3 and was discarded.")


# ---------------------------------------------------------------------------
# Closed-year archives (archives/<year>/...): write-once copies, never part of
# the conditional vault protocol above.
# ---------------------------------------------------------------------------
ARCHIVE_PREFIX = "archives/"
ARCHIVE_STORAGE_CLASS = "GLACIER_IR"  # rarely read, millisecond retrieval


def upload_archive(file_path: Path, key: str, bucket_name: str, region: str = "ca-central-1") -> None:
    """Store a closed-year archive in cold storage. Raises on failure."""
    client = get_s3_client(region)
    if not client or not bucket_name:
        raise RuntimeError("No S3 client or bucket for the archive")
    with Path(file_path).open("rb") as body:
        client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=body,
            ContentType="application/zstd",
            StorageClass=ARCHIVE_STORAGE_CLASS,
        )
    logger.info(f"Stored archive s3://{bucket_name}/{key}")


def download_archive(key: str, bucket_name: str, region: str = "ca-central-1") -> bytes:
    """The stored bytes of an archive (still compressed)."""
    client = get_s3_client(region)
    if not client or not bucket_name:
        raise RuntimeError("No S3 client or bucket for the archive")
    body = client.get_object(Bucket=bucket_name, Key=key)["Body"]
    return body.read() if hasattr(body, "read") else body
