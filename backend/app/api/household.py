from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
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


@router.post("/members", response_model=HouseholdMemberResponse, status_code=status.HTTP_201_CREATED)
def create_household_member(member_in: HouseholdMemberCreate, db: Session = Depends(get_db)):
    """Creates a new household member (e.g. Partner, Primary, Dependent)."""
    from app.core.s3_sync import sync_db_if_configured
    member = HouseholdMember(**member_in.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    sync_db_if_configured()
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
    from app.core.s3_sync import sync_db_if_configured
    member = db.query(HouseholdMember).filter(HouseholdMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Household member not found")

    for field, val in member_in.model_dump(exclude_unset=True).items():
        setattr(member, field, val)

    db.commit()
    db.refresh(member)
    sync_db_if_configured()
    return member


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_household_member(member_id: str, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    member = db.query(HouseholdMember).filter(HouseholdMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Household member not found")

    db.delete(member)
    db.commit()
    sync_db_if_configured()
    return None
