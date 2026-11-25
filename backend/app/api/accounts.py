from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app.core.actor import Actor, authorize
from app.core.batching import delete_in_batches, update_in_batches
from app.core.database import get_db
from app.core.period_lock import PeriodClosedError, locked_before
from app.core.visibility import is_restricted, totals_scope, unrestricted
from app.models.household import HouseholdMember
from app.models.goal import Goal
from app.models.investment import Holding, InvestmentActivity, Lot
from app.models.snapshot import AccountBalanceSnapshot
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit
from app.models.account import Account, AccountType, AccountVisibility, LoanCompounding
from app.schemas.account import AccountCreate, AccountUpdate, AccountResponse
from app.schemas.loans import AmortizationScheduleResponse, LoanSplitSuggestion
from app.services.loans.amortization import generate_amortization_schedule, suggest_loan_split

router = APIRouter(prefix="/accounts", tags=["Accounts"])


def _redacted(account: Account) -> AccountResponse:
    """Someone else's "totals only" account: enough for household totals, no more."""
    names = account.owner_names
    label = f"{names[0]}’s account" if len(names) == 1 else "A household member’s account"
    return AccountResponse(
        id=account.id,
        name=label,
        type=account.type,
        currency=account.currency,
        current_balance=account.current_balance,
        is_active=account.is_active,
        owner_member_ids=account.owner_member_ids,
        owner_names=names,
        visibility=AccountVisibility.TOTALS,
        redacted=True,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    is_active: bool | None = None,
    account_type: AccountType | None = None,
    owner_member_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Accounts the signed-in person can see, plus others' "totals only"
    accounts in redacted form (so net worth adds up). Private accounts of
    others are never listed."""

    def query():
        q = db.query(Account).options(selectinload(Account.owners))
        if is_active is not None:
            q = q.filter(Account.is_active == is_active)
        if account_type is not None:
            q = q.filter(Account.type == account_type)
        if owner_member_id is not None:
            q = q.filter(Account.owners.any(HouseholdMember.id == owner_member_id))
        return q.order_by(Account.name.asc())

    visible = query().all()
    result: list = list(visible)
    if is_restricted():
        seen = {a.id for a in visible}
        with totals_scope():
            result.extend(_redacted(a) for a in query().all() if a.id not in seen)
    return result


def _check_ownership(
    db: Session,
    actor: Actor,
    account: Account | None,
    owner_ids: list[str] | None,
    visibility: AccountVisibility | None,
) -> tuple[list[HouseholdMember] | None, AccountVisibility | None]:
    """Validate a change of owners and/or visibility; returns what to apply.

    - Only an account's owners may change its visibility, or the owners of an
      account that is not visible to the household.
    - "Totals only" and "Private" need the person making the change among the
      owners, so nobody hides an account from themselves, or a child's account
      (no sign-in) from everybody.
    The single passphrase owner has nobody to hide anything from: any change goes.
    """
    members = None
    if owner_ids is not None:
        wanted = list(dict.fromkeys(i for i in owner_ids if i))
        members = db.query(HouseholdMember).filter(HouseholdMember.id.in_(wanted)).all() if wanted else []
        if len(members) != len(wanted):
            raise HTTPException(status_code=404, detail="Household member not found")
    if actor.local:
        return members, visibility

    current_owner_ids = set(account.owner_member_ids) if account is not None else set()
    current_visibility = account.effective_visibility if account is not None else AccountVisibility.HOUSEHOLD
    caller_owns = actor.member_id is not None and actor.member_id in current_owner_ids
    changes_visibility = visibility is not None and visibility != current_visibility
    changes_owners = members is not None and {m.id for m in members} != current_owner_ids

    if account is not None and current_owner_ids and not caller_owns:
        if changes_visibility or (changes_owners and current_visibility != AccountVisibility.HOUSEHOLD):
            raise HTTPException(
                status_code=403,
                detail={"code": "not_account_owner", "message": "Only the account’s owners can change who sees it."},
            )

    final_visibility = visibility or current_visibility
    final_owner_ids = {m.id for m in members} if members is not None else current_owner_ids
    if final_visibility != AccountVisibility.HOUSEHOLD and (
        actor.member_id is None or actor.member_id not in final_owner_ids
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "owner_required",
                "message": "Add yourself (or another person who signs in) as an owner first.",
            },
        )
    return members, visibility


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    account_in: AccountCreate,
    actor: Actor = Depends(authorize),
    db: Session = Depends(get_db),
):
    data = account_in.model_dump(exclude={"owner_member_ids", "visibility"})
    # A Canadian fixed-rate mortgage compounds semi-annually; default new mortgage
    # accounts accordingly unless the caller said otherwise.
    if data.get("type") == AccountType.MORTGAGE and "compounding" not in account_in.model_fields_set:
        data["compounding"] = LoanCompounding.SEMI_ANNUAL
    owner_ids = account_in.owner_member_ids
    if owner_ids is None:
        owner_ids = [actor.member_id] if actor.member_id else []
    members, visibility = _check_ownership(db, actor, None, owner_ids, account_in.visibility)
    account = Account(**data)
    account.owners = members or []
    account.visibility = None if visibility in (None, AccountVisibility.HOUSEHOLD) else visibility.value
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
    actor: Actor = Depends(authorize),
    db: Session = Depends(get_db),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account_in.model_dump(exclude_unset=True)
    owner_ids = update_data.pop("owner_member_ids", None)
    visibility = update_data.pop("visibility", None)
    members, visibility = _check_ownership(db, actor, account, owner_ids, visibility)
    if members is not None:
        account.owners = members
    if visibility is not None:
        account.visibility = None if visibility == AccountVisibility.HOUSEHOLD else visibility.value
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

    The caller already found the account, so it may delete it; the history
    is removed unrestricted, because the other half of a transfer can sit in
    an account the caller cannot see.
    """
    with unrestricted():
        _delete_account_rows(db, account)


def _delete_account_rows(db: Session, account: Account) -> None:
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
    account.owners = []
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
