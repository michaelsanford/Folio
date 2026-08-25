from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, desc, asc
from app.core.database import get_db
from app.models.transaction import Transaction, TransactionSplit, TransactionStatus
from app.models.account import Account
from app.models.category import Category
from app.models.rule import CategorizationRule, RulePatternType
from app.schemas.transaction import (
    TransactionCreate,
    TransactionUpdate,
    TransactionResponse,
    TransactionListResponse,
    BatchCategorizeRequest,
    TransferLinkRequest,
)

router = APIRouter(prefix="/transactions", tags=["Transactions"])


def recalculate_account_balance(db: Session, account_id: str):
    """Recalculates account current balance from all cleared/pending transactions and syncs to S3."""
    from app.core.s3_sync import sync_db_if_configured
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return
    total_tx = db.query(Transaction).filter(Transaction.account_id == account_id).all()
    # Sum up amounts
    balance = sum(t.amount for t in total_tx)
    account.current_balance = round(balance, 2)
    db.commit()
    sync_db_if_configured()


@router.get("", response_model=TransactionListResponse)
def list_transactions(
    account_id: str | None = None,
    category_id: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    status: TransactionStatus | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("transaction_date", pattern="^(transaction_date|amount|normalized_payee|raw_payee)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Transaction)
        .options(joinedload(Transaction.splits).joinedload(TransactionSplit.category))
    )

    if account_id:
        query = query.filter(Transaction.account_id == account_id)
    if status:
        query = query.filter(Transaction.status == status)
    if start_date:
        query = query.filter(Transaction.transaction_date >= start_date)
    if end_date:
        query = query.filter(Transaction.transaction_date <= end_date)

    if category_id:
        query = query.join(Transaction.splits).filter(TransactionSplit.category_id == category_id)

    if search:
        search_filter = or_(
            Transaction.raw_payee.ilike(f"%{search}%"),
            Transaction.normalized_payee.ilike(f"%{search}%"),
            Transaction.notes.ilike(f"%{search}%"),
        )
        query = query.filter(search_filter)

    total_count = query.distinct().count()

    # Dynamic sorting
    order_col = getattr(Transaction, sort_by)
    if sort_order == "desc":
        query = query.order_by(desc(order_col), desc(Transaction.created_at))
    else:
        query = query.order_by(asc(order_col), asc(Transaction.created_at))

    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return TransactionListResponse(
        items=items,
        total=total_count,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(txn_in: TransactionCreate, db: Session = Depends(get_db)):
    from app.api.rules import auto_learn_rule

    account = db.query(Account).filter(Account.id == txn_in.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    txn_data = txn_in.model_dump(exclude={"splits"})
    txn = Transaction(**txn_data)

    # If no splits provided, default single split with full amount
    splits_data = txn_in.splits or []
    if not splits_data:
        txn.splits.append(TransactionSplit(amount=txn.amount))
    else:
        for split_in in splits_data:
            txn.splits.append(TransactionSplit(**split_in.model_dump()))

    db.add(txn)
    db.commit()
    db.refresh(txn)

    # Adaptive learning: remember category assigned to payee
    if txn.splits and txn.splits[0].category_id:
        auto_learn_rule(db, raw_payee=txn.raw_payee, category_id=txn.splits[0].category_id, normalized_payee=txn.normalized_payee)

    # Recalculate account balance
    recalculate_account_balance(db, txn.account_id)

    return txn


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    txn = (
        db.query(Transaction)
        .options(joinedload(Transaction.splits).joinedload(TransactionSplit.category))
        .filter(Transaction.id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


@router.put("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: str,
    txn_in: TransactionUpdate,
    db: Session = Depends(get_db),
):
    from app.api.rules import auto_learn_rule

    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    update_data = txn_in.model_dump(exclude={"splits"}, exclude_unset=True)
    for field, val in update_data.items():
        setattr(txn, field, val)

    # If splits provided, replace them
    if txn_in.splits is not None:
        # Clear existing splits
        db.query(TransactionSplit).filter(TransactionSplit.transaction_id == txn.id).delete()
        for split_in in txn_in.splits:
            txn.splits.append(TransactionSplit(**split_in.model_dump()))

    db.commit()
    db.refresh(txn)

    # Adaptive learning
    if txn.splits and txn.splits[0].category_id:
        auto_learn_rule(db, raw_payee=txn.raw_payee, category_id=txn.splits[0].category_id, normalized_payee=txn.normalized_payee)

    recalculate_account_balance(db, txn.account_id)
    return txn


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: str, db: Session = Depends(get_db)):
    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    account_id = txn.account_id
    db.delete(txn)
    db.commit()

    recalculate_account_balance(db, account_id)
    return None


@router.post("/batch-categorize", status_code=status.HTTP_200_OK)
def batch_categorize(req: BatchCategorizeRequest, db: Session = Depends(get_db)):
    """
    Applies category and optional payee override to multiple transactions in one batch.
    Optionally creates a new categorization rule for future imports.
    """
    from app.api.rules import auto_learn_rule

    category = db.query(Category).filter(Category.id == req.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    transactions = db.query(Transaction).filter(Transaction.id.in_(req.transaction_ids)).all()
    
    for txn in transactions:
        if req.normalized_payee:
            txn.normalized_payee = req.normalized_payee

        # Update or create primary split
        if txn.splits:
            txn.splits[0].category_id = req.category_id
        else:
            txn.splits.append(TransactionSplit(category_id=req.category_id, amount=txn.amount))

        # Auto-learn rule for each merchant
        auto_learn_rule(db, raw_payee=txn.raw_payee, category_id=req.category_id, normalized_payee=req.normalized_payee or txn.normalized_payee)

    db.commit()
    return {"updated_count": len(transactions)}


@router.post("/link-transfer", response_model=TransactionResponse)
def link_transfer_pair(req: TransferLinkRequest, db: Session = Depends(get_db)):
    """
    Links two offsetting transactions between accounts as a transfer pair.
    """
    txn_from = db.query(Transaction).filter(Transaction.id == req.source_transaction_id).first()
    txn_to = db.query(Transaction).filter(Transaction.id == req.target_transaction_id).first()

    if not txn_from or not txn_to:
        raise HTTPException(status_code=404, detail="One or both transactions not found")

    if txn_from.id == txn_to.id:
        raise HTTPException(status_code=400, detail="Cannot link a transaction to itself")

    # Set bidirectional pointer
    txn_from.transfer_transaction_id = txn_to.id
    txn_to.transfer_transaction_id = txn_from.id

    db.commit()
    db.refresh(txn_from)
    return txn_from
