"""Coalesced S3 database synchronization.

Committing a change marks the database dirty (see the session events in
app.core.database). How the snapshot then reaches S3 depends on the runtime:

- Docker / local: a background timer uploads at most once per debounce
  interval. A failed upload keeps the database dirty and retries with backoff.
- Lambda: the execution environment is frozen as soon as a response is sent,
  so a timer would never fire. No timer is scheduled; the HTTP middleware in
  app.main flushes synchronously before a mutating request returns.

Anything that must not be lost (shutdown, an import commit) can force an
immediate upload with flush().
"""
import logging
import threading

from app.core.config import is_lambda_runtime, settings

logger = logging.getLogger("folio.sync")

# Long enough to coalesce a burst of edits, short enough that a crash loses only
# a few seconds of work on top of what S3 already holds.
DEFAULT_DEBOUNCE_SECONDS = 5.0
MAX_RETRY_DELAY_SECONDS = 300.0


class DebouncedSync:
    def __init__(self, debounce_seconds: float = DEFAULT_DEBOUNCE_SECONDS):
        self.debounce_seconds = debounce_seconds
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._dirty = False
        self._failures = 0

    # -- internal -----------------------------------------------------------

    def _schedule_locked(self, delay: float) -> None:
        """Start the upload timer (caller holds the lock). Never on Lambda."""
        if self._timer is not None or is_lambda_runtime():
            return
        self._timer = threading.Timer(delay, self._timer_fired)
        self._timer.daemon = True
        self._timer.start()

    def _timer_fired(self) -> None:
        from app.core.s3_sync import VaultConflictError

        try:
            self._upload()
        except VaultConflictError:
            # Already logged as s3_sync_conflict and the local copy reloaded.
            pass

    def _record_failure(self) -> None:
        with self._lock:
            self._dirty = True
            self._failures += 1
            delay = min(self.debounce_seconds * (2 ** self._failures), MAX_RETRY_DELAY_SECONDS)
            self._schedule_locked(delay)

    def _upload(self) -> bool:
        """Upload if dirty. False return or exception leaves the DB dirty.

        Raises VaultConflictError (after resetting the dirty state) when S3
        rejected the write because another writer replaced the vault.
        """
        from app.core.s3_sync import VaultConflictError, sync_db_to_s3

        with self._lock:
            self._timer = None
            if not self._dirty:
                return False
            # Cleared before uploading: a commit that lands during the upload
            # re-marks the database and is picked up by the next upload.
            self._dirty = False

        try:
            ok = sync_db_to_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)
        except VaultConflictError:
            self.reset()
            raise
        except Exception:
            logger.exception("S3 sync raised; will retry.")
            ok = False

        if not ok:
            # sync_db_to_s3 reports failure by returning False (it logs
            # s3_sync_failed itself). Re-mark dirty so the write is retried.
            self._record_failure()
            return False

        with self._lock:
            self._failures = 0
        return True

    # -- public -------------------------------------------------------------

    def mark_dirty(self) -> None:
        """Record that the database changed and schedule an upload."""
        if not settings.S3_BUCKET_NAME:
            return
        with self._lock:
            self._dirty = True
            self._schedule_locked(self.debounce_seconds)

    def has_pending_changes(self) -> bool:
        """Return whether local mutations are queued for S3 upload."""
        with self._lock:
            return self._dirty

    def reset(self) -> None:
        """Forget pending changes (after the local copy was replaced from S3)."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._dirty = False
            self._failures = 0

    def flush(self) -> bool:
        """Upload now. Used at shutdown, by the Lambda middleware, and after
        operations worth not losing. Raises VaultConflictError on a conflict."""
        if not settings.S3_BUCKET_NAME:
            return False
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._dirty = True
        return self._upload()


sync_scheduler = DebouncedSync()
