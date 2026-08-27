import hashlib
import re
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.s3_sync import sync_db_if_configured, sync_now
from app.models.account import Account
from app.models.category import Category
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
from app.api.rules import auto_learn_rules_bulk

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

    # Guard against memory exhaustion DoS: limit read to MAX_UPLOAD_SIZE_BYTES + 1
    max_bytes = settings.MAX_UPLOAD_SIZE_BYTES
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Statement file exceeds maximum allowed size of {max_mb} MB",
        )

    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # Sanitize filename strictly to prevent path traversal and control character attacks
    raw_filename = Path(file.filename or "statement").name
    safe_filename = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", raw_filename)
    if not safe_filename or safe_filename.startswith("."):
        safe_filename = f"statement{Path(raw_filename).suffix}"
        
    ext = Path(safe_filename).suffix.lower()

    # Magic byte verification for PDF
    if ext == ".pdf" and not content.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid PDF statement: file magic header missing or corrupt",
        )

    # Save statement file to disk
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_hash = hashlib.sha256(content).hexdigest()
    saved_filename = f"{account_id}_{file_hash[:12]}_{safe_filename}"
    saved_path = settings.UPLOAD_DIR / saved_filename
    
    with open(saved_path, "wb") as f:
        f.write(content)

    stmt_file = StatementFile(
        account_id=account_id,
        filename=safe_filename,
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
        preview = parse_pdf_content(db, account_id, content, safe_filename)
    elif ext in [".ofx", ".qfx", ".qbo"]:
        preview = parse_ofx_content(db, account_id, content, safe_filename)
    else:  # Default to CSV / text
        preview = parse_csv_content(db, account_id, content, safe_filename)

    preview.file_id = stmt_file.id
    return preview



@router.post("/commit", response_model=IngestionCommitResponse)
def commit_ingestion_batch(req: IngestionCommitRequest, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == req.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    committed_count = 0
    stmt_file_id = req.statement_file_id if req.statement_file_id and req.statement_file_id.strip() else None
    if stmt_file_id:
        stmt_file = db.query(StatementFile).filter(StatementFile.id == stmt_file_id).first()
        if not stmt_file:
            stmt_file_id = None

    seen_hashes_in_batch: set[str] = set()
    # Merchant -> (category, display name). Collected during the loop and applied
    # once, instead of two queries and a commit per row.
    learned: dict[str, tuple[str, str | None]] = {}

    try:
        for item in req.items:
            # Parse transaction date safely
            trn_date = datetime.now()
            if item.transaction_date:
                try:
                    trn_date = datetime.strptime(item.transaction_date[:10], "%Y-%m-%d")
                except Exception:
                    try:
                        trn_date = datetime.fromisoformat(item.transaction_date)
                    except Exception:
                        trn_date = datetime.now()

            # Deduplication check against DB and current batch
            if item.import_hash:
                if item.import_hash in seen_hashes_in_batch:
                    continue
                seen_hashes_in_batch.add(item.import_hash)

                existing = db.query(Transaction).filter(
                    Transaction.account_id == req.account_id,
                    Transaction.import_hash == item.import_hash,
                ).first()
                if existing:
                    continue

            # Sanitize category_id (must be a valid UUID in categories table or None)
            cat_id = item.category_id if item.category_id and item.category_id.strip() else None
            if cat_id:
                cat = db.query(Category).filter(Category.id == cat_id).first()
                if not cat:
                    cat_id = None

            raw_name = (item.raw_payee or "Unknown Payee").strip()
            norm_name = (item.normalized_payee or raw_name).strip()

            txn = Transaction(
                account_id=req.account_id,
                statement_file_id=stmt_file_id,
                transaction_date=trn_date,
                raw_payee=raw_name,
                normalized_payee=norm_name,
                amount=float(item.amount),
                currency=account.currency or settings.DEFAULT_CURRENCY,
                import_hash=item.import_hash or None,
                status=TransactionStatus.CLEARED,
                notes=item.notes,
            )

            txn.splits.append(
                TransactionSplit(
                    category_id=cat_id,
                    amount=float(item.amount),
                    memo=item.notes,
                )
            )

            db.add(txn)
            committed_count += 1

            # Adaptive learning: remember this category selection for future imports
            if cat_id:
                learned[raw_name] = (cat_id, norm_name)

        auto_learn_rules_bulk(db, learned)

        # Update statement file transaction count
        if stmt_file_id:
            stmt_file = db.query(StatementFile).filter(StatementFile.id == stmt_file_id).first()
            if stmt_file:
                stmt_file.transaction_count = (stmt_file.transaction_count or 0) + committed_count

        db.commit()

        # Recalculate account balance
        recalculate_account_balance(db, req.account_id)
        db.refresh(account)

        # An import is a lot of work to redo, so force the snapshot rather than
        # leaving it to the debounce window.
        sync_now()

        return IngestionCommitResponse(
            committed_count=committed_count,
            account_id=req.account_id,
            new_account_balance=account.current_balance,
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to commit transactions: {str(e)}",
        )


@router.get("/statement-files", response_model=list[StatementFileResponse])
def list_statement_files(account_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(StatementFile)
    if account_id:
        query = query.filter(StatementFile.account_id == account_id)
    return query.order_by(StatementFile.uploaded_at.desc()).all()


@router.delete("/statement-files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_statement_file(file_id: str, db: Session = Depends(get_db)):
    """Remove an uploaded statement and its file on disk.

    Statements accumulated with no way to remove them, so a self-hosted finance
    vault kept every bank statement forever with no user control. Imported
    transactions are kept -- the FK is ON DELETE SET NULL -- so deleting the
    source document never silently deletes ledger history.
    """
    stmt_file = db.query(StatementFile).filter(StatementFile.id == file_id).first()
    if not stmt_file:
        raise HTTPException(status_code=404, detail="Statement file not found")

    # Rebuild the target from the upload root and the stored basename, so a
    # tampered file_path row cannot reach outside the directory by construction
    # rather than only by validation. "../../etc/passwd" has basename
    # "passwd", which lands harmlessly inside the upload root.
    try:
        upload_root = settings.UPLOAD_DIR.resolve()
        stored = (upload_root / Path(stmt_file.file_path).name).resolve()
        # Second line of defence: symlinks resolve away, so a link planted in the
        # upload directory still cannot point the unlink somewhere else.
        if stored.is_file() and stored.is_relative_to(upload_root):
            stored.unlink()
    except (OSError, ValueError):
        # A missing or unreadable file should not block removing the record.
        pass

    db.delete(stmt_file)
    db.commit()
    sync_db_if_configured()
    return None
