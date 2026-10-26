from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.money import from_cents, to_cents
from app.models.account import Account
from app.models.goal import Goal
from app.schemas.goal import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    EmergencyFundCalcRequest,
    EmergencyFundCalcResponse,
    CraSummaryResponse,
)
from app.services.goals.cra_rules import calculate_emergency_fund, get_cra_contribution_summary

router = APIRouter(prefix="/goals", tags=["Goals"])


def _to_goal_response(goal: Goal, db: Session) -> GoalResponse:
    # If linked to an account, current balance is drawn from the account
    if goal.linked_account_id:
        acc = db.query(Account).filter(Account.id == goal.linked_account_id).first()
        effective_current = float(acc.current_balance) if acc else 0.0
    else:
        effective_current = float(from_cents(goal.current_amount_cents)) if goal.current_amount_cents is not None else 0.0

    target = float(from_cents(goal.target_amount_cents))
    progress = round((float(effective_current) / target * 100.0), 1) if target > 0 else 0.0

    return GoalResponse(
        id=goal.id,
        name=goal.name,
        type=goal.type,
        target_amount=target,
        current_amount=float(from_cents(goal.current_amount_cents)) if goal.current_amount_cents is not None else None,
        effective_current_amount=round(effective_current, 2),
        progress_percentage=min(progress, 999.0),
        target_date=goal.target_date,
        emergency_fund_months=goal.emergency_fund_months,
        excluded_category_ids=goal.excluded_category_ids,
        linked_account_id=goal.linked_account_id,
        owner_member_id=goal.owner_member_id,
        notes=goal.notes,
        created_at=goal.created_at,
        updated_at=goal.updated_at,
    )


@router.get("", response_model=list[GoalResponse])
def list_goals(
    owner_member_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Lists all household savings and CRA tracking goals."""
    query = db.query(Goal)
    if owner_member_id:
        query = query.filter(Goal.owner_member_id == owner_member_id)
    goals = query.order_by(Goal.created_at.asc()).all()
    return [_to_goal_response(g, db) for g in goals]


@router.post("", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(goal_in: GoalCreate, db: Session = Depends(get_db)):
    """Creates a new savings, debt payoff, or CRA room goal."""
    from app.core.s3_sync import sync_db_if_configured
    data = goal_in.model_dump()
    data["target_amount_cents"] = to_cents(data.pop("target_amount"))
    cur = data.pop("current_amount", None)
    data["current_amount_cents"] = to_cents(cur) if cur is not None else None

    goal = Goal(**data)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    sync_db_if_configured()
    return _to_goal_response(goal, db)


@router.get("/emergency-fund-calc", response_model=EmergencyFundCalcResponse)
def get_emergency_fund_suggestion(
    months: int = Query(6, ge=1, le=36, description="Emergency fund duration in months"),
    lookback_months: int = Query(6, ge=1, le=24, description="Lookback window in months"),
    excluded_categories: str | None = Query(None, description="Comma-separated category IDs to exclude"),
    db: Session = Depends(get_db),
):
    """Calculates suggested emergency fund with optional category exclusions."""
    excl_list = [c.strip() for c in excluded_categories.split(",") if c.strip()] if excluded_categories else []
    return calculate_emergency_fund(
        db,
        months=months,
        lookback_months=lookback_months,
        excluded_category_ids=excl_list,
    )


@router.post("/emergency-fund-calc", response_model=EmergencyFundCalcResponse)
def post_emergency_fund_calc(req: EmergencyFundCalcRequest, db: Session = Depends(get_db)):
    """Calculates suggested emergency fund via POST payload."""
    return calculate_emergency_fund(
        db,
        months=req.months,
        lookback_months=req.lookback_months,
        excluded_category_ids=req.excluded_category_ids,
    )


@router.get("/cra-limits", response_model=CraSummaryResponse)
def get_cra_limits(
    year: int | None = Query(None, description="Tax year (defaults to current year)"),
    db: Session = Depends(get_db),
):
    """Calculates TFSA and FHSA contribution room per household member."""
    return get_cra_contribution_summary(db, year=year)


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _to_goal_response(goal, db)


@router.put("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: str,
    goal_in: GoalUpdate,
    db: Session = Depends(get_db),
):
    from app.core.s3_sync import sync_db_if_configured
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    data = goal_in.model_dump(exclude_unset=True)
    if "target_amount" in data:
        data["target_amount_cents"] = to_cents(data.pop("target_amount"))
    if "current_amount" in data:
        cur = data.pop("current_amount")
        data["current_amount_cents"] = to_cents(cur) if cur is not None else None

    for field, val in data.items():
        setattr(goal, field, val)

    db.commit()
    db.refresh(goal)
    sync_db_if_configured()
    return _to_goal_response(goal, db)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: str, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    db.delete(goal)
    db.commit()
    sync_db_if_configured()
    return None
