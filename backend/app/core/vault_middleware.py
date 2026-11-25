"""Upload the vault before a write returns, and replay a write that lost a race.

Lambda freezes the container as soon as a response is sent, so a request that
changed the vault must upload it first. Two people saving at the same moment
on two containers both start from the same vault version; S3's conditional
write lets only one of them land and the other gets ``VaultConflictError``.

That loser's change was made on a copy that is now discarded (the conflict
handler reloads the winner's vault), so running the same request again on the
reloaded vault is safe and gives the result the person expected. This
middleware therefore:

1. reads the request body into memory (bodies are capped well below Lambda's
   6 MB payload limit), so the request can be sent to the app again;
2. runs the app, holding the response back;
3. uploads the vault when the request changed it (any write method, or a GET
   flagged ``state["vault_write"]``, such as a first sign-in);
4. on a conflict, waits a moment and replays, up to ``MAX_ATTEMPTS`` times in
   all, and answers 409 ``vault_conflict`` only when every attempt lost.

A handler that uploads by itself (``sync_now()`` inside an import commit) and
loses gets the same treatment: the exception handler marks the request state
``vault_conflict``. Requests with effects outside the vault (sending an
invitation email) set ``state["no_replay"]`` and are never repeated.

Docker and local runs never sync to S3, so there the app is called directly.
"""
from __future__ import annotations

import asyncio
import logging
import random

from fastapi.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.s3_sync import VaultConflictError, VaultSyncFailedError, sync_now
from app.core.sync_scheduler import sync_scheduler

logger = logging.getLogger("folio.vault")

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
MAX_ATTEMPTS = 3
# Base pause before a replay; grows with each attempt, with jitter so two
# losers do not collide again.
REPLAY_DELAY_SECONDS = 0.15

VAULT_CONFLICT_MESSAGE = (
    "The vault was changed from another session. Your last change was not saved; "
    "the latest data has been reloaded."
)
VAULT_SYNC_FAILED_MESSAGE = "Your change wasn't saved. Please try again."


def vault_conflict_response() -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": {"code": "vault_conflict", "message": VAULT_CONFLICT_MESSAGE}},
    )


def vault_sync_failed_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": {"code": "vault_sync_failed", "message": VAULT_SYNC_FAILED_MESSAGE}},
    )


class VaultSyncMiddleware:
    def __init__(self, app, max_attempts: int = MAX_ATTEMPTS, delay_seconds: float = REPLAY_DELAY_SECONDS):
        self.app = app
        self.max_attempts = max_attempts
        self.delay_seconds = delay_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not settings.s3_sync_enabled:
            await self.app(scope, receive, send)
            return

        body = await self._read_body(receive)
        method = scope.get("method", "GET")

        for attempt in range(1, self.max_attempts + 1):
            # A fresh state per attempt: flags from a lost attempt must not leak.
            attempt_scope = dict(scope)
            attempt_scope["state"] = dict(scope.get("state") or {})
            messages: list[dict] = []
            delivered = False

            async def replay_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": body, "more_body": False}
                # The whole body was sent; anything further is the real client
                # (a disconnect, or waiting like a quiet client would).
                return await receive()

            async def capture(message):
                messages.append(message)

            await self.app(attempt_scope, replay_receive, capture)
            state = attempt_scope["state"]

            conflicted = bool(state.get("vault_conflict"))
            if not conflicted and (method in MUTATING_METHODS or state.get("vault_write")):
                if sync_scheduler.has_pending_changes():
                    try:
                        await run_in_threadpool(sync_now)
                    except VaultConflictError:
                        conflicted = True
                    except VaultSyncFailedError:
                        await vault_sync_failed_response()(scope, receive, send)
                        return

            if not conflicted:
                for message in messages:
                    await send(message)
                return

            if state.get("no_replay") or attempt == self.max_attempts:
                logger.warning(
                    "Vault write conflict on %s %s after %d attempt(s); answering 409",
                    method,
                    scope.get("path"),
                    attempt,
                )
                await vault_conflict_response()(scope, receive, send)
                return

            logger.info(
                "Vault write conflict on %s %s; replaying on the reloaded vault (attempt %d)",
                method,
                scope.get("path"),
                attempt + 1,
            )
            await asyncio.sleep(self.delay_seconds * attempt * (0.5 + random.random()))

    @staticmethod
    async def _read_body(receive) -> bytes:
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                break
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        return b"".join(chunks)
