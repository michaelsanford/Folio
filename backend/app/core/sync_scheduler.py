"""Debounced S3 database synchronization.

Previously every mutation called sync_db_if_configured(), which checkpointed the
WAL and uploaded the entire SQLite file synchronously on the request path --
sometimes twice in one request. At a few thousand transactions that is a
multi-megabyte upload per keystroke-sized edit.

The upload is still the durability mechanism, so it cannot simply be dropped.
Instead writes are coalesced: a mutation marks the database dirty, and a
background timer uploads at most once per interval. Anything that must not be
lost (shutdown, an import commit) can still force an immediate sync.
"""
import logging
import threading

from app.core.config import settings

logger = logging.getLogger("folio.sync")

# Long enough to coalesce a burst of edits, short enough that a crash loses only
# a few seconds of work on top of what S3 already holds.
DEFAULT_DEBOUNCE_SECONDS = 5.0


class DebouncedSync:
    def __init__(self, debounce_seconds: float = DEFAULT_DEBOUNCE_SECONDS):
        self.debounce_seconds = debounce_seconds
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._dirty = False

    def _upload(self) -> bool:
        from app.core.s3_sync import sync_db_to_s3

        with self._lock:
            self._timer = None
            if not self._dirty:
                return False
            self._dirty = False

        try:
            return sync_db_to_s3(
                settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION
            )
        except Exception:
            # Re-mark dirty so the next tick retries rather than losing the write.
            with self._lock:
                self._dirty = True
            logger.exception("Deferred S3 sync failed; will retry on the next write.")
            return False

    def mark_dirty(self) -> None:
        """Record that the database changed and schedule an upload."""
        if not settings.S3_BUCKET_NAME:
            return
        with self._lock:
            self._dirty = True
            if self._timer is not None:
                return  # an upload is already scheduled
            self._timer = threading.Timer(self.debounce_seconds, self._upload)
            self._timer.daemon = True
            self._timer.start()

    def flush(self) -> bool:
        """Upload now. Used at shutdown and after operations worth not losing."""
        if not settings.S3_BUCKET_NAME:
            return False
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._dirty = True
        return self._upload()


sync_scheduler = DebouncedSync()
