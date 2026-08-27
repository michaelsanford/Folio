import csv
import re
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
from app.core.config import settings
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.rules_engine import evaluate_rules
from app.services.categorization.transfer_matcher import find_potential_transfers


def clean_amount_str(val: str) -> float:
    """Converts raw string like '$1,234.56', '(50.00)', '-19.47', or '1 234,56 $' to a float."""
    if not val or not val.strip():
        return 0.0
    cleaned = val.strip()

    # Guard: If value looks like a date (e.g. 6/27/2026 or 2026-06-27), do NOT parse as amount
    if re.search(r"^\d{1,4}[/\-\.]\d{1,2}[/\-\.]\d{1,4}$", cleaned):
        return 0.0

    is_negative = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        is_negative = True
        cleaned = cleaned[1:-1].strip()

    # Handle French/European decimal comma: e.g. "19,47" or "-1 234,56"
    if "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    elif "," in cleaned and "." in cleaned:
        # e.g. "1,234.56" -> remove thousands comma
        cleaned = cleaned.replace(",", "")

    # Strip currency symbols and whitespace
    cleaned = re.sub(r"[^\d\.\-]", "", cleaned)
    try:
        amt = float(cleaned)
        return -amt if is_negative and amt > 0 else amt
    except ValueError:
        return 0.0


def auto_detect_csv_columns(header: list[str]) -> CsvColumnMapping:
    """
    Intelligently detects column indices/names from header strings across
    major Canadian (RBC, TD, BMO, Scotia, Desjardins, CIBC) and US/Global bank formats.
    """
    date_col = None
    payee_col = None
    amount_col = None
    debit_col = None
    credit_col = None
    category_col = None
    notes_col = None

    # Priority 1: Match explicit known headers
    for col in header:
        col_lower = col.lower().strip()

        # Date column matching
        if not date_col and any(k in col_lower for k in [
            "transaction date", "trans date", "posting date", "posted date",
            "trade date", "date de transaction", "date",
        ]):
            date_col = col

        # Payee / Description matching
        elif not payee_col and any(k in col_lower for k in [
            "description 1", "description", "payee", "merchant", "name",
            "narrative", "transaction details", "marchand", "libellé", "libelle",
        ]):
            payee_col = col

        # Debit column matching
        elif not debit_col and any(k in col_lower for k in [
            "debit", "débit", "withdrawal", "retrait", "spent", "charge", "outflow",
        ]):
            debit_col = col

        # Credit column matching
        elif not credit_col and any(k in col_lower for k in [
            "credit", "crédit", "deposit", "dépôt", "depot", "inflow",
        ]):
            credit_col = col

        # Amount column matching (including CAD$, USD$, Montant, Amount)
        elif not amount_col and any(k in col_lower for k in [
            "cad$", "usd$", "cad", "usd", "amount", "montant", "total", "valeur", "price",
        ]):
            amount_col = col

        elif not category_col and "category" in col_lower:
            category_col = col

        elif not notes_col and any(k in col_lower for k in [
            "description 2", "memo", "note", "notes", "cheque number", "reference",
        ]):
            notes_col = col

    # Fallback assignment: only pick columns not already claimed
    claimed = {date_col, payee_col, amount_col, debit_col, credit_col, category_col, notes_col}

    if not date_col:
        for c in header:
            if c not in claimed:
                date_col = c
                claimed.add(c)
                break

    if not payee_col:
        for c in header:
            if c not in claimed:
                payee_col = c
                claimed.add(c)
                break

    if not amount_col and not debit_col and not credit_col:
        for c in header:
            if c not in claimed:
                amount_col = c
                claimed.add(c)
                break

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

        # Check secondary description if available (e.g. RBC Description 2)
        desc2 = row.get("Description 2", "").strip() if "Description 2" in row else ""
        if desc2 and desc2 != raw_payee and not row.get(mapping.notes_column or "", ""):
            row_notes = desc2
        else:
            row_notes = row.get(mapping.notes_column, "").strip() if mapping.notes_column else None

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
        row_currency = settings.DEFAULT_CURRENCY

        # Special handling for RBC / multi-currency headers (CAD$, USD$)
        if "CAD$" in row or "USD$" in row:
            val_cad = row.get("CAD$", "").strip()
            val_usd = row.get("USD$", "").strip()
            # Which column the amount came from *is* the row's currency; taking it
            # from the statement beats defaulting when the statement tells us.
            if val_cad:
                amount = clean_amount_str(val_cad)
                row_currency = "CAD"
            elif val_usd:
                amount = clean_amount_str(val_usd)
                row_currency = "USD"
        elif mapping.amount_column and mapping.amount_column in row:
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

        # Rule evaluation for category suggestion (Multi-tier: Explicit + Semantic)
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
            currency=row_currency,
            suggested_category_id=suggested_cat_id,
            suggested_category_name=suggested_cat_name,
            suggested_category_color=suggested_cat_color,
            is_duplicate=False,
            import_hash=item_hash,
            notes=row_notes or None,
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
