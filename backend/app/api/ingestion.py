import csv
import hashlib
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.categories import seed_default_categories
from app.api.rules import auto_learn_rules_bulk, seed_default_rules
from app.api.transactions import recalculate_account_balances
from app.core.config import settings
from app.core.database import get_db
from app.core.s3_sync import VaultConflictError, sync_now
from app.models.account import Account, AccountType, LoanCompounding
from app.models.category import Category
from app.models.rule import CategorizationRule
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit, TransactionStatus
from app.schemas.ingestion import (
    CommittedAccountSummary,
    IngestionCommitRequest,
    IngestionCommitResponse,
    IngestionPreviewResponse,
    StatementFileResponse,
)
from app.services.categorization.transfer_matcher import link_offsetting_transfers
from app.services.ingestion.account_detector import (
    get_account_type_defaults,
    mask_account_number,
)
from app.services.ingestion.csv_parser import parse_csv_content
from app.services.ingestion.deduplication import (
    check_existing_duplicates,
    generate_transaction_hash,
)
from app.services.ingestion.ofx_parser import parse_ofx_content
from app.services.ingestion.pdf_parser import parse_pdf_content

logger = logging.getLogger("folio.ingestion")

# Every route here is a plain ``def``: parsing, classification and SQLite work
# are blocking, and an ``async def`` route would run them on the event loop and
# stall every other request for the duration of an import.
router = APIRouter(prefix="/ingestion", tags=["Statement Ingestion"])

_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
_READ_CHUNK = 1024 * 1024


def _parse_transaction_date(raw_date: str | None) -> datetime | None:
    """Parse a commit item's ISO date; ``None`` when it is missing or malformed."""
    if not raw_date:
        return None
    try:
        return datetime.strptime(raw_date[:10], "%Y-%m-%d")
    except ValueError:
        try:
            return datetime.fromisoformat(raw_date)
        except ValueError:
            return None


def _format_mb(num_bytes: int) -> str:
    return f"{num_bytes / (1024 * 1024):g} MB"


def _too_large(max_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=413,  # Content Too Large
        detail=(
            f"Statement file exceeds the {_format_mb(max_bytes)} upload limit. "
            "Split the statement into smaller date ranges and import each part."
        ),
    )


def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Read at most ``max_bytes`` from the upload, refusing anything larger."""
    declared = getattr(file, "size", None)
    if declared is not None and declared > max_bytes:
        raise _too_large(max_bytes)

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = file.file.read(min(_READ_CHUNK, max_bytes + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > max_bytes:
            raise _too_large(max_bytes)
    return b"".join(chunks)


def _uploads_are_ephemeral() -> bool:
    """True where an archived copy of the statement could not outlive the request.

    On Lambda the upload directory is ``/tmp``: it is not synced to S3, vanishes
    with the container and shares the function's small ephemeral disk, so
    keeping a copy there only leaks space.
    """
    if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
        return True
    try:
        upload_dir = settings.UPLOAD_DIR.resolve()
        return upload_dir.is_relative_to(Path(tempfile.gettempdir()).resolve())
    except (OSError, ValueError):
        return False


def _parse_statement(db: Session, ext: str, account_id: str | None, content: bytes, filename: str) -> IngestionPreviewResponse:
    if ext == ".pdf":
        return parse_pdf_content(db, account_id, content, filename)
    if ext in (".ofx", ".qfx", ".qbo"):
        return parse_ofx_content(db, account_id, content, filename)
    return parse_csv_content(db, account_id, content, filename)  # Default to CSV / text


@router.post("/upload-preview", response_model=IngestionPreviewResponse)
def upload_statement_preview(
    account_id: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Parse a statement and return classified rows. Nothing is imported here.

    The only write is the ``StatementFile`` record (re-used when the same file
    is uploaded again). Classification runs with persistence disabled, so a
    preview can never commit learned rules.
    """
    resolved_account_id = (
        account_id.strip()
        if account_id and account_id.strip() and account_id.strip().lower() != "auto"
        else None
    )
    if resolved_account_id:
        account = db.query(Account).filter(Account.id == resolved_account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

    try:
        content = _read_upload(file, settings.MAX_UPLOAD_SIZE_BYTES)
    finally:
        # Starlette spools large uploads to a temporary file on disk (/tmp on
        # Lambda); release it as soon as the bytes are in memory.
        file.file.close()

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

    if db.query(CategorizationRule.id).first() is None:
        seed_default_categories(db)
        seed_default_rules(db)

    try:
        preview = _parse_statement(db, ext, resolved_account_id, content, safe_filename)
    except (HTTPException, VaultConflictError):
        raise
    except (ValueError, UnicodeDecodeError, csv.Error) as e:
        logger.info("Statement %s could not be parsed: %s", safe_filename, e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The statement could not be read. Check that it is a valid CSV, OFX/QFX or PDF export.",
        )
    except Exception as e:
        if type(e).__module__.startswith(("pdfminer", "pdfplumber")):
            # A malformed PDF is the uploader's problem, not a server fault.
            logger.info("PDF %s could not be parsed: %s", safe_filename, e)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The PDF statement could not be read. Try exporting it again or use CSV/OFX.",
            )
        logger.exception("Unexpected error parsing statement %s", safe_filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process the statement.",
        )

    # Re-uploading the same file re-uses its record instead of piling up copies.
    file_hash = hashlib.sha256(content).hexdigest()
    stmt_file = (
        db.query(StatementFile)
        .filter(StatementFile.file_hash == file_hash)
        .order_by(StatementFile.uploaded_at.desc())
        .first()
    )
    keep_copy = not _uploads_are_ephemeral()

    if stmt_file is None:
        prefix = resolved_account_id or "auto"
        saved_filename = f"{prefix}_{file_hash[:12]}_{safe_filename}"
        saved_path = settings.UPLOAD_DIR / saved_filename
        if keep_copy:
            settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            saved_path.write_bytes(content)
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
    elif keep_copy:
        stored = settings.UPLOAD_DIR / Path(stmt_file.file_path).name
        if not stored.is_file():
            settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            stored.write_bytes(content)

    preview.file_id = stmt_file.id
    return preview


def _resolve_category(
    item_cat_id: str | None,
    item_cat_name: str | None,
    by_id: dict[str, Category],
    by_lower_name: dict[str, Category],
) -> str | None:
    cat_id = item_cat_id.strip() if item_cat_id and item_cat_id.strip() else None
    cat_name = item_cat_name.strip() if item_cat_name and item_cat_name.strip() else None
    cat = by_id.get(cat_id) if cat_id else None
    if not cat and cat_name:
        cat = by_lower_name.get(cat_name.lower())
    return cat.id if cat else None


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

    # Validate every date up front: a malformed date is the caller's error (400)
    # and must not be replaced with "today".
    parsed_dates: list[datetime] = []
    for idx, item in enumerate(req.items):
        trn_date = _parse_transaction_date(item.transaction_date)
        if trn_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Item {idx + 1} has an invalid transaction_date {item.transaction_date!r}; expected YYYY-MM-DD.",
            )
        parsed_dates.append(trn_date)

    resolutions_by_key = {r.source_account_key: r for r in req.accounts}
    referenced_keys = {it.source_account_key for it in req.items if it.source_account_key}

    resolved_by_key: dict[str, Account] = {}
    account_cache: dict[str, Account] = {}
    created_account_ids: set[str] = set()
    committed_per_account: dict[str, int] = {}
    touched_account_order: list[str] = []
    new_transaction_ids: list[str] = []

    if top_level_account:
        account_cache[top_level_account.id] = top_level_account

    def _track_account(acc: Account) -> None:
        if acc.id not in committed_per_account:
            committed_per_account[acc.id] = 0
            touched_account_order.append(acc.id)

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

        # 2. Resolve each item's target account and canonical fingerprint.
        staged: list[tuple[int, Account, str | None]] = []
        ordinals: dict[tuple[str, str], int] = {}
        for idx, item in enumerate(req.items):
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

            # Re-key SHA-256 content fingerprints to the resolved persisted account ID
            # while keeping bank-assigned OFX FITIDs or custom test hashes intact.
            # Repeated identical rows keep distinct fingerprints via their ordinal.
            canonical_hash = item.import_hash
            if item.source_account_key and (
                not canonical_hash or _SHA256_HEX_RE.match(canonical_hash.strip())
            ):
                iso_date = parsed_dates[idx].strftime("%Y-%m-%d")
                raw_name = (item.raw_payee or "Unknown Payee").strip()
                base = generate_transaction_hash(target_account.id, iso_date, float(item.amount), raw_name)
                ordinal = ordinals.get((target_account.id, base), 0)
                ordinals[(target_account.id, base)] = ordinal + 1
                canonical_hash = generate_transaction_hash(
                    target_account.id, iso_date, float(item.amount), raw_name, ordinal=ordinal
                )
            staged.append((idx, target_account, canonical_hash or None))

        # 3. One batched existence check per account instead of a query per row.
        hashes_by_account: dict[str, list[str]] = {}
        for _, acc, h in staged:
            if h:
                hashes_by_account.setdefault(acc.id, []).append(h)
        existing_by_account = {
            acc_id: check_existing_duplicates(db, acc_id, hashes)
            for acc_id, hashes in hashes_by_account.items()
        }

        categories = db.query(Category).all()
        categories_by_id = {c.id: c for c in categories}
        categories_by_name: dict[str, Category] = {}
        for c in categories:
            categories_by_name.setdefault((c.name or "").lower(), c)

        seen_hashes_by_account: dict[str, set[str]] = {}
        for idx, target_account, canonical_hash in staged:
            item = req.items[idx]
            _track_account(target_account)

            if canonical_hash:
                seen_for_acc = seen_hashes_by_account.setdefault(target_account.id, set())
                if canonical_hash in seen_for_acc:
                    continue
                seen_for_acc.add(canonical_hash)
                if canonical_hash in existing_by_account.get(target_account.id, set()):
                    continue

            raw_name = (item.raw_payee or "Unknown Payee").strip()
            norm_name = (item.normalized_payee or raw_name).strip()
            cat_id = _resolve_category(item.category_id, item.category_name, categories_by_id, categories_by_name)

            row_currency = (
                (item.currency or target_account.currency or settings.DEFAULT_CURRENCY)
                .strip()
                .upper()
            )
            txn_id = str(uuid.uuid4())
            txn = Transaction(
                id=txn_id,
                account_id=target_account.id,
                statement_file_id=stmt_file_id,
                transaction_date=parsed_dates[idx],
                raw_payee=raw_name,
                normalized_payee=norm_name,
                amount=float(item.amount),
                currency=row_currency,
                import_hash=canonical_hash,
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
            new_transaction_ids.append(txn_id)
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
    except VaultConflictError:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        logger.warning("Import rejected by a database constraint", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Some transactions conflict with existing records (likely already imported). Refresh the preview and try again.",
        )
    except Exception:
        db.rollback()
        logger.exception("Failed to commit statement import")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to commit transactions.",
        )

    if top_level_account and top_level_account.id not in touched_account_order:
        touched_account_order.insert(0, top_level_account.id)
        committed_per_account.setdefault(top_level_account.id, 0)

    # The rows are committed. Balances and transfer links are derived data:
    # whatever happens to them, the import itself must still reach S3, so the
    # flush runs in ``finally`` (and its conflict error propagates).
    summaries: list[CommittedAccountSummary] = []
    transfers_linked = 0
    try:
        balances = recalculate_account_balances(db, touched_account_order)
        accounts_by_id = {
            a.id: a for a in db.query(Account).filter(Account.id.in_(touched_account_order)).all()
        } if touched_account_order else {}
        for acc_id in touched_account_order:
            acc_obj = accounts_by_id.get(acc_id)
            if acc_obj:
                summaries.append(
                    CommittedAccountSummary(
                        account_id=acc_obj.id,
                        account_name=acc_obj.name,
                        account_type=acc_obj.type,
                        created=acc_obj.id in created_account_ids,
                        committed_count=committed_per_account.get(acc_obj.id, 0),
                        new_account_balance=float(balances.get(acc_obj.id, acc_obj.current_balance)),
                    )
                )

        if req.auto_detect_transfers and new_transaction_ids:
            transfers_linked, _ = link_offsetting_transfers(
                db, window_days=3, transaction_ids=new_transaction_ids
            )
    finally:
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
    return None
