from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.batching import delete_in_batches, update_in_batches
from app.core.database import get_db
from app.core.period_lock import PeriodClosedError, locked_before
from app.models.goal import Goal
from app.models.investment import Holding, InvestmentActivity, Lot
from app.models.snapshot import AccountBalanceSnapshot
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit
from app.models.account import Account, AccountType, LoanCompounding
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse
from app.schemas.loans import AmortizationScheduleResponse, LoanSplitSuggestion
from app.services.loans.amortization import generate_amortization_schedule, suggest_loan_split

router = APIRouter(prefix="/accounts", tags=["Accounts"])


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    is_active: bool | None = None,
    account_type: AccountType | None = None,
    owner_member_id: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(Account)
    if is_active is not None:
        query = query.filter(Account.is_active == is_active)
    if account_type is not None:
        query = query.filter(Account.type == account_type)
    if owner_member_id is not None:
        query = query.filter(Account.owner_member_id == owner_member_id)
    return query.order_by(Account.name.asc()).all()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account_in: AccountCreate, db: Session = Depends(get_db)):
    data = account_in.model_dump()
    # A Canadian fixed-rate mortgage compounds semi-annually; default new mortgage
    # accounts accordingly unless the caller said otherwise.
    if data.get("type") == AccountType.MORTGAGE and "compounding" not in account_in.model_fields_set:
        data["compounding"] = LoanCompounding.SEMI_ANNUAL
    account = Account(**data)
    db.add(account)
    db.commit()
    db.refresh(account)
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
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(account, field, value)

    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: str, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    delete_account_history(db, account)
    db.delete(account)
    db.commit()
    return None


def delete_account_history(db: Session, account: Account) -> None:
    """Remove everything that belongs to an account, in bounded transactions.

    An account can hold tens of thousands of transactions, more than one
    database transaction may change, so its history goes in batches before
    the account row itself. Links from other rows (the other half of a
    transfer, statement files, goals) are cleared rather than relying on the
    database's ON DELETE actions. Transactions in a closed year block the
    delete, as editing them would.
    """
    boundary = locked_before(db)
    if boundary is not None:
        locked = db.scalar(
            select(Transaction.transaction_date)
            .where(Transaction.account_id == account.id, Transaction.transaction_date < boundary)
            .order_by(Transaction.transaction_date.desc())
            .limit(1)
        )
        if locked is not None:
            raise PeriodClosedError(locked.year)

    account_id = account.id
    own_txns = select(Transaction.id).where(Transaction.account_id == account_id).scalar_subquery()
    update_in_batches(
        db,
        Transaction,
        {"transfer_transaction_id": None},
        Transaction.transfer_transaction_id.in_(own_txns),
    )
    delete_in_batches(db, TransactionSplit, TransactionSplit.transaction_id.in_(own_txns))
    delete_in_batches(db, Transaction, Transaction.account_id == account_id)
    delete_in_batches(db, AccountBalanceSnapshot, AccountBalanceSnapshot.account_id == account_id)
    own_holdings = select(Holding.id).where(Holding.account_id == account_id).scalar_subquery()
    delete_in_batches(db, Lot, Lot.holding_id.in_(own_holdings))
    delete_in_batches(db, Holding, Holding.account_id == account_id)
    delete_in_batches(db, InvestmentActivity, InvestmentActivity.account_id == account_id)
    db.query(StatementFile).filter(StatementFile.account_id == account_id).update(
        {StatementFile.account_id: None}, synchronize_session=False
    )
    db.query(Goal).filter(Goal.linked_account_id == account_id).update(
        {Goal.linked_account_id: None}, synchronize_session=False
    )
    db.commit()
    db.expire(account)


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
