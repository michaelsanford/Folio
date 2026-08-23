import io
import re
from datetime import datetime
from dateutil import parser as date_parser
import pdfplumber
from sqlalchemy.orm import Session
from app.schemas.ingestion import (
    ParsedTransactionItem,
    IngestionPreviewResponse,
)
from app.services.ingestion.deduplication import (
    generate_transaction_hash,
    check_existing_duplicates,
)
from app.services.ingestion.csv_parser import clean_amount_str
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.rules_engine import evaluate_rules
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


def parse_pdf_content(
    db: Session,
    account_id: str,
    pdf_bytes: bytes,
    filename: str,
) -> IngestionPreviewResponse:
    """
    Extracts tabular and text-based transaction data from bank statement PDFs using pdfplumber.
    """
    raw_rows: list[tuple[str, str, float]] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
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
                    # Valid transaction table detected
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
                text = page.extract_text() or ""
                for line in text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    for pattern in PDF_LINE_PATTERNS:
                        match = pattern.match(line)
                        if match:
                            date_str, desc_str, amt_str = match.groups()
                            amt = clean_amount_str(amt_str)
                            # If ends with CR, it's credit/income (positive)
                            if "cr" in amt_str.lower():
                                amt = abs(amt)
                            else:
                                amt = -abs(amt)  # Standard expense outflow
                            raw_rows.append((date_str, desc_str, amt))
                            break

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []
    current_year = datetime.now().year

    for date_raw, desc_raw, amount in raw_rows:
        try:
            dt = date_parser.parse(date_raw)
            # If statement only gave MM/DD, default to current year
            if dt.year < 1900 or dt.year > 2100:
                dt = dt.replace(year=current_year)
            iso_date = dt.strftime("%Y-%m-%d")
        except Exception:
            continue

        item_hash = generate_transaction_hash(account_id, iso_date, amount, desc_raw)
        hashes.append(item_hash)

        norm_payee = normalize_payee(desc_raw)

        rule_match = evaluate_rules(db, desc_raw, amount, account_id)
        suggested_cat_id = rule_match.category_id if rule_match.matched else None
        suggested_cat_name = rule_match.category_name if rule_match.matched else None
        suggested_cat_color = rule_match.category_color if rule_match.matched else None
        if rule_match.matched and rule_match.normalized_payee:
            norm_payee = rule_match.normalized_payee

        transfer_match = find_potential_transfers(db, account_id, dt, amount)
        potential_xfer_acc_id = transfer_match.account_id if transfer_match else None
        potential_xfer_acc_name = transfer_match.account_name if transfer_match else None

        item = ParsedTransactionItem(
            transaction_date=iso_date,
            raw_payee=desc_raw,
            normalized_payee=norm_payee,
            amount=amount,
            currency="USD",
            suggested_category_id=suggested_cat_id,
            suggested_category_name=suggested_cat_name,
            suggested_category_color=suggested_cat_color,
            is_duplicate=False,
            import_hash=item_hash,
            potential_transfer_account_id=potential_xfer_acc_id,
            potential_transfer_account_name=potential_xfer_acc_name,
            confidence_score=rule_match.confidence if rule_match.matched else 0.5,
        )
        parsed_items.append(item)

    existing_hashes = check_existing_duplicates(db, account_id, hashes)
    duplicates_count = 0
    for item in parsed_items:
        if item.import_hash in existing_hashes:
            item.is_duplicate = True
            duplicates_count += 1

    return IngestionPreviewResponse(
        filename=filename,
        file_type="PDF",
        account_id=account_id,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )
