import csv
import io
import re
from datetime import datetime
from dateutil import parser as date_parser
from sqlalchemy.orm import Session
from app.schemas.ingestion import (
    CsvColumnMapping,
    ParsedTransactionItem,
    IngestionPreviewResponse,
)
from app.services.ingestion.deduplication import (
    generate_transaction_hash,
    check_existing_duplicates,
)
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.rules_engine import evaluate_rules
from app.services.categorization.transfer_matcher import find_potential_transfers


def clean_amount_str(val: str) -> float:
    """Converts raw string like '$1,234.56', '(50.00)', or '- 12.34' to a float."""
    if not val or not val.strip():
        return 0.0
    cleaned = val.strip()
    is_negative = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        is_negative = True
        cleaned = cleaned[1:-1].strip()
    cleaned = re.sub(r"[^\d\.\-]", "", cleaned)
    try:
        amt = float(cleaned)
        return -amt if is_negative and amt > 0 else amt
    except ValueError:
        return 0.0


def auto_detect_csv_columns(header: list[str]) -> CsvColumnMapping:
    """Intelligently detects column indices/names from header strings."""
    date_col = None
    payee_col = None
    amount_col = None
    debit_col = None
    credit_col = None
    category_col = None
    notes_col = None

    for col in header:
        col_lower = col.lower().strip()
        if not date_col and any(k in col_lower for k in ["date", "trans date", "posting date", "transaction date"]):
            date_col = col
        elif not payee_col and any(k in col_lower for k in ["description", "payee", "merchant", "name", "narrative"]):
            payee_col = col
        elif not debit_col and any(k in col_lower for k in ["debit", "withdrawal", "spent"]):
            debit_col = col
        elif not credit_col and any(k in col_lower for k in ["credit", "deposit", "inflow"]):
            credit_col = col
        elif not amount_col and any(k in col_lower for k in ["amount", "total"]):
            amount_col = col
        elif not category_col and "category" in col_lower:
            category_col = col
        elif not notes_col and any(k in col_lower for k in ["memo", "note"]):
            notes_col = col

    # Fallbacks if not detected
    if not date_col and len(header) > 0:
        date_col = header[0]
    if not payee_col and len(header) > 1:
        payee_col = header[1]
    if not amount_col and not debit_col and not credit_col and len(header) > 2:
        amount_col = header[2]

    return CsvColumnMapping(
        date_column=date_col or "Date",
        payee_column=payee_col or "Description",
        amount_column=amount_col,
        debit_column=debit_col,
        credit_column=credit_col,
        category_column=category_col,
        notes_column=notes_col,
    )


def parse_csv_content(
    db: Session,
    account_id: str,
    content: str | bytes,
    filename: str,
    custom_mapping: CsvColumnMapping | None = None,
) -> IngestionPreviewResponse:
    """
    Parses CSV content into normalized transaction preview items.
    """
    if isinstance(content, bytes):
        # Try UTF-8 with fallback
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    else:
        text = content

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return IngestionPreviewResponse(
            filename=filename,
            file_type="CSV",
            account_id=account_id,
            total_parsed=0,
            duplicates_count=0,
            new_count=0,
            items=[],
        )

    # Sniff delimiter
    sample = "\n".join(lines[:5])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        delimiter = ","

    reader = csv.DictReader(lines, delimiter=delimiter)
    fieldnames = reader.fieldnames or []

    mapping = custom_mapping or auto_detect_csv_columns(fieldnames)

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []

    for row in reader:
        raw_date_str = row.get(mapping.date_column, "").strip()
        raw_payee = row.get(mapping.payee_column, "").strip()

        if not raw_date_str or not raw_payee:
            continue

        # Parse date
        try:
            dt = date_parser.parse(raw_date_str)
            iso_date = dt.strftime("%Y-%m-%d")
        except Exception:
            continue

        # Calculate amount
        amount = 0.0
        if mapping.amount_column and mapping.amount_column in row:
            amount = clean_amount_str(row[mapping.amount_column])
        elif mapping.debit_column and mapping.credit_column:
            debit = abs(clean_amount_str(row.get(mapping.debit_column, "0")))
            credit = abs(clean_amount_str(row.get(mapping.credit_column, "0")))
            if debit > 0:
                amount = -debit
            elif credit > 0:
                amount = credit

        # Calculate deduplication hash
        item_hash = generate_transaction_hash(account_id, iso_date, amount, raw_payee)
        hashes.append(item_hash)

        # Normalize payee
        norm_payee = normalize_payee(raw_payee)

        # Rule evaluation for category suggestion
        rule_match = evaluate_rules(db, raw_payee, amount, account_id)
        suggested_cat_id = rule_match.category_id if rule_match.matched else None
        suggested_cat_name = rule_match.category_name if rule_match.matched else None
        suggested_cat_color = rule_match.category_color if rule_match.matched else None
        if rule_match.matched and rule_match.normalized_payee:
            norm_payee = rule_match.normalized_payee

        # Check for potential transfer matches
        transfer_match = find_potential_transfers(db, account_id, dt, amount)
        potential_xfer_acc_id = transfer_match.account_id if transfer_match else None
        potential_xfer_acc_name = transfer_match.account_name if transfer_match else None

        item = ParsedTransactionItem(
            transaction_date=iso_date,
            raw_payee=raw_payee,
            normalized_payee=norm_payee,
            amount=amount,
            currency="USD",
            suggested_category_id=suggested_cat_id,
            suggested_category_name=suggested_cat_name,
            suggested_category_color=suggested_cat_color,
            is_duplicate=False,  # Will update in batch check
            import_hash=item_hash,
            potential_transfer_account_id=potential_xfer_acc_id,
            potential_transfer_account_name=potential_xfer_acc_name,
            confidence_score=rule_match.confidence if rule_match.matched else 0.5,
        )
        parsed_items.append(item)

    # Batch check for duplicates in DB
    existing_hashes = check_existing_duplicates(db, account_id, hashes)
    duplicates_count = 0
    for item in parsed_items:
        if item.import_hash in existing_hashes:
            item.is_duplicate = True
            duplicates_count += 1

    return IngestionPreviewResponse(
        filename=filename,
        file_type="CSV",
        account_id=account_id,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )
