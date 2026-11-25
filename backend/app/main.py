import logging
from contextlib import asynccontextmanager
from ipaddress import ip_address
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import settings, validate_production_settings, warn_ignored_s3_bucket
from app.core.logging import (
    EVENT_HTTP_5XX,
    RequestContextMiddleware,
    configure_logging,
    log_event,
)

# Before anything else logs: JSON lines at INFO with the request id.
configure_logging()

from app.core.database import SessionLocal, get_db  # noqa: E402
from app.core.migrations import run_migrations  # noqa: E402
from app.core.security import (  # noqa: E402
    ORIGIN_FORBIDDEN_DETAIL,
    origin_header_valid,
)
from app.core.actor import authorize  # noqa: E402 - also registers the attribution listener
from app.core.s3_sync import (  # noqa: E402
    VaultConflictError,
    VaultSyncFailedError,
    startup_restore,
    sync_now,
)
from app.core.security_headers import build_csp, security_headers  # noqa: E402
from app.core.spa import mount_spa  # noqa: E402
from app.core.sync_scheduler import sync_scheduler  # noqa: E402
from app.core.vault_middleware import (  # noqa: E402
    VaultSyncMiddleware,
    vault_conflict_response,
    vault_sync_failed_response,
)
import app.models  # noqa: F401,E402 - registers SQLAlchemy models with Base metadata

from app.api.auth import router as auth_router  # noqa: E402
from app.api.accounts import router as accounts_router  # noqa: E402
from app.api.bootstrap import router as bootstrap_router  # noqa: E402
from app.api.categories import router as categories_router, seed_default_categories  # noqa: E402
from app.api.transactions import router as transactions_router  # noqa: E402
from app.api.rules import router as rules_router, seed_default_rules  # noqa: E402
from app.api.ingestion import router as ingestion_router  # noqa: E402
from app.api.budgets import router as budgets_router  # noqa: E402
from app.api.analytics import router as analytics_router  # noqa: E402
from app.api.maintenance import router as maintenance_router  # noqa: E402
from app.api.investments import router as investments_router  # noqa: E402
from app.api.household import router as household_router  # noqa: E402
from app.api.goals import router as goals_router  # noqa: E402
from app.api.classification import router as classification_router  # noqa: E402
from app.api.preferences import router as preferences_router  # noqa: E402
from app.api.people import router as people_router  # noqa: E402
from app.api.periods import router as periods_router  # noqa: E402
from app.core.period_lock import PeriodClosedError  # noqa: E402 - also registers the lock listener

logger = logging.getLogger("folio.app")



def seeding_needed(db: Session) -> bool:
    """Cheap check whether the default categories/rules seeders have work to do.

    Mirrors the seeders' own idempotency keys (category slug; upper-cased rule
    pattern whose category exists) with two single-column queries, so a warm
    vault does not load every category and rule as ORM objects on cold start.
    """
    try:
        from app.api.categories import DEFAULT_CATEGORIES
        from app.api.rules import DEFAULT_RULES
        from app.models.category import Category
        from app.models.rule import CategorizationRule
    except ImportError:
        return True

    expected_slugs = set()
    for parent in DEFAULT_CATEGORIES:
        expected_slugs.add(parent["slug"])
        expected_slugs.update(child["slug"] for child in parent.get("children", []))
    existing_slugs = set(db.scalars(select(Category.slug)))
    if not expected_slugs <= existing_slugs:
        return True

    patterns = {p.upper() for p in db.scalars(select(CategorizationRule.pattern)) if p}
    return any(
        rule["pattern"].upper() not in patterns and rule["category_slug"] in existing_slugs
        for rule in DEFAULT_RULES
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Re-apply in case a server reconfigured logging after the app was imported.
    configure_logging()
    # Lambda: restore the vault from S3, failing closed on anything but "absent".
    # Docker / local never sync to S3; a bucket set there is ignored (with a warning).
    warn_ignored_s3_bucket()
    if settings.s3_sync_enabled:
        startup_restore(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)

    # Refuse to serve production traffic with development-grade secrets.
    problems = validate_production_settings()
    if problems:
        raise RuntimeError(
            "Refusing to start in production with unsafe configuration:\n  - "
            + "\n  - ".join(problems)
        )

    if not settings.SKIP_STARTUP_TASKS:
        # Bring the schema up to head (skipped when already there).
        migrated = run_migrations()

        db = SessionLocal()
        try:
            if seeding_needed(db):
                seed_default_categories(db)
                seed_default_rules(db)
        finally:
            db.close()

        # Upload a migrated or freshly seeded vault now rather than at the next
        # write: leaving it dirty would suspend this container's freshness
        # check, and nothing flushes until a mutating request.
        if settings.s3_sync_enabled and (migrated or sync_scheduler.has_pending_changes()):
            try:
                sync_now()
            except VaultConflictError:
                logger.warning("Another container replaced the vault during startup; reloaded it.")
            except VaultSyncFailedError:
                logger.warning("Uploading the migrated or seeded vault failed; reloaded the S3 copy.")

    yield

    # Every mutating request is flushed before it returns, so normally nothing
    # is pending here; upload anything that slipped through (e.g. a write made
    # by a GET) rather than lose it with the container.
    if settings.s3_sync_enabled and sync_scheduler.has_pending_changes():
        try:
            sync_now()
        except (VaultConflictError, VaultSyncFailedError):
            logger.warning("Shutdown flush failed; local changes were discarded.")


# In production mode, disable public Swagger docs to prevent API surface scanning
is_prod = settings.is_production

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Folio - Self-hosted Personal Finance & Budgeting Engine",
    version="1.0.0",
    openapi_url=None if is_prod else f"{settings.API_V1_STR}/openapi.json",
    docs_url=None if is_prod else f"{settings.API_V1_STR}/docs",
    redoc_url=None if is_prod else f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)


@app.exception_handler(VaultConflictError)
async def handle_vault_conflict(request: Request, exc: VaultConflictError):
    # A handler that uploaded by itself lost a race: VaultSyncMiddleware replays it.
    request.state.vault_conflict = True
    return vault_conflict_response()


@app.exception_handler(PeriodClosedError)
async def handle_period_closed(request: Request, exc: PeriodClosedError):
    return JSONResponse(
        status_code=409,
        content={"detail": {"code": "period_closed", "message": str(exc), "year": exc.year}},
    )


@app.exception_handler(VaultSyncFailedError)
async def handle_vault_sync_failed(request: Request, exc: VaultSyncFailedError):
    return vault_sync_failed_response()


@app.exception_handler(Exception)
async def handle_unhandled_exception(request: Request, exc: Exception):
    """Log every unhandled error once, with its traceback; never leak details."""
    log_event(
        logger,
        logging.ERROR,
        EVENT_HTTP_5XX,
        f"Unhandled error on {request.method} {request.url.path}",
        exc_info=(type(exc), exc, exc.__traceback__),
        status_code=500,
        method=request.method,
        path=request.url.path,
    )
    # Starlette sends this response from its outermost middleware, past
    # SecurityHeadersMiddleware, so the headers are set here.
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=security_headers(request.url.path),
    )


def _build_csp() -> str:
    """Content-Security-Policy for the current settings (see core/security_headers)."""
    return build_csp()




class SecurityHeadersMiddleware:
    """Set the security headers from core/security_headers on every response.

    Pure ASGI and added outside the origin gate and CORS, so their own 403 and
    preflight responses carry the headers too. Cache-Control is set on /api/*
    only when the route did not set its own.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        values = security_headers(scope.get("path", ""))

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", []))
                headers = MutableHeaders(scope=message)
                for name, value in values.items():
                    if name == "Cache-Control" and "cache-control" in headers:
                        continue
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


class OriginVerifyMiddleware:
    """Reject requests that did not come through CloudFront, on every path.

    Active only when an origin secret is configured. The single exception is the
    in-container health probe: GET/HEAD /api/health from a loopback address that
    is not a proxied Lambda invocation. The Lambda Web Adapter readiness check
    and the Docker HEALTHCHECK call it locally without the header. Proxied
    invocations also arrive from loopback (the adapter forwards them over
    localhost) but carry x-amzn-request-context, so a direct Function URL hit on
    /api/health is still rejected.
    """

    HEALTH_PATH = "/api/health"

    def __init__(self, app):
        self.app = app

    def _exempt(self, scope, headers: dict[str, str]) -> bool:
        client = scope.get("client")
        return (
            scope.get("path") == self.HEALTH_PATH
            and scope.get("method") in ("GET", "HEAD")
            and _is_loopback(client[0] if client else None)
            and "x-amzn-request-context" not in headers
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not settings.FOLIO_ORIGIN_VERIFY_SECRET:
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        presented = {"X-Folio-Origin-Verify": headers.get("x-folio-origin-verify", "")}
        if origin_header_valid(presented) or self._exempt(scope, headers):
            await self.app(scope, receive, send)
            return
        response = JSONResponse(status_code=403, content={"detail": ORIGIN_FORBIDDEN_DETAIL})
        await response(scope, receive, send)


# Innermost: holds each response until the vault is uploaded, replaying a
# write that lost a race with another container (core/vault_middleware.py).
app.add_middleware(VaultSyncMiddleware)
# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)
# Added last = outermost: the request id is bound (and the request logged)
# first, then the security headers, then the origin gate.
app.add_middleware(OriginVerifyMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)

# Public Auth router
app.include_router(auth_router, prefix=settings.API_V1_STR)

# Protected API routers: signed in, enabled, and allowed by role (core/actor.py)
app.include_router(accounts_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(categories_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(transactions_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(rules_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(ingestion_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(budgets_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(analytics_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(maintenance_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(investments_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(household_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(goals_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(classification_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(bootstrap_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(preferences_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(people_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])
app.include_router(periods_router, prefix=settings.API_V1_STR, dependencies=[Depends(authorize)])


@app.api_route("/api/health", methods=["GET", "HEAD"], tags=["Health"])
def health_check(db: Session = Depends(get_db)):
    """Liveness/readiness: the database must answer a trivial query.

    Auth mode is not reported here; the SPA reads it from /api/auth/status.
    """
    try:
        db.execute(text("SELECT 1")).scalar_one()
    except Exception:
        logger.exception("Health check database query failed")
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "service": settings.PROJECT_NAME, "database": "unavailable"},
        )
    return {"status": "healthy", "service": settings.PROJECT_NAME, "database": "sqlite_wal"}


# Static SPA mounting for production single-container deployment
STATIC_DIR = Path("/app/static")
if not STATIC_DIR.exists():
    STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if not STATIC_DIR.exists():
    STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

mount_spa(app, STATIC_DIR)
