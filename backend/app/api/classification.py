from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_db
from app.models.rule import CategorizationRule
from app.models.transaction import Transaction, TransactionSplit
from app.schemas.classification import (
    AutoClassifyUncategorizedRequest,
    AutoClassifyUncategorizedResponse,
    BatchClassificationRequest,
    BatchClassificationResponse,
    ClassificationEvaluateRequest,
    ClassificationEvaluateResponse,
    ClassificationStatusResponse,
)
from app.services.categorization.engine import ClassificationEngine, ClassificationTier

router = APIRouter(prefix="/classification", tags=["Classification"])


@router.post("/evaluate", response_model=ClassificationEvaluateResponse)
def evaluate_transaction(
    req: ClassificationEvaluateRequest,
    db: Session = Depends(get_db),
):
    """
    Evaluates a single transaction against the 4-tier waterfall:
    1. Explicit Rules (1.0)
    2. User History
    3. Semantic Heuristics
    4. AWS Bedrock AI Recourse (if enabled)
    5. Fallback Unclassified
    """
    res = ClassificationEngine.classify_transaction(
        db=db,
        raw_payee=req.raw_payee,
        amount=req.amount,
        account_id=req.account_id,
        account_type=req.account_type,
        enable_bedrock=req.enable_bedrock,
        min_confidence=req.min_confidence,
    )
    return ClassificationEvaluateResponse(
        matched=res.matched,
        category_id=res.category_id,
        category_name=res.category_name,
        category_color=res.category_color,
        normalized_payee=res.normalized_payee,
        confidence=res.confidence,
        tier=res.tier,
        reason=res.reason,
        rule_id=res.rule_id,
    )


@router.post("/batch-evaluate", response_model=BatchClassificationResponse)
def evaluate_batch(
    req: BatchClassificationRequest,
    db: Session = Depends(get_db),
):
    """
    Evaluates a batch of transactions against the 4-tier waterfall with in-memory
    optimizations and batched AWS Bedrock AI calls.
    """
    items = [t.model_dump() for t in req.transactions]
    results = ClassificationEngine.classify_batch(
        db=db,
        items=items,
        enable_bedrock=req.enable_bedrock,
        min_confidence=req.min_confidence,
    )

    tier_counts: dict[str, int] = {tier.value: 0 for tier in ClassificationTier}
    matched_count = 0
    formatted_results: list[ClassificationEvaluateResponse] = []

    for r in results:
        tier_counts[r.tier.value] = tier_counts.get(r.tier.value, 0) + 1
        if r.matched:
            matched_count += 1
        formatted_results.append(
            ClassificationEvaluateResponse(
                matched=r.matched,
                category_id=r.category_id,
                category_name=r.category_name,
                category_color=r.category_color,
                normalized_payee=r.normalized_payee,
                confidence=r.confidence,
                tier=r.tier,
                reason=r.reason,
                rule_id=r.rule_id,
            )
        )

    return BatchClassificationResponse(
        results=formatted_results,
        total=len(formatted_results),
        matched_count=matched_count,
        tier_counts=tier_counts,
    )


@router.post("/auto-classify-uncategorized", response_model=AutoClassifyUncategorizedResponse)
def auto_classify_uncategorized(
    req: AutoClassifyUncategorizedRequest,
    db: Session = Depends(get_db),
):
    """
    Scans the database for uncategorized transactions and classifies them using
    the 4-tier waterfall. Commits matched categories to transactions unless dry_run is true.
    """
    query = (
        db.query(Transaction)
        .options(
            joinedload(Transaction.splits),
            joinedload(Transaction.account),
        )
    )
    if req.account_id:
        query = query.filter(Transaction.account_id == req.account_id)

    candidates = query.all()

    # Filter to transactions that are genuinely uncategorized
    uncategorized_txns = [
        txn for txn in candidates
        if not txn.splits or all(s.category_id is None for s in txn.splits)
    ]

    tier_counts: dict[str, int] = {tier.value: 0 for tier in ClassificationTier}
    classified_count = 0

    if uncategorized_txns:
        items = [
            {
                "raw_payee": txn.raw_payee,
                "amount": txn.amount,
                "account_id": txn.account_id,
                "account_type": (
                    txn.account.type.value
                    if txn.account and hasattr(txn.account.type, "value")
                    else (str(txn.account.type) if txn.account else None)
                ),
                "date": txn.transaction_date.isoformat() if txn.transaction_date else None,
            }
            for txn in uncategorized_txns
        ]

        results = ClassificationEngine.classify_batch(
            db=db,
            items=items,
            enable_bedrock=req.enable_bedrock,
            min_confidence=req.threshold,
        )

        for txn, res in zip(uncategorized_txns, results):
            tier_counts[res.tier.value] = tier_counts.get(res.tier.value, 0) + 1
            if res.matched and res.category_id:
                classified_count += 1
                if not req.dry_run:
                    if res.normalized_payee:
                        txn.normalized_payee = res.normalized_payee

                    if txn.splits:
                        txn.splits[0].category_id = res.category_id
                    else:
                        txn.splits.append(
                            TransactionSplit(
                                category_id=res.category_id,
                                amount=txn.amount,
                            )
                        )

        if not req.dry_run and classified_count > 0:
            db.commit()

    return AutoClassifyUncategorizedResponse(
        total_uncategorized=len(uncategorized_txns),
        classified_count=classified_count,
        tier_counts=tier_counts,
        dry_run=req.dry_run,
    )


@router.get("/status", response_model=ClassificationStatusResponse)
def get_classification_status(db: Session = Depends(get_db)):
    """
    Returns operational status of the Bedrock AI integration and categorization engine stats.
    """
    total_rules = db.query(CategorizationRule).count()
    historical_learned_count = (
        db.query(CategorizationRule)
        .filter(CategorizationRule.priority >= 10)
        .count()
    )

    return ClassificationStatusResponse(
        bedrock_enabled=settings.FOLIO_BEDROCK_ENABLED,
        bedrock_model_id=settings.FOLIO_BEDROCK_MODEL_ID,
        bedrock_region=settings.FOLIO_BEDROCK_REGION,
        total_rules=total_rules,
        historical_learned_count=historical_learned_count,
    )
