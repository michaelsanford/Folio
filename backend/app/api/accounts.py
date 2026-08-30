from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.account import Account, AccountType, LoanCompounding
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse
from app.schemas.loans import AmortizationScheduleResponse, LoanSplitSuggestion
from app.services.loans.amortization import generate_amortization_schedule, suggest_loan_split

router = APIRouter(prefix="/accounts", tags=["Accounts"])


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    is_active: bool | None = None,
    account_type: AccountType | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Account)
    if is_active is not None:
        query = query.filter(Account.is_active == is_active)
    if account_type is not None:
        query = query.filter(Account.type == account_type)
    return query.order_by(Account.name.asc()).all()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account_in: AccountCreate, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    data = account_in.model_dump()
    # A Canadian fixed-rate mortgage compounds semi-annually; default new mortgage
    # accounts accordingly unless the caller said otherwise.
    if data.get("type") == AccountType.MORTGAGE and "compounding" not in account_in.model_fields_set:
        data["compounding"] = LoanCompounding.SEMI_ANNUAL
    account = Account(**data)
    db.add(account)
    db.commit()
    db.refresh(account)
    sync_db_if_configured()
    return account


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: str,
    account_in: AccountUpdate,
    db: Session = Depends(get_db),
):
    from app.core.s3_sync import sync_db_if_configured
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(account, field, value)

    db.commit()
    db.refresh(account)
    sync_db_if_configured()
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: str, db: Session = Depends(get_db)):
    from app.core.s3_sync import sync_db_if_configured
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    db.delete(account)
    db.commit()
    sync_db_if_configured()
    return None


@router.get("/{account_id}/amortization", response_model=AmortizationScheduleResponse)
def get_loan_amortization(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type not in (
        AccountType.MORTGAGE,
        AccountType.VEHICLE_LOAN,
        AccountType.LINE_OF_CREDIT,
        AccountType.STUDENT_LOAN,
        AccountType.PERSONAL_LOAN,
        AccountType.OTHER_LIABILITY,
    ):
        raise HTTPException(status_code=400, detail="Amortization only available for loan/mortgage accounts")

    return generate_amortization_schedule(account)


@router.get("/{account_id}/suggest-split", response_model=LoanSplitSuggestion)
def get_loan_split_suggestion(
    account_id: str,
    payment_amount: float | None = Query(None, description="Optional payment amount override"),
    db: Session = Depends(get_db),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return suggest_loan_split(account, payment_amount)
