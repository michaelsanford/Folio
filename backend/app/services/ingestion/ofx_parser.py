import io
import re
from datetime import datetime
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.account import Account, AccountType
from app.schemas.ingestion import (
    DetectedAccountPreview,
    ParsedRowError,
    ParsedTransactionItem,
    IngestionPreviewResponse,
)
from app.services.ingestion.account_detector import (
    infer_account_type,
    infer_institution,
    make_source_account_key,
    mask_account_number,
    match_existing_account,
    suggest_account_name,
)
from app.services.ingestion.deduplication import check_existing_duplicates
from app.services.ingestion.preview_common import HashSequencer, classify_preview_items, row_error
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.transfer_matcher import (
    annotate_in_batch_transfers,
    find_potential_transfers,
)


def _iso_currency(value: object) -> str | None:
    """Coerce an OFX CURDEF to a 3-letter ISO code, or None if it is not one."""
    code = str(value or "").strip().upper()
    return code if len(code) == 3 and code.isalpha() else None


def _safe_getattr(obj: object, attr: str) -> object | None:
    """Safely inspect ofxtools nodes; missing attributes can raise RecursionError."""
    if obj is None:
        return None
    try:
        return getattr(obj, attr, None)
    except Exception:
        return None


def _extract_ofx_statements(raw_bytes: bytes) -> list[dict]:
    """Extract statement blocks with optional account metadata and transactions.

    Each statement carries ``transactions`` (parsed rows) and ``errors``
    (``(row_number, raw_date)`` for rows whose posting date is unusable). A row
    with no valid date is reported rather than stamped with today's date.
    """
    try:
        # Imported on first use: ofxtools is only needed for OFX uploads and
        # adds to every cold start otherwise.
        from ofxtools import OFXTree

        parser = OFXTree()
        parser.parse(io.BytesIO(raw_bytes))
        ofx = parser.convert()
        statements = _safe_getattr(ofx, "statements") or []
        org_hint = _safe_getattr(
            _safe_getattr(_safe_getattr(ofx, "sonrs"), "fi"),
            "org",
        )
        extracted: list[dict] = []
        row_counter = 0
        for stmt in statements:
            stmt_currency = _iso_currency(_safe_getattr(stmt, "curdef")) or settings.DEFAULT_CURRENCY
            acct = _safe_getattr(stmt, "account")
            raw_acct_id = _safe_getattr(acct, "acctid")
            raw_acct_type = _safe_getattr(acct, "accttype")
            if not raw_acct_type and (
                "cc" in type(acct).__name__.lower()
                or "creditcard" in type(stmt).__name__.lower()
            ):
                raw_acct_type = "Credit Card"

            txns: list[tuple[str, datetime, float, str, str]] = []
            errors: list[tuple[int, str]] = []
            for trn in _safe_getattr(stmt, "transactions") or []:
                row_counter += 1
                dt_posted = _safe_getattr(trn, "dtposted")
                if isinstance(dt_posted, datetime):
                    iso_date = dt_posted.strftime("%Y-%m-%d")
                    dt_obj = dt_posted
                else:
                    errors.append((row_counter, str(dt_posted) if dt_posted is not None else ""))
                    continue

                amt = float(_safe_getattr(trn, "trnamt") or 0.0)
                payee = str(_safe_getattr(trn, "name") or _safe_getattr(trn, "memo") or "Unknown").strip()
                fitid = str(_safe_getattr(trn, "fitid") or "").strip()
                txns.append((iso_date, dt_obj, amt, payee, fitid))

            extracted.append(
                {
                    "currency": stmt_currency,
                    "raw_acct_id": str(raw_acct_id).strip() if raw_acct_id else None,
                    "raw_acct_type": str(raw_acct_type).strip() if raw_acct_type else None,
                    "org_hint": str(org_hint).strip() if org_hint else None,
                    "transactions": txns,
                    "errors": errors,
                }
            )
        if extracted:
            return extracted
    except Exception:
        pass

    # Fallback regex parser for non-standard SGML OFX files
    text = raw_bytes.decode("latin-1", errors="ignore")
    org_match = re.search(r"<ORG>(.*?)(?:<|\r|\n)", text, re.IGNORECASE)
    org_hint = org_match.group(1).strip() if org_match else None

    blocks: list[tuple[bool, str]] = []
    for m in re.finditer(r"<(CC)?STMTRS>(.*?)</\1STMTRS>", text, re.DOTALL | re.IGNORECASE):
        blocks.append((bool(m.group(1)), m.group(2)))
    if not blocks:
        blocks = [(bool(re.search(r"<CCSTMTRS>|<CCACCTFROM>", text, re.IGNORECASE)), text)]

    extracted = []
    row_counter = 0
    for is_cc, block in blocks:
        curdef_match = re.search(r"<CURDEF>([A-Za-z]{3})", block, re.IGNORECASE)
        stmt_currency = (
            _iso_currency(curdef_match.group(1)) if curdef_match else None
        ) or settings.DEFAULT_CURRENCY
        acctid_match = re.search(r"<ACCTID>(.*?)(?:<|\r|\n)", block, re.IGNORECASE)
        accttype_match = re.search(r"<ACCTTYPE>(.*?)(?:<|\r|\n)", block, re.IGNORECASE)
        raw_acct_id = acctid_match.group(1).strip() if acctid_match else None
        raw_acct_type = accttype_match.group(1).strip() if accttype_match else None
        if not raw_acct_type and (is_cc or "<CCACCTFROM>" in block.upper()):
            raw_acct_type = "Credit Card"

        txns = []
        errors = []
        trn_blocks = re.findall(r"<STMTTRN>(.*?)</STMTTRN>", block, re.DOTALL | re.IGNORECASE)
        for trn_block in trn_blocks:
            row_counter += 1
            dt_match = re.search(r"<DTPOSTED>(\d{8})", trn_block, re.IGNORECASE)
            amt_match = re.search(r"<TRNAMT>([-\d\.]+)", trn_block, re.IGNORECASE)
            name_match = re.search(r"<NAME>(.*?)(?:<|\r|\n)", trn_block, re.IGNORECASE)
            memo_match = re.search(r"<MEMO>(.*?)(?:<|\r|\n)", trn_block, re.IGNORECASE)
            fitid_match = re.search(r"<FITID>(.*?)(?:<|\r|\n)", trn_block, re.IGNORECASE)

            if amt_match and not dt_match:
                raw_dt_match = re.search(r"<DTPOSTED>([^<\r\n]*)", trn_block, re.IGNORECASE)
                errors.append((row_counter, raw_dt_match.group(1).strip() if raw_dt_match else ""))
                continue
            if dt_match and amt_match:
                raw_dt = dt_match.group(1)
                try:
                    dt_obj = datetime.strptime(raw_dt[:8], "%Y%m%d")
                    iso_date = dt_obj.strftime("%Y-%m-%d")
                except ValueError:
                    errors.append((row_counter, raw_dt))
                    continue

                amt = float(amt_match.group(1))
                payee = (name_match.group(1) if name_match else (memo_match.group(1) if memo_match else "Unknown")).strip()
                fitid = fitid_match.group(1).strip() if fitid_match else ""
                txns.append((iso_date, dt_obj, amt, payee, fitid))

        extracted.append(
            {
                "currency": stmt_currency,
                "raw_acct_id": raw_acct_id,
                "raw_acct_type": raw_acct_type,
                "org_hint": org_hint,
                "transactions": txns,
                "errors": errors,
            }
        )

    return extracted


def parse_ofx_content(
    db: Session,
    account_id: str | None,
    content: bytes | str,
    filename: str,
) -> IngestionPreviewResponse:
    """Parses OFX / QFX / QBO files into normalized transaction preview items."""
    raw_bytes = content.encode("utf-8") if isinstance(content, str) else content
    statements = _extract_ofx_statements(raw_bytes)

    if account_id is not None:
        preview = _build_single_account_ofx_preview(db, account_id, filename, statements)
    else:
        preview = _build_auto_detected_ofx_preview(db, filename, statements)
    preview.row_errors = _row_errors(statements)
    return preview


def _row_errors(statements: list[dict]) -> list[ParsedRowError]:
    return [
        row_error(row_number, "DTPOSTED", raw, "Missing or invalid posting date")
        for stmt in statements
        for row_number, raw in stmt.get("errors", [])
    ]


def _build_single_account_ofx_preview(
    db: Session,
    account_id: str,
    filename: str,
    statements: list[dict],
) -> IngestionPreviewResponse:
    target_account = db.query(Account).filter(Account.id == account_id).first()
    account_type_str = target_account.type.value if target_account else None
    account_label = target_account.name if target_account else None

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []
    sequencer = HashSequencer()

    for stmt in statements:
        stmt_currency = stmt["currency"]
        for iso_date, dt_obj, amt, payee, fitid in stmt["transactions"]:
            item_hash = fitid if fitid else sequencer.next_hash(account_id, iso_date, amt, payee)
            hashes.append(item_hash)

            transfer_match = find_potential_transfers(db, account_id, dt_obj, amt)
            parsed_items.append(
                ParsedTransactionItem(
                    transaction_date=iso_date,
                    raw_payee=payee,
                    normalized_payee=normalize_payee(payee),
                    amount=amt,
                    currency=stmt_currency,
                    is_duplicate=False,
                    import_hash=item_hash,
                    account_id=account_id,
                    account_label=account_label,
                    potential_transfer_account_id=transfer_match.account_id if transfer_match else None,
                    potential_transfer_account_name=transfer_match.account_name if transfer_match else None,
                )
            )

    classify_preview_items(db, parsed_items, [account_type_str] * len(parsed_items))

    existing_hashes = check_existing_duplicates(db, account_id, hashes)
    duplicates_count = 0
    for item in parsed_items:
        if item.import_hash in existing_hashes:
            item.is_duplicate = True
            duplicates_count += 1

    return IngestionPreviewResponse(
        filename=filename,
        file_type="OFX",
        account_id=account_id,
        is_multi_account=False,
        detected_accounts=[],
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )


def _build_auto_detected_ofx_preview(
    db: Session,
    filename: str,
    statements: list[dict],
) -> IngestionPreviewResponse:
    existing_accounts = db.query(Account).all()
    detected_map: dict[str, DetectedAccountPreview] = {}
    account_labels: dict[str, str] = {}
    hashes_by_matched_account: dict[str, list[str]] = {}
    parsed_items: list[ParsedTransactionItem] = []
    account_types: list[str | None] = []
    sequencer = HashSequencer()

    if not statements:
        statements = [
            {
                "currency": settings.DEFAULT_CURRENCY,
                "raw_acct_id": None,
                "raw_acct_type": None,
                "org_hint": None,
                "transactions": [],
                "errors": [],
            }
        ]

    for stmt in statements:
        raw_acct_id = stmt["raw_acct_id"]
        raw_acct_type = stmt["raw_acct_type"]
        org_hint = stmt["org_hint"]
        stmt_currency = stmt["currency"]

        key = (
            make_source_account_key(raw_acct_type, raw_acct_id)
            if (raw_acct_type or raw_acct_id)
            else "default"
        )
        if key not in detected_map:
            mask = mask_account_number(raw_acct_id)
            inferred_type = infer_account_type(raw_acct_type) if raw_acct_type else AccountType.CHECKING
            full_inst, short_inst = infer_institution(org_hint=org_hint, filename=filename)
            matched = match_existing_account(
                existing_accounts,
                mask=mask,
                inferred_type=inferred_type,
                raw_type=raw_acct_type,
                institution=full_inst,
            )
            suggested_name = suggest_account_name(
                raw_acct_type,
                inferred_type,
                mask,
                short_inst,
                filename=filename if not raw_acct_type and not mask else None,
            )
            account_labels[key] = matched.name if matched else suggested_name
            detected_map[key] = DetectedAccountPreview(
                source_account_key=key,
                suggested_name=suggested_name,
                suggested_type=matched.type if matched else inferred_type,
                institution=matched.institution if matched and matched.institution else full_inst,
                account_number_mask=mask,
                currency=matched.currency if matched else stmt_currency,
                raw_account_type=raw_acct_type,
                matched_account_id=matched.id if matched else None,
                matched_account_name=matched.name if matched else None,
            )

        acc_preview = detected_map[key]
        matched_id = acc_preview.matched_account_id
        hash_scope = matched_id if matched_id else key

        for iso_date, dt_obj, amt, payee, fitid in stmt["transactions"]:
            item_hash = fitid if fitid else sequencer.next_hash(hash_scope, iso_date, amt, payee)
            if matched_id:
                hashes_by_matched_account.setdefault(matched_id, []).append(item_hash)

            transfer_match = find_potential_transfers(db, matched_id or "__new__", dt_obj, amt)
            parsed_items.append(
                ParsedTransactionItem(
                    transaction_date=iso_date,
                    raw_payee=payee,
                    normalized_payee=normalize_payee(payee),
                    amount=amt,
                    currency=stmt_currency,
                    is_duplicate=False,
                    import_hash=item_hash,
                    source_account_key=key,
                    account_id=matched_id,
                    account_label=account_labels[key],
                    potential_transfer_account_id=transfer_match.account_id if transfer_match else None,
                    potential_transfer_account_name=transfer_match.account_name if transfer_match else None,
                )
            )
            account_types.append(acc_preview.suggested_type.value)

    classify_preview_items(db, parsed_items, account_types)

    existing_hashes_by_account: dict[str, set[str]] = {
        acc_id: check_existing_duplicates(db, acc_id, acc_hashes)
        for acc_id, acc_hashes in hashes_by_matched_account.items()
    }

    duplicates_count = 0
    for item in parsed_items:
        acc_preview = detected_map[item.source_account_key or "default"]
        acc_preview.transaction_count += 1
        if item.account_id and item.import_hash in existing_hashes_by_account.get(item.account_id, set()):
            item.is_duplicate = True
            duplicates_count += 1
            acc_preview.duplicates_count += 1
        else:
            acc_preview.new_count += 1

    detected_accounts = list(detected_map.values())
    if len(detected_accounts) > 1:
        annotate_in_batch_transfers(parsed_items, account_labels)

    top_account_id = (
        detected_accounts[0].matched_account_id
        if len(detected_accounts) == 1
        else None
    )

    return IngestionPreviewResponse(
        filename=filename,
        file_type="OFX",
        account_id=top_account_id,
        is_multi_account=len(detected_accounts) > 1,
        detected_accounts=detected_accounts,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )
