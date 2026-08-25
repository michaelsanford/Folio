from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.core.security import require_auth
from app.core.s3_sync import restore_db_from_s3, sync_db_to_s3
import app.models  # noqa: F401 - registers SQLAlchemy models with Base metadata

from app.api.auth import router as auth_router
from app.api.accounts import router as accounts_router
from app.api.categories import router as categories_router, seed_default_categories
from app.api.transactions import router as transactions_router
from app.api.rules import router as rules_router, seed_default_rules
from app.api.ingestion import router as ingestion_router
from app.api.budgets import router as budgets_router
from app.api.analytics import router as analytics_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # If S3 bucket configured (e.g. Lambda serverless cold start), restore database
    if settings.S3_BUCKET_NAME:
        restore_db_from_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)

    # Ensure database schema is created
    Base.metadata.create_all(bind=engine)
    
    # Ensure default categories and categorization rules are seeded
    db = SessionLocal()
    try:
        seed_default_categories(db)
        seed_default_rules(db)
    finally:
        db.close()
        
    yield

    # On graceful shutdown / checkpoint
    if settings.S3_BUCKET_NAME:
        sync_db_to_s3(settings.SQLITE_DB_PATH, settings.S3_BUCKET_NAME, settings.AWS_REGION)


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


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Injects comprehensive defense-in-depth security headers into every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    
    # Modern Content Security Policy (allows Cognito auth and self assets)
    csp_directives = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "img-src 'self' data: https:",
        "connect-src 'self' https://cognito-idp.*.amazonaws.com https://cognito-identity.*.amazonaws.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
    response.headers["Content-Security-Policy"] = "; ".join(csp_directives)
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

    ALLOWED_ROOT_PWA_FILES = {
        "favicon.ico",
        "manifest.webmanifest",
        "registerSW.js",
        "sw.js",
    }

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Allow exact matching for known root PWA static files
        if full_path:
            file_name = full_path.split("/")[-1]
            if file_name in ALLOWED_ROOT_PWA_FILES or (file_name.startswith("workbox-") and file_name.endswith(".js")):
                target = STATIC_DIR / file_name
                if target.is_file():
                    return FileResponse(target)
        # All other application paths render the Single Page Application shell
        return FileResponse(STATIC_DIR / "index.html")


