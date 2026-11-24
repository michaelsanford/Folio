import io
import re
from datetime import date, timedelta
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
    mask_account_number,
    match_existing_account,
    suggest_account_name,
)
from app.services.ingestion.deduplication import check_existing_duplicates
from app.services.ingestion.csv_parser import clean_amount_str
from app.services.ingestion.preview_common import (
    HashSequencer,
    classify_preview_items,
    collect_full_dates,
    parse_statement_date,
    row_error,
)
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.transfer_matcher import find_potential_transfers

# Common line regex patterns in bank/credit card PDF statements
PDF_LINE_PATTERNS = [
    # 08/15/2026 or 08/15  PAYEE DESCRIPTION  $123.45 or -$123.45 or 123.45 CR
    re.compile(r"^(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(.+?)\s+([-\$]?[\d,]+\.\d{2}(?:\s*CR)?)$", re.IGNORECASE),
    # 08/15  08/16  PAYEE DESCRIPTION  $123.45 (transaction date + post date)
    re.compile(r"^(\d{1,2}[\/\-\.]\d{1,2})\s+\d{1,2}[\/\-\.]\d{1,2}\s+(.+?)\s+([-\$]?[\d,]+\.\d{2}(?:\s*CR)?)$", re.IGNORECASE),
    # Jan 15, 2026 PAYEE DESCRIPTION $123.45
    re.compile(r"^([A-Za-z]{3}\s+\d{1,2}(?:,?\s+\d{4})?)\s+(.+?)\s+([-\$]?[\d,]+\.\d{2}(?:\s*CR)?)$", re.IGNORECASE),
]

_PDF_ACCOUNT_NUMBER_HINT = re.compile(
    r"(?:account|card|ending\s+in)[^\n\d]{0,20}(?:\*{2,}|x{2,}|#)?(\d{4})\b",
    re.IGNORECASE,
)


def _infer_pdf_account_hint(full_text: str, filename: str) -> tuple[str | None, AccountType]:
    head = f"{full_text[:2000]} {filename}"
    for kw in (
        "line of credit",
        "royal credit line",
        "heloc",
        "credit card",
        "visa",
        "mastercard",
        "amex",
        "american express",
        "hisa",
        "savings",
        "chequing",
        "checking",
        "tfsa",
        "rrsp",
        "fhsa",
        "mortgage",
    ):
        if kw in head.lower():
            return kw.title(), infer_account_type(kw)
    return None, AccountType.CHECKING


def _statement_reference_date(header_texts: list[str]) -> date:
    """Closing date to anchor year-less row dates on.

    The latest fully dated value in the statement header (period end or due
    date). Dates far in the future are ignored as noise; with nothing usable,
    today is used, so a year-less row resolves to its nearest past occurrence.
    """
    today = date.today()
    horizon = today + timedelta(days=62)
    candidates = [d for d in collect_full_dates(header_texts) if d <= horizon]
    return max(candidates) if candidates else today


def parse_pdf_content(
    db: Session,
    account_id: str | None,
    pdf_bytes: bytes,
    filename: str,
) -> IngestionPreviewResponse:
    """
    Extracts tabular and text-based transaction data from bank statement PDFs using pdfplumber.
    """
    # Imported on first use: pdfplumber (and pdfminer) are heavy and only needed
    # for PDF uploads, so they should not weigh on every cold start.
    import pdfplumber

    raw_rows: list[tuple[str, str, float]] = []
    page_texts: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_index, page in enumerate(pdf.pages):
            # Text extraction is the expensive part; run it only where it is
            # used: the first page (institution / account / period header) and
            # pages whose tables yielded no transactions (line-regex fallback).
            page_text = ""
            if page_index == 0:
                page_text = page.extract_text() or ""
                if page_text:
                    page_texts.append(page_text)

            # 1. Try extracting structured tables first
            tables = page.extract_tables()
            table_found_rows = False

            for table in tables:
                if not table or len(table) < 2:
                    continue

                header = [str(c).strip().lower() if c else "" for c in table[0]]
                date_idx = -1
                desc_idx = -1
                amt_idx = -1
                debit_idx = -1
                credit_idx = -1

                for idx, col in enumerate(header):
                    if "date" in col and date_idx == -1:
                        date_idx = idx
                    elif any(k in col for k in ["description", "payee", "transaction", "detail"]) and desc_idx == -1:
                        desc_idx = idx
                    elif "debit" in col or "withdrawal" in col:
                        debit_idx = idx
                    elif "credit" in col or "deposit" in col:
                        credit_idx = idx
                    elif "amount" in col and amt_idx == -1:
                        amt_idx = idx

                if date_idx != -1 and desc_idx != -1 and (amt_idx != -1 or (debit_idx != -1 and credit_idx != -1)):
                    for row in table[1:]:
                        if not row or len(row) <= max(date_idx, desc_idx):
                            continue
                        date_val = str(row[date_idx] or "").strip()
                        desc_val = str(row[desc_idx] or "").strip()
                        if not date_val or not desc_val or "balance" in desc_val.lower():
                            continue

                        amount = 0.0
                        if amt_idx != -1 and len(row) > amt_idx and row[amt_idx]:
                            amount = clean_amount_str(str(row[amt_idx]))
                        elif debit_idx != -1 and credit_idx != -1:
                            deb = clean_amount_str(str(row[debit_idx] or "0"))
                            cred = clean_amount_str(str(row[credit_idx] or "0"))
                            if deb > 0:
                                amount = -deb
                            elif cred > 0:
                                amount = cred

                        if date_val and desc_val and amount != 0.0:
                            raw_rows.append((date_val, desc_val, amount))
                            table_found_rows = True

            # 2. If table extraction didn't find transactions on this page, fall back to line text regex
            if not table_found_rows:
                if page_index != 0:
                    page_text = page.extract_text() or ""
                    if page_text:
                        page_texts.append(page_text)
                for line in page_text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    for pattern in PDF_LINE_PATTERNS:
                        match = pattern.match(line)
                        if match:
                            date_str, desc_str, amt_str = match.groups()
                            amt = clean_amount_str(amt_str)
                            if "cr" in amt_str.lower():
                                amt = abs(amt)
                            else:
                                amt = -abs(amt)
                            raw_rows.append((date_str, desc_str, amt))
                            break

    detected_accounts: list[DetectedAccountPreview] = []
    source_key: str | None = None
    matched_account: Account | None = None

    if account_id is not None:
        matched_account = db.query(Account).filter(Account.id == account_id).first()
    else:
        full_text = "\n".join(page_texts)
        full_inst, short_inst = infer_institution(text_hint=full_text[:3000], filename=filename)
        num_match = _PDF_ACCOUNT_NUMBER_HINT.search(full_text[:3000])
        mask = mask_account_number(num_match.group(1)) if num_match else None
        raw_type_hint, inferred_type = _infer_pdf_account_hint(full_text, filename)
        existing_accounts = db.query(Account).all()
        matched_account = match_existing_account(
            existing_accounts,
            mask=mask,
            inferred_type=inferred_type,
            raw_type=raw_type_hint,
            institution=full_inst,
        )
        source_key = "default"
        suggested_name = suggest_account_name(
            raw_type_hint,
            inferred_type,
            mask,
            short_inst,
            filename=filename if not raw_type_hint and not mask else None,
        )
        detected_accounts = [
            DetectedAccountPreview(
                source_account_key=source_key,
                suggested_name=suggested_name,
                suggested_type=matched_account.type if matched_account else inferred_type,
                institution=matched_account.institution if matched_account and matched_account.institution else full_inst,
                account_number_mask=mask,
                currency=matched_account.currency if matched_account else settings.DEFAULT_CURRENCY,
                raw_account_type=raw_type_hint,
                matched_account_id=matched_account.id if matched_account else None,
                matched_account_name=matched_account.name if matched_account else None,
            )
        ]

    effective_account_id = account_id if account_id is not None else (matched_account.id if matched_account else None)
    effective_account_type = (
        matched_account.type.value
        if matched_account
        else (detected_accounts[0].suggested_type.value if detected_accounts else None)
    )
    account_label = (
        matched_account.name
        if matched_account
        else (detected_accounts[0].suggested_name if detected_accounts else None)
    )
    hash_scope = effective_account_id if effective_account_id else (source_key or "default")

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []
    row_errors: list[ParsedRowError] = []
    sequencer = HashSequencer()
    # Statement lines usually omit the year ("08/15"): infer it from the
    # statement's own dates rather than assuming the current year.
    reference_date = _statement_reference_date(page_texts[:1])

    for row_number, (date_raw, desc_raw, amount) in enumerate(raw_rows, start=1):
        try:
            dt = parse_statement_date(date_raw, reference_date)
            iso_date = dt.strftime("%Y-%m-%d")
        except (ValueError, OverflowError):
            row_errors.append(row_error(row_number, "date", date_raw, "Unrecognized transaction date"))
            continue

        item_hash = sequencer.next_hash(hash_scope, iso_date, amount, desc_raw)
        hashes.append(item_hash)

        transfer_match = find_potential_transfers(db, effective_account_id or "__new__", dt, amount)
        parsed_items.append(
            ParsedTransactionItem(
                transaction_date=iso_date,
                raw_payee=desc_raw,
                normalized_payee=normalize_payee(desc_raw),
                amount=amount,
                currency=settings.DEFAULT_CURRENCY,
                is_duplicate=False,
                import_hash=item_hash,
                source_account_key=source_key,
                account_id=effective_account_id,
                account_label=account_label,
                potential_transfer_account_id=transfer_match.account_id if transfer_match else None,
                potential_transfer_account_name=transfer_match.account_name if transfer_match else None,
            )
        )

    classify_preview_items(db, parsed_items, [effective_account_type] * len(parsed_items))

    duplicates_count = 0
    if effective_account_id:
        existing_hashes = check_existing_duplicates(db, effective_account_id, hashes)
        for item in parsed_items:
            if item.import_hash in existing_hashes:
                item.is_duplicate = True
                duplicates_count += 1

    if detected_accounts:
        detected_accounts[0].transaction_count = len(parsed_items)
        detected_accounts[0].duplicates_count = duplicates_count
        detected_accounts[0].new_count = len(parsed_items) - duplicates_count

    return IngestionPreviewResponse(
        filename=filename,
        file_type="PDF",
        account_id=effective_account_id,
        is_multi_account=False,
        detected_accounts=detected_accounts,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
        row_errors=row_errors,
    )
