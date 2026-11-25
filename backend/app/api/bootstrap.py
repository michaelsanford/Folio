"""Single initial-load payload for the SPA.

The frontend used to fan out four requests on load (accounts, categories,
dashboard analytics, household members). On Lambda each one paid its own
invocation, auth check and S3 freshness HEAD. This returns the same four
datasets, produced by the same route functions, in one response.

Response shape::

    {
      "accounts":          [AccountResponse, ...],          # == GET /api/accounts
      "categories":        [CategoryResponse, ...],         # == GET /api/categories
      "analytics":         DashboardAnalyticsResponse,      # == GET /api/analytics/dashboard
      "household_members": [HouseholdMemberResponse, ...],  # == GET /api/household/members
      "limits":            {"max_upload_mb": int},
      "me":                MeResponse,                      # == GET /api/people/me
      "people":            [PersonSummary, ...],            # names for created_by / updated_by
      "closed_through_year": int | None                     # transactions up to Dec 31 are locked
    }
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.accounts import list_accounts
from app.api.categories import list_categories
from app.api.household import list_household_members
from app.api.people import me_response, people_summaries
from app.core.actor import Actor, authorize
from app.core.config import settings
from app.core.period_lock import closed_through_year
from app.core.database import get_db
from app.schemas.account import AccountResponse
from app.schemas.analytics import DashboardAnalyticsResponse
from app.schemas.category import CategoryResponse
from app.schemas.household import HouseholdMemberResponse
from app.schemas.people import MeResponse, PersonSummary
from app.services.analytics.engine import get_dashboard_analytics

router = APIRouter(tags=["Bootstrap"])


class BootstrapLimits(BaseModel):
    max_upload_mb: int


class BootstrapResponse(BaseModel):
    accounts: list[AccountResponse]
    categories: list[CategoryResponse]
    analytics: DashboardAnalyticsResponse
    household_members: list[HouseholdMemberResponse]
    limits: BootstrapLimits
    me: MeResponse
    people: list[PersonSummary]
    closed_through_year: int | None = None


@router.get("/bootstrap", response_model=BootstrapResponse)
def get_bootstrap(
    exclude_account_id: list[str] = Query(
        default_factory=list, max_length=100, description="Accounts the dashboard leaves out"
    ),
    db: Session = Depends(get_db),
    actor: Actor = Depends(authorize),
):
    # Arguments are passed explicitly: called directly, a parameter whose
    # default is a FastAPI Query(...) marker would receive the marker itself.
    # A plain dict: FastAPI validates it against BootstrapResponse with
    # from_attributes, exactly as each individual route serializes ORM rows.
    return {
        "accounts": list_accounts(is_active=None, account_type=None, owner_member_id=None, db=db),
        "categories": list_categories(db=db),
        # Same as GET /analytics/dashboard with no year/month (current month).
        "analytics": get_dashboard_analytics(db, None, None, exclude_account_ids=exclude_account_id),
        "household_members": list_household_members(db=db),
        "limits": {"max_upload_mb": settings.MAX_UPLOAD_MB},
        "me": me_response(actor),
        "people": people_summaries(db),
        "closed_through_year": closed_through_year(db),
    }
