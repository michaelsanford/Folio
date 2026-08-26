from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.core.config import settings, validate_production_settings
from app.core.database import SessionLocal
from app.core.migrations import run_migrations
from app.core.security import require_auth
from app.core.s3_sync import restore_db_from_s3, sync_now
import app.models  # noqa: F401 - registers SQLAlchemy models with Base metadata

from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.categories import router as categories_router, seed_default_categories
from app.api.transactions import router as transactions_router
from app.api.rules import router as rules_router, seed_default_rules
from app.api.ingestion import router as ingestion_router
from app.api.budgets import router as budgets_router
from app.api.analytics import router as analytics_router
from app.api.maintenance import router as maintenance_router
from app.api.investments import router as investments_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # If S3 bucket configured (e.g. Lambda serverless cold start), restore database
    if settings.S3_BUCKET_NAME:
        restore_db_from_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)

    # Refuse to serve production traffic with development-grade secrets.
    problems = validate_production_settings()
    if problems:
        raise RuntimeError(
            "Refusing to start in production with unsafe configuration:\n  - "
            + "\n  - ".join(problems)
        )

    if not settings.SKIP_STARTUP_TASKS:
        # Bring the schema up to head (creates it on a fresh database)
        run_migrations()

        # Ensure default categories and categorization rules are seeded
        db = SessionLocal()
        try:
            seed_default_categories(db)
            seed_default_rules(db)
        finally:
            db.close()

    yield

    # On graceful shutdown, flush anything the debounce window still holds.
    sync_now()


# In production mode, disable public Swagger docs to prevent API surface scanning
is_prod = settings.ENVIRONMENT.lower() == "production"

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Folio - Self-hosted Personal Finance & Budgeting Engine",
    version="1.0.0",
    openapi_url=None if is_prod else f"{settings.API_V1_STR}/openapi.json",
    docs_url=None if is_prod else f"{settings.API_V1_STR}/docs",
    redoc_url=None if is_prod else f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)


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


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)

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


@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "database": "sqlite_wal",
        "auth_mode": "cognito" if settings.is_cognito_enabled else "master_password",
    }


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
        # Look up requested file in safe pre-indexed Path dictionary
        target = ROOT_PWA_FILES.get(full_path.strip("/"))
        if target is not None:
            return FileResponse(target)
        # All other application paths render the Single Page Application shell
        return FileResponse(STATIC_DIR / "index.html")



