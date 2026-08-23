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
    """Recalculates account current balance from all cleared/pending transactions."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return
    total_tx = db.query(Transaction).filter(Transaction.account_id == account_id).all()
    # Sum up amounts
    balance = sum(t.amount for t in total_tx)
    account.current_balance = round(balance, 2)
    db.commit()


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
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Transaction.raw_payee.ilike(pattern),
                Transaction.normalized_payee.ilike(pattern),
                Transaction.notes.ilike(pattern),
            )
        )
    if category_id:
        query = query.join(Transaction.splits).filter(TransactionSplit.category_id == category_id)

    total = query.count()

    # Sorting
    sort_col = getattr(Transaction, sort_by)
    query = query.order_by(desc(sort_col) if sort_order == "desc" else asc(sort_col))

    # Pagination
    offset = (page - 1) * page_size
    items = query.offset(offset).limit(page_size).all()

    return TransactionListResponse(
        total=total,
        items=items,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(txn_in: TransactionCreate, db: Session = Depends(get_db)):
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

    # If user wants to remember this rule for future imports
    if req.create_rule and transactions:
        sample_txn = transactions[0]
        pattern = req.rule_pattern or sample_txn.raw_payee
        rule = CategorizationRule(
            category_id=req.category_id,
            pattern=pattern,
            pattern_type=RulePatternType.CONTAINS,
            normalized_payee_override=req.normalized_payee or sample_txn.normalized_payee,
        )
        db.add(rule)

    db.commit()
    return {"updated_count": len(transactions)}


@router.post("/link-transfer", status_code=status.HTTP_200_OK)
def link_transfers(req: TransferLinkRequest, db: Session = Depends(get_db)):
    """Pairs two transactions as reciprocal transfers."""
    txn1 = db.query(Transaction).filter(Transaction.id == req.source_transaction_id).first()
    txn2 = db.query(Transaction).filter(Transaction.id == req.target_transaction_id).first()

    if not txn1 or not txn2:
        raise HTTPException(status_code=404, detail="One or both transactions not found")

    txn1.transfer_transaction_id = txn2.id
    txn2.transfer_transaction_id = txn1.id

    db.commit()
    return {"status": "linked", "transaction1": txn1.id, "transaction2": txn2.id}
