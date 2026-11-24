import logging
from contextlib import asynccontextmanager
from ipaddress import ip_address
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
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
    require_auth,
)
from app.core.s3_sync import (  # noqa: E402
    VaultConflictError,
    VaultSyncFailedError,
    startup_restore,
    sync_now,
)
from app.core.sync_scheduler import sync_scheduler  # noqa: E402
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

logger = logging.getLogger("folio.app")

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
VAULT_CONFLICT_MESSAGE = (
    "The vault was changed from another session. Your last change was not saved; "
    "the latest data has been reloaded."
)
VAULT_SYNC_FAILED_MESSAGE = "Your change wasn't saved. Please try again."


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


@app.exception_handler(VaultConflictError)
async def handle_vault_conflict(request: Request, exc: VaultConflictError):
    return vault_conflict_response()


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
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


def _build_csp() -> str:
    """Content-Security-Policy, with the Cognito hosts resolved for this region."""
    connect_src = ["'self'"]
    if settings.is_cognito_enabled:
        region = settings.COGNITO_REGION
        connect_src.append(f"https://cognito-idp.{region}.amazonaws.com")
        connect_src.append(f"https://cognito-identity.{region}.amazonaws.com")
    cognito_connect_src = "connect-src " + " ".join(connect_src)

    return "; ".join([
        "default-src 'self'",
        "script-src 'self'",
        # index.html loads Plus Jakarta Sans and JetBrains Mono from Google Fonts.
        # Without these two hosts the policy blocks the stylesheet and the font
        # files, and production silently falls back to the system sans-serif.
        # Self-hosting the two families would let both entries be dropped.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        cognito_connect_src,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ])


@app.middleware("http")
async def flush_vault_on_lambda(request: Request, call_next):
    """Lambda freezes the container once a response is sent, so nothing can
    upload afterwards. Upload synchronously before a mutating request returns.

    A save is either durable or visibly rejected:
    - a conflicting writer turns the response into 409 vault_conflict;
    - any other upload failure discards this container's local change (the
      vault is re-downloaded from S3) and turns it into 503 vault_sync_failed.
    """
    response = await call_next(request)
    if (
        request.method in MUTATING_METHODS
        and settings.s3_sync_enabled
        and sync_scheduler.has_pending_changes()
    ):
        try:
            await run_in_threadpool(sync_now)
        except VaultConflictError:
            return vault_conflict_response()
        except VaultSyncFailedError:
            return vault_sync_failed_response()
    return response


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Injects comprehensive defense-in-depth security headers into every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"

    response.headers["Content-Security-Policy"] = _build_csp()
    return response


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


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)
# Added last = outermost: the request id is bound first, then the origin gate.
app.add_middleware(OriginVerifyMiddleware)
app.add_middleware(RequestContextMiddleware)

# Public Auth router
app.include_router(auth_router, prefix=settings.API_V1_STR)

# Protected API routers (require authentication)
app.include_router(accounts_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(categories_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(transactions_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(rules_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(ingestion_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(budgets_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(analytics_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(maintenance_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(investments_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(household_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(goals_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(classification_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])
app.include_router(bootstrap_router, prefix=settings.API_V1_STR, dependencies=[Depends(require_auth)])


@app.get("/api/health", tags=["Health"])
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

if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # Pre-indexed dictionary of safe root PWA files discovered on disk at startup
    ROOT_PWA_FILES: dict[str, Path] = {}
    for name in ["favicon.ico", "manifest.webmanifest", "registerSW.js", "sw.js"]:
        fpath = STATIC_DIR / name
        if fpath.is_file():
            ROOT_PWA_FILES[name] = fpath
    for fpath in STATIC_DIR.glob("workbox-*.js"):
        if fpath.is_file():
            ROOT_PWA_FILES[fpath.name] = fpath

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Unknown API paths are API errors, not app routes: answer with a JSON 404
        # instead of the SPA shell, so clients and probes see the real status.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        # Look up requested file in safe pre-indexed Path dictionary
        target = ROOT_PWA_FILES.get(full_path.strip("/"))
        if target is not None:
            return FileResponse(target)
        # All other application paths render the Single Page Application shell
        return FileResponse(STATIC_DIR / "index.html")
