import hashlib
import os
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.models.account import Account
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit, TransactionStatus
from app.schemas.ingestion import (
    IngestionPreviewResponse,
    IngestionCommitRequest,
    IngestionCommitResponse,
    StatementFileResponse,
)
from app.services.ingestion.csv_parser import parse_csv_content
from app.services.ingestion.pdf_parser import parse_pdf_content
from app.services.ingestion.ofx_parser import parse_ofx_content
from app.api.transactions import recalculate_account_balance

router = APIRouter(prefix="/ingestion", tags=["Statement Ingestion"])


@router.post("/upload-preview", response_model=IngestionPreviewResponse)
async def upload_statement_preview(
    account_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    filename = file.filename or "statement"
    ext = Path(filename).suffix.lower()

    # Save statement file to disk
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_hash = hashlib.sha256(content).hexdigest()
    saved_filename = f"{account_id}_{file_hash[:12]}_{filename}"
    saved_path = settings.UPLOAD_DIR / saved_filename
    
    with open(saved_path, "wb") as f:
        f.write(content)

    stmt_file = StatementFile(
        account_id=account_id,
        filename=filename,
        file_path=str(saved_path),
        file_hash=file_hash,
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(content),
        transaction_count=0,
    )
    db.add(stmt_file)
    db.commit()
    db.refresh(stmt_file)

    # Route parser based on extension
    if ext == ".pdf":
        preview = parse_pdf_content(db, account_id, content, filename)
    elif ext in [".ofx", ".qfx", ".qbo"]:
        preview = parse_ofx_content(db, account_id, content, filename)
    else:  # Default to CSV / text
        preview = parse_csv_content(db, account_id, content, filename)

    preview.file_id = stmt_file.id
    return preview


@router.post("/commit", response_model=IngestionCommitResponse)
def commit_ingestion_batch(req: IngestionCommitRequest, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == req.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    committed_count = 0

    for item in req.items:
        try:
            trn_date = datetime.strptime(item.transaction_date, "%Y-%m-%d")
        except ValueError:
            trn_date = datetime.now()

        # Check deduplication hash once more
        existing = db.query(Transaction).filter(
            Transaction.account_id == req.account_id,
            Transaction.import_hash == item.import_hash,
        ).first()

        if existing:
            continue

        txn = Transaction(
            account_id=req.account_id,
            statement_file_id=req.statement_file_id,
            transaction_date=trn_date,
            raw_payee=item.raw_payee,
            normalized_payee=item.normalized_payee,
            amount=item.amount,
            currency=account.currency or "USD",
            import_hash=item.import_hash,
            status=TransactionStatus.CLEARED,
            notes=item.notes,
        )

        # Create split
        txn.splits.append(
            TransactionSplit(
                category_id=item.category_id,
                amount=item.amount,
                memo=item.notes,
            )
        )

        db.add(txn)
        committed_count += 1

    # Update statement file transaction count
    if req.statement_file_id:
        stmt_file = db.query(StatementFile).filter(StatementFile.id == req.statement_file_id).first()
        if stmt_file:
            stmt_file.transaction_count = committed_count

    db.commit()

    # Recalculate account balance
    recalculate_account_balance(db, req.account_id)
    db.refresh(account)

    return IngestionCommitResponse(
        committed_count=committed_count,
        account_id=req.account_id,
        new_account_balance=account.current_balance,
    )


@router.get("/statement-files", response_model=list[StatementFileResponse])
def list_statement_files(account_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(StatementFile)
    if account_id:
        query = query.filter(StatementFile.account_id == account_id)
    return query.order_by(StatementFile.uploaded_at.desc()).all()
