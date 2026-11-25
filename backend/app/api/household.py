from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.account import account_owners
from app.models.household import HouseholdMember
from app.schemas.household import (
    HouseholdMemberCreate,
    HouseholdMemberUpdate,
    HouseholdMemberResponse,
)

router = APIRouter(prefix="/household", tags=["Household"])


@router.get("/members", response_model=list[HouseholdMemberResponse])
def list_household_members(db: Session = Depends(get_db)):
    """Returns all household members."""
    return db.query(HouseholdMember).order_by(HouseholdMember.name.asc()).all()


MEMBER_COLORS = ("#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#F97316", "#64748B")


def add_member(db: Session, name: str, relationship: str | None, color: str | None = None) -> HouseholdMember:
    """Create a member (flushed, not committed). Without a colour, the next one
    from the palette, so people tell each other apart at a glance."""
    if not color:
        color = MEMBER_COLORS[db.query(HouseholdMember).count() % len(MEMBER_COLORS)]
    member = HouseholdMember(name=name.strip(), role=relationship or "Other", color=color)
    db.add(member)
    db.flush()
    return member


@router.post("/members", response_model=HouseholdMemberResponse, status_code=status.HTTP_201_CREATED)
def create_household_member(member_in: HouseholdMemberCreate, db: Session = Depends(get_db)):
    """Creates a new household member (e.g. Self, Partner, Dependent, Roommate)."""
    member = HouseholdMember(**member_in.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.get("/members/{member_id}", response_model=HouseholdMemberResponse)
def get_household_member(member_id: str, db: Session = Depends(get_db)):
    member = db.query(HouseholdMember).filter(HouseholdMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Household member not found")
    return member


@router.put("/members/{member_id}", response_model=HouseholdMemberResponse)
def update_household_member(
    member_id: str,
    member_in: HouseholdMemberUpdate,
    db: Session = Depends(get_db),
):
    member = db.query(HouseholdMember).filter(HouseholdMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Household member not found")

    for field, val in member_in.model_dump(exclude_unset=True).items():
        setattr(member, field, val)

    db.commit()
    db.refresh(member)
    return member


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_household_member(member_id: str, db: Session = Depends(get_db)):
    member = db.query(HouseholdMember).filter(HouseholdMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Household member not found")

    # Their accounts stay; only the ownership links go (explicitly, rather
    # than relying on the database's ON DELETE actions).
    db.execute(account_owners.delete().where(account_owners.c.member_id == member_id))
    db.delete(member)
    db.commit()
    return None
