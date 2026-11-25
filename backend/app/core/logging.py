"""Structured JSON logging with a per-request correlation id.

Every record is one JSON object per line on stdout, which Lambda's JSON log
format and CloudWatch metric filters can match on directly. Operational events
that alarms depend on carry a stable ``event`` field:

- ``write_conflict``    a save lost every retry against concurrent writers
- ``http_5xx``          a request ended in a server error

Emit them with ``log_event(logger, logging.WARNING, "write_conflict", "...")``.

Access log: ``RequestContextMiddleware`` writes one INFO record per request on
the ``folio.access`` logger with ``method``, ``path`` (never the query string,
which can carry search terms), ``status``, ``duration_ms``, ``request_id`` and
``client_ip``. Uvicorn's own access log is switched off (``--no-access-log`` and
here), and its startup/error loggers go through the same JSON handler.
"""
from __future__ import annotations

import json
import logging
import sys
import time
import traceback
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

EVENT_WRITE_CONFLICT = "write_conflict"
EVENT_HTTP_5XX = "http_5xx"

request_id_var: ContextVar[str | None] = ContextVar("folio_request_id", default=None)

# Attributes every LogRecord has; anything else was passed through `extra=`.
_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime", "taskName"}
# Uvicorn passes a copy of each startup message with ANSI colour codes; the
# plain "message" already carries it.
_RESERVED.add("color_message")


_LAMBDA_LEVEL_NAMES = {"WARNING": "WARN", "CRITICAL": "FATAL"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            # Lambda's application log-level filter understands WARN/FATAL, not WARNING/CRITICAL.
            "level": _LAMBDA_LEVEL_NAMES.get(record.levelname, record.levelname),
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None) or request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key in _RESERVED or key in payload or key.startswith("_"):
                continue
            payload[key] = value
        if record.exc_info:
            payload["exception"] = "".join(traceback.format_exception(*record.exc_info)).rstrip()
        elif record.stack_info:
            payload["stack"] = record.stack_info
        return json.dumps(payload, default=str)


class _FolioHandler(logging.StreamHandler):
    """Marker subclass so configure_logging stays idempotent."""


def configure_logging(level: int = logging.INFO) -> None:
    """Install the JSON handler on the root logger once, at INFO."""
    root = logging.getLogger()
    if not any(isinstance(h, _FolioHandler) for h in root.handlers):
        handler = _FolioHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        root.addHandler(handler)
    root.setLevel(level)
    # Uvicorn configures its loggers (plain-text handlers, propagate off) before
    # it imports the app, so this runs afterwards (at app import and again in the
    # lifespan) and takes them over: startup and error lines become JSON, and
    # uvicorn's access log is silenced because folio.access replaces it.
    for name in ("uvicorn", "uvicorn.error"):
        server_logger = logging.getLogger(name)
        server_logger.handlers.clear()
        server_logger.propagate = True
        server_logger.disabled = False
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.propagate = False
    access_logger.disabled = True
    # Per-plugin setup chatter on every Alembic invocation.
    logging.getLogger("alembic.runtime.plugins").setLevel(logging.WARNING)
    # Loggers created before this point (or disabled by an earlier fileConfig)
    # must still emit.
    for name in list(logging.root.manager.loggerDict):
        if name.startswith(("folio", "app")):
            existing = logging.getLogger(name)
            existing.disabled = False


def log_event(logger: logging.Logger, level: int, event: str, message: str, *, exc_info=None, **fields) -> None:
    """Log a record that carries a machine-matchable ``event`` field."""
    logger.log(level, message, extra={"event": event, **fields}, exc_info=exc_info)


def request_id_from_headers(headers) -> str:
    """Correlation id for a request.

    Behind the Lambda Web Adapter, the invocation's request context arrives as
    JSON in ``x-amzn-request-context``; its ``requestId`` matches the id in the
    Lambda/CloudFront logs. Otherwise fall back to the X-Ray trace header, and
    finally to a fresh UUID.
    """
    raw_context = headers.get("x-amzn-request-context")
    if raw_context:
        try:
            context = json.loads(raw_context)
            request_id = context.get("requestId") if isinstance(context, dict) else None
            if request_id:
                return str(request_id)
        except (ValueError, TypeError):
            pass
    trace_id = headers.get("x-amzn-trace-id")
    if trace_id:
        return trace_id
    return uuid.uuid4().hex


def _client_ip(scope) -> str:
    """The viewer address, resolved the same way as the rate limiter's key."""
    from starlette.requests import HTTPConnection

    from app.core.rate_limit import client_key

    return client_key(HTTPConnection(scope))


class RequestContextMiddleware:
    """Pure ASGI middleware: binds the request id, logs 5xx responses and
    writes one ``folio.access`` record per request.

    Every request is logged, health checks included: on Lambda the readiness
    probe runs once per cold start, and in Docker the 30-second HEALTHCHECK line
    shows the container is alive, so filtering them would hide more than it saves.

    Pure ASGI (not BaseHTTPMiddleware) so the context variable is set in the
    request's own task and remains visible to the outer exception handler.
    """

    def __init__(self, app):
        self.app = app
        self.logger = logging.getLogger("folio.http")
        self.access_logger = logging.getLogger("folio.access")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        request_id = request_id_from_headers(headers)
        request_id_var.set(request_id)
        started = time.perf_counter()
        # An exception that escapes the app is answered with a 500 by Starlette's
        # outermost middleware, which this wrapper never sees.
        status = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_code = message["status"]
                status["code"] = status_code
                if status_code >= 500:
                    log_event(
                        self.logger,
                        logging.ERROR,
                        EVENT_HTTP_5XX,
                        f"{scope.get('method')} {scope.get('path')} returned {status_code}",
                        status_code=status_code,
                        method=scope.get("method"),
                        path=scope.get("path"),
                    )
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(b"x-request-id", request_id.encode("latin-1"))]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            self._log_access(scope, status["code"], started, request_id)

    def _log_access(self, scope, status_code: int, started: float, request_id: str) -> None:
        method = scope.get("method")
        path = scope.get("path")
        self.access_logger.info(
            f"{method} {path} {status_code}",
            extra={
                "method": method,
                "path": path,
                "status": status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "request_id": request_id,
                "client_ip": _client_ip(scope),
            },
        )
