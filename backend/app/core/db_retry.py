"""Replay a request whose write lost a race with another session.

The database runs every transaction at REPEATABLE READ with optimistic
concurrency: when two people save overlapping rows at the same moment, one
commit wins and the other fails with a serialization error (SQLSTATE 40001, or
OC000/OC001 on the serverless database). The losing transaction was rolled back
entirely, so running the same request again sees the winner's data and gives
the result the person expected. This middleware therefore:

1. reads the request body into memory (bodies are capped well below Lambda's
   6 MB payload limit), so the request can be sent to the app again;
2. runs the app, holding the response back;
3. when the exception handler flagged ``state["db_conflict"]``, waits a moment
   and replays, up to ``MAX_ATTEMPTS`` times in all, answering 409
   ``write_conflict`` only when every attempt lost.

Requests with effects outside the database (sending an invitation email,
uploading a year archive) set ``state["no_replay"]`` and are never repeated.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time

from sqlalchemy.exc import DBAPIError
from starlette.responses import JSONResponse

from app.core.logging import EVENT_WRITE_CONFLICT, log_event

logger = logging.getLogger("folio.db")

MAX_ATTEMPTS = 3
# Base pause before a replay; grows with each attempt, with jitter so two
# losers do not collide again.
REPLAY_DELAY_SECONDS = 0.05

CONFLICT_SQLSTATES = frozenset({"40001", "OC000", "OC001"})

WRITE_CONFLICT_MESSAGE = (
    "Someone else saved at the same moment, so your change wasn't saved. Please try again."
)


def is_write_conflict(exc: BaseException) -> bool:
    """True for a serialization failure that a retry can resolve."""
    if isinstance(exc, DBAPIError):
        exc = exc.orig or exc
    code = getattr(exc, "sqlstate", None) or getattr(exc, "pgcode", None)
    return code in CONFLICT_SQLSTATES


def write_conflict_response() -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": {"code": "write_conflict", "message": WRITE_CONFLICT_MESSAGE}},
    )


class DbRetryMiddleware:
    def __init__(self, app, max_attempts: int = MAX_ATTEMPTS, delay_seconds: float = REPLAY_DELAY_SECONDS):
        self.app = app
        self.max_attempts = max_attempts
        self.delay_seconds = delay_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
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

            if not state.get("db_conflict"):
                for message in messages:
                    await send(message)
                return

            if state.get("no_replay") or attempt == self.max_attempts:
                log_event(
                    logger,
                    logging.WARNING,
                    EVENT_WRITE_CONFLICT,
                    f"Write conflict on {method} {scope.get('path')} after {attempt} attempt(s); answering 409",
                    method=method,
                    path=scope.get("path"),
                    attempts=attempt,
                )
                await write_conflict_response()(scope, receive, send)
                return

            logger.info(
                "Write conflict on %s %s; replaying (attempt %d)",
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


def retry_on_conflict(db, work, attempts: int = MAX_ATTEMPTS):
    """Run ``work()`` (which commits) again after a write conflict.

    For idempotent follow-up steps, such as recomputing balances after an
    import has committed: replaying the whole request would repeat work that
    already landed, so only this step is retried.
    """
    for attempt in range(1, attempts + 1):
        try:
            return work()
        except DBAPIError as exc:
            db.rollback()
            if not is_write_conflict(exc) or attempt == attempts:
                raise
            time.sleep(REPLAY_DELAY_SECONDS * attempt * (0.5 + random.random()))
