from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine, Base, SessionLocal
from app.models import (
    Account,
    Category,
    Transaction,
    TransactionSplit,
    CategorizationRule,
    Budget,
    BudgetItem,
    StatementFile,
)
from app.api.accounts import router as accounts_router
from app.api.categories import router as categories_router, seed_default_categories
from app.api.transactions import router as transactions_router
from app.api.rules import router as rules_router
from app.api.ingestion import router as ingestion_router
from app.api.budgets import router as budgets_router
from app.api.analytics import router as analytics_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema is created
    Base.metadata.create_all(bind=engine)
    
    # Ensure default categories seeded
    db = SessionLocal()
    try:
        seed_default_categories(db)
    finally:
        db.close()
        
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Folio - Self-hosted Personal Finance & Budgeting Engine",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(accounts_router, prefix=settings.API_V1_STR)
app.include_router(categories_router, prefix=settings.API_V1_STR)
app.include_router(transactions_router, prefix=settings.API_V1_STR)
app.include_router(rules_router, prefix=settings.API_V1_STR)
app.include_router(ingestion_router, prefix=settings.API_V1_STR)
app.include_router(budgets_router, prefix=settings.API_V1_STR)
app.include_router(analytics_router, prefix=settings.API_V1_STR)


@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "database": "sqlite_wal",
    }
