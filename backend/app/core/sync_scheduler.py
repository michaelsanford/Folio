"""Pending-change tracking for the S3 vault (AWS Lambda only).

Committing a change marks the database dirty (see the session events in
app.core.database). Lambda freezes the execution environment as soon as a
response is sent, so nothing uploads in the background: VaultSyncMiddleware
(app.core.vault_middleware) calls flush() before a mutating request returns, and
endpoints that must not lose work (an import commit) call it through sync_now.

Docker and local runs never sync to S3 (Settings.s3_sync_enabled is False
there), so marking dirty is a no-op and nothing is ever pending.
"""
import logging
import threading

from app.core.config import settings

logger = logging.getLogger("folio.sync")


class VaultSyncState:
    def __init__(self):
        self._lock = threading.Lock()
        self._dirty = False

    def mark_dirty(self) -> None:
        """Record that the database changed and needs uploading before the response."""
        if not settings.s3_sync_enabled:
            return
        with self._lock:
            self._dirty = True

    def has_pending_changes(self) -> bool:
        """Return whether local mutations are waiting for an S3 upload."""
        with self._lock:
            return self._dirty

    def reset(self) -> None:
        """Forget pending changes (after the local copy was replaced from S3)."""
        with self._lock:
            self._dirty = False

    def flush(self) -> bool:
        """Upload a snapshot now, whether or not anything is marked dirty.

        Returns True on success. On failure (False, or an unexpected exception)
        the database stays marked dirty and False is returned; the caller
        decides what to do with the un-uploaded change (sync_now discards it).
        Raises VaultConflictError, with nothing left pending, when another
        writer replaced the vault.
        """
        from app.core.s3_sync import VaultConflictError, sync_db_to_s3

        if not settings.s3_sync_enabled:
            return False

        with self._lock:
            # Cleared before uploading: a commit that lands during the upload
            # re-marks the database and is picked up by the next flush.
            self._dirty = False

        try:
            ok = sync_db_to_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)
        except VaultConflictError:
            self.reset()
            raise
        except Exception:
            logger.exception("S3 sync raised.")
            ok = False

        if not ok:
            with self._lock:
                self._dirty = True
        return ok


sync_scheduler = VaultSyncState()
