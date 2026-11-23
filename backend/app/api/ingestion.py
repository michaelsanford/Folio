import hashlib
import re
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.s3_sync import sync_db_if_configured, sync_now
from app.models.account import Account, AccountType, LoanCompounding
from app.models.category import Category
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit, TransactionStatus
from app.schemas.ingestion import (
    CommittedAccountSummary,
    IngestionPreviewResponse,
    IngestionCommitRequest,
    IngestionCommitResponse,
    StatementFileResponse,
)
from app.services.ingestion.account_detector import (
    get_account_type_defaults,
    mask_account_number,
)
from app.services.ingestion.csv_parser import parse_csv_content
from app.services.ingestion.deduplication import generate_transaction_hash
from app.services.ingestion.pdf_parser import parse_pdf_content
from app.services.ingestion.ofx_parser import parse_ofx_content
from app.services.categorization.transfer_matcher import link_offsetting_transfers
from app.api.transactions import recalculate_account_balance
from app.api.rules import auto_learn_rules_bulk

router = APIRouter(prefix="/ingestion", tags=["Statement Ingestion"])

_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)


def _parse_transaction_date(raw_date: str | None) -> datetime:
    if raw_date:
        try:
            return datetime.strptime(raw_date[:10], "%Y-%m-%d")
        except Exception:
            try:
                return datetime.fromisoformat(raw_date)
            except Exception:
                pass
    return datetime.now()


@router.post("/upload-preview", response_model=IngestionPreviewResponse)
async def upload_statement_preview(
    account_id: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    resolved_account_id = (
        account_id.strip()
        if account_id and account_id.strip() and account_id.strip().lower() != "auto"
        else None
    )
    if resolved_account_id:
        account = db.query(Account).filter(Account.id == resolved_account_id).first()
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
    prefix = resolved_account_id or "auto"
    saved_filename = f"{prefix}_{file_hash[:12]}_{safe_filename}"
    saved_path = settings.UPLOAD_DIR / saved_filename

    with open(saved_path, "wb") as f:
        f.write(content)

    stmt_file = StatementFile(
        account_id=resolved_account_id,
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
        preview = parse_pdf_content(db, resolved_account_id, content, safe_filename)
    elif ext in [".ofx", ".qfx", ".qbo"]:
        preview = parse_ofx_content(db, resolved_account_id, content, safe_filename)
    else:  # Default to CSV / text
        preview = parse_csv_content(db, resolved_account_id, content, safe_filename)

    preview.file_id = stmt_file.id
    return preview


@router.post("/commit", response_model=IngestionCommitResponse)
def commit_ingestion_batch(req: IngestionCommitRequest, db: Session = Depends(get_db)):
    top_level_account: Account | None = None
    if req.account_id and req.account_id.strip():
        top_level_account = db.query(Account).filter(Account.id == req.account_id.strip()).first()
        if not top_level_account:
            raise HTTPException(status_code=404, detail="Account not found")

    stmt_file_id = req.statement_file_id if req.statement_file_id and req.statement_file_id.strip() else None
    if stmt_file_id:
        stmt_file = db.query(StatementFile).filter(StatementFile.id == stmt_file_id).first()
        if not stmt_file:
            stmt_file_id = None

    resolutions_by_key = {r.source_account_key: r for r in req.accounts}
    referenced_keys = {it.source_account_key for it in req.items if it.source_account_key}

    resolved_by_key: dict[str, Account] = {}
    account_cache: dict[str, Account] = {}
    created_account_ids: set[str] = set()
    committed_per_account: dict[str, int] = {}
    touched_account_order: list[str] = []

    if top_level_account:
        account_cache[top_level_account.id] = top_level_account

    def _track_account(acc: Account) -> None:
        if acc.id not in committed_per_account:
            committed_per_account[acc.id] = 0
            touched_account_order.append(acc.id)

    seen_hashes_by_account: dict[str, set[str]] = {}
    learned: dict[tuple[str, str | None], tuple[str, str | None, str | None]] = {}
    committed_count = 0

    try:
        # 1. Resolve or stage new accounts for keys actually referenced by items
        for key in referenced_keys:
            res = resolutions_by_key.get(key)
            if not res:
                continue
            if res.existing_account_id:
                existing = account_cache.get(res.existing_account_id)
                if not existing:
                    existing = db.query(Account).filter(Account.id == res.existing_account_id).first()
                    if not existing:
                        raise HTTPException(status_code=404, detail="Target account not found")
                    account_cache[existing.id] = existing
                resolved_by_key[key] = existing
                _track_account(existing)
            else:
                icon, color = get_account_type_defaults(res.type)
                clean_mask = mask_account_number(res.account_number_mask)
                compounding = (
                    LoanCompounding.SEMI_ANNUAL
                    if res.type == AccountType.MORTGAGE
                    else LoanCompounding.MONTHLY
                )
                new_acc = Account(
                    name=(res.name or "Imported Account").strip(),
                    type=res.type,
                    institution=(res.institution or "").strip() or None,
                    account_number_mask=clean_mask,
                    icon=icon,
                    color=color,
                    currency=(res.currency or settings.DEFAULT_CURRENCY).upper(),
                    compounding=compounding,
                )
                db.add(new_acc)
                db.flush()
                account_cache[new_acc.id] = new_acc
                resolved_by_key[key] = new_acc
                created_account_ids.add(new_acc.id)
                _track_account(new_acc)

        # 2. Stage transactions & splits
        for item in req.items:
            target_account: Account | None = None
            if item.source_account_key and item.source_account_key in resolved_by_key:
                target_account = resolved_by_key[item.source_account_key]
            elif item.account_id and item.account_id.strip():
                acc_id = item.account_id.strip()
                target_account = account_cache.get(acc_id)
                if not target_account:
                    target_account = db.query(Account).filter(Account.id == acc_id).first()
                    if not target_account:
                        raise HTTPException(status_code=404, detail="Target account not found")
                    account_cache[acc_id] = target_account
            elif top_level_account:
                target_account = top_level_account

            if not target_account:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No target account specified for transaction item",
                )

            _track_account(target_account)
            trn_date = _parse_transaction_date(item.transaction_date)
            iso_date = trn_date.strftime("%Y-%m-%d")
            raw_name = (item.raw_payee or "Unknown Payee").strip()
            norm_name = (item.normalized_payee or raw_name).strip()

            # Re-key SHA-256 content fingerprints to the resolved persisted account ID
            # while keeping bank-assigned OFX FITIDs or custom test hashes intact.
            canonical_hash = item.import_hash
            if item.source_account_key and (
                not canonical_hash or _SHA256_HEX_RE.match(canonical_hash.strip())
            ):
                canonical_hash = generate_transaction_hash(
                    target_account.id, iso_date, float(item.amount), raw_name
                )

            if canonical_hash:
                seen_for_acc = seen_hashes_by_account.setdefault(target_account.id, set())
                if canonical_hash in seen_for_acc:
                    continue
                seen_for_acc.add(canonical_hash)

                existing_txn = (
                    db.query(Transaction)
                    .filter(
                        Transaction.account_id == target_account.id,
                        Transaction.import_hash == canonical_hash,
                    )
                    .first()
                )
                if existing_txn:
                    continue

            cat_id = item.category_id if item.category_id and item.category_id.strip() else None
            if cat_id:
                cat = db.query(Category).filter(Category.id == cat_id).first()
                if not cat:
                    cat_id = None

            row_currency = (
                (item.currency or target_account.currency or settings.DEFAULT_CURRENCY)
                .strip()
                .upper()
            )
            txn = Transaction(
                account_id=target_account.id,
                statement_file_id=stmt_file_id,
                transaction_date=trn_date,
                raw_payee=raw_name,
                normalized_payee=norm_name,
                amount=float(item.amount),
                currency=row_currency,
                import_hash=canonical_hash or None,
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
            committed_per_account[target_account.id] += 1

            if cat_id:
                note_key = (item.notes or "").strip() or None
                learned[(raw_name, note_key)] = (cat_id, norm_name, note_key)

        auto_learn_rules_bulk(db, learned)

        if stmt_file_id:
            stmt_file = db.query(StatementFile).filter(StatementFile.id == stmt_file_id).first()
            if stmt_file:
                stmt_file.transaction_count = (stmt_file.transaction_count or 0) + committed_count
                if stmt_file.account_id is None and len(touched_account_order) == 1:
                    stmt_file.account_id = touched_account_order[0]

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to commit transactions: {str(e)}",
        )

    if top_level_account and top_level_account.id not in touched_account_order:
        touched_account_order.insert(0, top_level_account.id)
        committed_per_account.setdefault(top_level_account.id, 0)

    summaries: list[CommittedAccountSummary] = []
    for acc_id in touched_account_order:
        recalculate_account_balance(db, acc_id)
        acc_obj = db.query(Account).filter(Account.id == acc_id).first()
        if acc_obj:
            summaries.append(
                CommittedAccountSummary(
                    account_id=acc_obj.id,
                    account_name=acc_obj.name,
                    account_type=acc_obj.type,
                    created=acc_obj.id in created_account_ids,
                    committed_count=committed_per_account.get(acc_obj.id, 0),
                    new_account_balance=acc_obj.current_balance,
                )
            )

    transfers_linked = 0
    if req.auto_detect_transfers and committed_count > 0:
        transfers_linked, _ = link_offsetting_transfers(db, window_days=3)

    sync_now()

    primary_account_id = (
        top_level_account.id
        if top_level_account
        else (summaries[0].account_id if summaries else None)
    )
    primary_balance = summaries[0].new_account_balance if summaries else 0.0

    return IngestionCommitResponse(
        committed_count=committed_count,
        account_id=primary_account_id,
        new_account_balance=primary_balance,
        accounts_created_count=len(created_account_ids),
        accounts=summaries,
        transfers_linked_count=transfers_linked,
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
