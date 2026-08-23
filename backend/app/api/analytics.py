from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.analytics import DashboardAnalyticsResponse
from app.services.analytics.engine import get_dashboard_analytics

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/dashboard", response_model=DashboardAnalyticsResponse)
def get_dashboard(
    year: int | None = Query(None, description="Target year"),
    month: int | None = Query(None, description="Target month (1-12)"),
    db: Session = Depends(get_db),
):
    return get_dashboard_analytics(db, year, month)
