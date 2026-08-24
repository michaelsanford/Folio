from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models.rule import CategorizationRule
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.schemas.rule import (
    CategorizationRuleCreate,
    CategorizationRuleUpdate,
    CategorizationRuleResponse,
    TestRuleMatchRequest,
    TestRuleMatchResponse,
)
from app.services.categorization.rules_engine import evaluate_rules

router = APIRouter(prefix="/rules", tags=["Categorization Rules"])


@router.get("", response_model=list[CategorizationRuleResponse])
def list_rules(db: Session = Depends(get_db)):
    return (
        db.query(CategorizationRule)
        .options(joinedload(CategorizationRule.category))
        .order_by(CategorizationRule.priority.asc(), CategorizationRule.created_at.desc())
        .all()
    )


@router.post("", response_model=CategorizationRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(rule_in: CategorizationRuleCreate, db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == rule_in.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    rule = CategorizationRule(**rule_in.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CategorizationRuleResponse)
def update_rule(rule_id: str, rule_in: CategorizationRuleUpdate, db: Session = Depends(get_db)):
    rule = db.query(CategorizationRule).filter(CategorizationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = rule_in.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(rule, field, val)

    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(CategorizationRule).filter(CategorizationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    db.delete(rule)
    db.commit()
    return None


@router.post("/test", response_model=TestRuleMatchResponse)
def test_rule_match(req: TestRuleMatchRequest, db: Session = Depends(get_db)):
    match_result = evaluate_rules(db, req.raw_payee, req.amount, req.account_id)
    if not match_result.matched:
        return TestRuleMatchResponse(matched=False)

    rule = db.query(CategorizationRule).filter(CategorizationRule.id == match_result.rule_id).first()
    rule_resp = CategorizationRuleResponse.model_validate(rule) if rule else None

    return TestRuleMatchResponse(
        matched=True,
        matched_rule=rule_resp,
        suggested_category_id=match_result.category_id,
        suggested_payee=match_result.normalized_payee,
    )


@router.post("/apply-batch", status_code=status.HTTP_200_OK)
def apply_rules_batch(db: Session = Depends(get_db)):
    """
    Applies active categorization rules to all uncategorized transactions.
    """
    uncategorized_txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.splits))
        .all()
    )

    applied_count = 0
    for txn in uncategorized_txns:
        # Check if uncategorized
        is_uncategorized = not txn.splits or all(s.category_id is None for s in txn.splits)
        if not is_uncategorized:
            continue

        match = evaluate_rules(db, txn.raw_payee, txn.amount, txn.account_id)
        if match.matched:
            if match.normalized_payee:
                txn.normalized_payee = match.normalized_payee

            if txn.splits:
                txn.splits[0].category_id = match.category_id
            else:
                txn.splits.append(TransactionSplit(category_id=match.category_id, amount=txn.amount))

            applied_count += 1

    if applied_count > 0:
        db.commit()

    return {"applied_count": applied_count}
