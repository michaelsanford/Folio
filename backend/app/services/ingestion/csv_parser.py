import csv
import re
from collections import Counter
from datetime import date, datetime
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.account import Account, AccountType
from app.schemas.ingestion import (
    CsvColumnMapping,
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
from app.services.ingestion.preview_common import (
    HashSequencer,
    classify_preview_items,
    parse_statement_date,
    row_error,
)
from app.services.categorization.normalizer import normalize_payee
from app.services.categorization.transfer_matcher import (
    annotate_in_batch_transfers,
    find_potential_transfers,
)


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


def _decode_csv_bytes(content: str | bytes) -> str:
    if not isinstance(content, bytes):
        return content
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="replace")


def auto_detect_csv_columns(header: list[str]) -> CsvColumnMapping:
    """
    Intelligently detects column indices/names from header strings across
    major Canadian (RBC, TD, BMO, Scotia, Desjardins, CIBC) and US/Global bank formats.
    """
    account_type_col = None
    account_number_col = None
    date_col = None
    payee_col = None
    amount_col = None
    debit_col = None
    credit_col = None
    category_col = None
    notes_col = None
    cheque_fallback_col = None

    for col in header:
        col_lower = col.lower().strip()

        if not account_type_col and any(k in col_lower for k in [
            "account type", "type de compte", "acct type",
        ]):
            account_type_col = col
        elif not account_number_col and any(k in col_lower for k in [
            "account number", "account #", "account no", "numéro de compte",
            "numero de compte", "acct number", "card number",
        ]):
            account_number_col = col
        elif not date_col and any(k in col_lower for k in [
            "transaction date", "trans date", "posting date", "posted date",
            "trade date", "date de transaction", "date",
        ]):
            date_col = col
        elif not payee_col and any(k in col_lower for k in [
            "description 1", "description", "payee", "merchant", "name",
            "narrative", "transaction details", "marchand", "libellé", "libelle",
        ]):
            payee_col = col
        elif not debit_col and any(k in col_lower for k in [
            "debit", "débit", "withdrawal", "retrait", "spent", "charge", "outflow",
        ]):
            debit_col = col
        elif not credit_col and any(k in col_lower for k in [
            "credit", "crédit", "deposit", "dépôt", "depot", "inflow",
        ]):
            credit_col = col
        elif not amount_col and any(k in col_lower for k in [
            "cad$", "usd$", "cad", "usd", "amount", "montant", "total", "valeur", "price",
        ]):
            amount_col = col
        elif not category_col and "category" in col_lower:
            category_col = col
        elif not notes_col and any(k in col_lower for k in [
            "description 2", "memo", "note", "notes", "reference",
        ]):
            notes_col = col
        elif not cheque_fallback_col and "cheque" in col_lower:
            cheque_fallback_col = col

    if not notes_col and cheque_fallback_col:
        notes_col = cheque_fallback_col

    # Fallback assignment: only pick columns not already claimed
    claimed = {
        account_type_col,
        account_number_col,
        date_col,
        payee_col,
        amount_col,
        debit_col,
        credit_col,
        category_col,
        notes_col,
        cheque_fallback_col,
    }

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
        account_type_column=account_type_col,
        account_number_column=account_number_col,
    )


def _apply_transfer_category_fallback(
    db: Session,
    items: list[ParsedTransactionItem],
    detected_map: dict[str, DetectedAccountPreview] | None = None,
    account_labels: dict[str, str] | None = None,
    single_account_type: AccountType | None = None,
) -> None:
    """Assign internal-transfer or cc-payment to uncategorized paired transfers."""
    candidates = [
        it
        for it in items
        if it.suggested_category_id is None and it.potential_transfer_account_name
    ]
    if not candidates:
        return

    label_to_type: dict[str, AccountType] = {}
    if detected_map:
        for key, det in detected_map.items():
            label = (
                account_labels.get(key)
                if account_labels and key in account_labels
                else (det.matched_account_name or det.suggested_name)
            )
            if label:
                label_to_type[label] = det.suggested_type

    counterpart_ids = {
        it.potential_transfer_account_id
        for it in candidates
        if it.potential_transfer_account_id
    }
    account_types_by_id: dict[str, AccountType] = {}
    if counterpart_ids:
        for acc in db.query(Account).filter(Account.id.in_(counterpart_ids)).all():
            account_types_by_id[acc.id] = acc.type

    from app.services.categorization.engine import ClassificationTier, lookup_category_by_slug

    cc_cat = lookup_category_by_slug(db, "cc-payment")
    xfer_cat = lookup_category_by_slug(db, "internal-transfer")

    for item in candidates:
        item_acc_type: AccountType | None = single_account_type
        if item_acc_type is None and detected_map and item.source_account_key in detected_map:
            item_acc_type = detected_map[item.source_account_key].suggested_type

        counterpart_type: AccountType | None = None
        if item.potential_transfer_account_id:
            counterpart_type = account_types_by_id.get(item.potential_transfer_account_id)
        if counterpart_type is None and item.potential_transfer_account_name:
            counterpart_type = label_to_type.get(item.potential_transfer_account_name)

        is_cc_transfer = (
            item_acc_type == AccountType.CREDIT_CARD
            or counterpart_type == AccountType.CREDIT_CARD
        )
        cat = cc_cat if is_cc_transfer and cc_cat else xfer_cat
        if not cat:
            continue

        item.suggested_category_id = cat.id
        item.suggested_category_name = cat.name
        item.suggested_category_color = cat.color
        item.confidence_score = 0.85
        item.classification_tier = ClassificationTier.HEURISTIC.value
        item.classification_reason = (
            f"Paired transfer with {item.potential_transfer_account_name}"
        )


def _extract_row_notes(
    row: dict[str | None, str],
    mapping: CsvColumnMapping,
    raw_payee: str,
    cheque_col: str | None,
) -> str | None:
    notes_val = (row.get(mapping.notes_column) or "").strip() if mapping.notes_column else ""
    desc2 = (row.get("Description 2") or "").strip() if "Description 2" in row else ""

    if desc2 and desc2 != raw_payee and not notes_val:
        combined = desc2
    else:
        combined = notes_val

    if cheque_col and cheque_col != mapping.notes_column:
        cheque_no = (row.get(cheque_col) or "").strip()
        if cheque_no and f"#{cheque_no}" not in combined and cheque_no not in combined:
            combined = f"{combined} · Cheque #{cheque_no}".strip(" ·") if combined else f"Cheque #{cheque_no}"

    return combined or None


def _extract_row_amount(row: dict[str | None, str], mapping: CsvColumnMapping) -> tuple[float, str]:
    amount = 0.0
    row_currency = settings.DEFAULT_CURRENCY

    if "CAD$" in row or "USD$" in row:
        val_cad = (row.get("CAD$") or "").strip()
        val_usd = (row.get("USD$") or "").strip()
        if val_cad:
            amount = clean_amount_str(val_cad)
            row_currency = "CAD"
        elif val_usd:
            amount = clean_amount_str(val_usd)
            row_currency = "USD"
    elif mapping.amount_column and mapping.amount_column in row:
        amount = clean_amount_str(row.get(mapping.amount_column) or "")
    elif mapping.debit_column and mapping.credit_column:
        debit = abs(clean_amount_str(row.get(mapping.debit_column) or "0"))
        credit = abs(clean_amount_str(row.get(mapping.credit_column) or "0"))
        if debit > 0:
            amount = -debit
        elif credit > 0:
            amount = credit

    return amount, row_currency


def parse_csv_content(
    db: Session,
    account_id: str | None,
    content: str | bytes,
    filename: str,
    custom_mapping: CsvColumnMapping | None = None,
) -> IngestionPreviewResponse:
    """
    Parses CSV content into normalized transaction preview items.

    When ``account_id`` is ``None``, detects one or more accounts from the CSV
    headers/rows (or creates a single default account preview from the filename)
    and matches against existing Folio accounts for deduplication.
    """
    text = _decode_csv_bytes(content)

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return IngestionPreviewResponse(
            filename=filename,
            file_type="CSV",
            account_id=account_id,
            is_multi_account=False,
            detected_accounts=[],
            total_parsed=0,
            duplicates_count=0,
            new_count=0,
            items=[],
        )

    sample = "\n".join(lines[:5])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        delimiter = ","

    reader = csv.DictReader(lines, delimiter=delimiter)
    fieldnames = reader.fieldnames or []

    mapping = custom_mapping or auto_detect_csv_columns(fieldnames)
    cheque_col = next((c for c in fieldnames if c and "cheque" in c.lower()), None)

    extracted_rows: list[tuple[str, str, str, datetime, str, str | None, float, str]] = []
    row_errors: list[ParsedRowError] = []
    today = date.today()
    for row in reader:
        raw_date_str = (row.get(mapping.date_column) or "").strip()
        raw_payee = (row.get(mapping.payee_column) or "").strip()
        if not raw_date_str or not raw_payee:
            continue

        try:
            dt = parse_statement_date(raw_date_str, today)
            iso_date = dt.strftime("%Y-%m-%d")
        except (ValueError, OverflowError):
            # Reported, not guessed: a row stamped with today's date (or quietly
            # dropped) corrupts the ledger without anyone noticing.
            row_errors.append(
                row_error(reader.line_num, mapping.date_column, raw_date_str, "Unrecognized transaction date")
            )
            continue

        raw_type = (row.get(mapping.account_type_column) or "").strip() if mapping.account_type_column else ""
        raw_number = (row.get(mapping.account_number_column) or "").strip() if mapping.account_number_column else ""
        row_notes = _extract_row_notes(row, mapping, raw_payee, cheque_col)
        amount, row_currency = _extract_row_amount(row, mapping)

        extracted_rows.append((raw_type, raw_number, iso_date, dt, raw_payee, row_notes, amount, row_currency))

    if account_id is not None:
        preview = _build_single_account_csv_preview(db, account_id, filename, extracted_rows)
    else:
        preview = _build_auto_detected_csv_preview(db, filename, fieldnames, extracted_rows)
    preview.row_errors = row_errors
    return preview


def _build_single_account_csv_preview(
    db: Session,
    account_id: str,
    filename: str,
    extracted_rows: list[tuple[str, str, str, datetime, str, str | None, float, str]],
) -> IngestionPreviewResponse:
    target_account = db.query(Account).filter(Account.id == account_id).first()
    account_type_str = target_account.type.value if target_account else None
    account_label = target_account.name if target_account else None

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []
    sequencer = HashSequencer()

    for _, _, iso_date, dt, raw_payee, row_notes, amount, row_currency in extracted_rows:
        item_hash = sequencer.next_hash(account_id, iso_date, amount, raw_payee)
        hashes.append(item_hash)

        transfer_match = find_potential_transfers(db, account_id, dt, amount)

        parsed_items.append(
            ParsedTransactionItem(
                transaction_date=iso_date,
                raw_payee=raw_payee,
                normalized_payee=normalize_payee(raw_payee),
                amount=amount,
                currency=row_currency,
                is_duplicate=False,
                import_hash=item_hash,
                notes=row_notes,
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

    _apply_transfer_category_fallback(
        db,
        parsed_items,
        single_account_type=target_account.type if target_account else None,
    )

    return IngestionPreviewResponse(
        filename=filename,
        file_type="CSV",
        account_id=account_id,
        is_multi_account=False,
        detected_accounts=[],
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )


def _build_auto_detected_csv_preview(
    db: Session,
    filename: str,
    fieldnames: list[str],
    extracted_rows: list[tuple[str, str, str, datetime, str, str | None, float, str]],
) -> IngestionPreviewResponse:
    has_account_columns = any(raw_type or raw_number for raw_type, raw_number, *_ in extracted_rows)
    existing_accounts = db.query(Account).all()

    raw_types = [rt for rt, *_ in extracted_rows if rt]
    full_inst, short_inst = infer_institution(
        headers=fieldnames,
        raw_types=raw_types,
        filename=filename,
    )

    groups: dict[str, dict] = {}
    row_group_keys: list[str] = []

    if has_account_columns:
        for raw_type, raw_number, _, _, _, _, _, row_currency in extracted_rows:
            key = make_source_account_key(raw_type, raw_number)
            row_group_keys.append(key)
            if key not in groups:
                groups[key] = {
                    "raw_type": raw_type,
                    "raw_number": raw_number,
                    "currencies": Counter(),
                }
            groups[key]["currencies"][row_currency] += 1
    else:
        row_group_keys = ["default"] * len(extracted_rows)
        currencies = Counter(row[7] for row in extracted_rows)
        if extracted_rows:
            groups["default"] = {
                "raw_type": "",
                "raw_number": "",
                "currencies": currencies,
            }

    detected_map: dict[str, DetectedAccountPreview] = {}
    account_labels: dict[str, str] = {}
    hashes_by_matched_account: dict[str, list[str]] = {}

    for key, info in groups.items():
        raw_type = info["raw_type"]
        raw_number = info["raw_number"]
        mask = mask_account_number(raw_number)
        inferred_type = infer_account_type(raw_type) if raw_type else AccountType.CHECKING
        primary_currency = (
            info["currencies"].most_common(1)[0][0]
            if info["currencies"]
            else settings.DEFAULT_CURRENCY
        )
        matched = match_existing_account(
            existing_accounts,
            mask=mask,
            inferred_type=inferred_type,
            raw_type=raw_type or None,
            institution=full_inst,
        )
        suggested_name = suggest_account_name(
            raw_type or None,
            inferred_type,
            mask,
            short_inst,
            filename=filename if not raw_type and not mask else None,
        )
        account_labels[key] = matched.name if matched else suggested_name
        detected_map[key] = DetectedAccountPreview(
            source_account_key=key,
            suggested_name=suggested_name,
            suggested_type=matched.type if matched else inferred_type,
            institution=matched.institution if matched and matched.institution else full_inst,
            account_number_mask=mask,
            currency=matched.currency if matched else primary_currency,
            raw_account_type=raw_type or None,
            matched_account_id=matched.id if matched else None,
            matched_account_name=matched.name if matched else None,
        )

    parsed_items: list[ParsedTransactionItem] = []
    account_types: list[str | None] = []
    sequencer = HashSequencer()
    for (_, _, iso_date, dt, raw_payee, row_notes, amount, row_currency), key in zip(
        extracted_rows, row_group_keys
    ):
        acc_preview = detected_map[key]
        matched_id = acc_preview.matched_account_id
        hash_scope = matched_id if matched_id else key
        item_hash = sequencer.next_hash(hash_scope, iso_date, amount, raw_payee)

        if matched_id:
            hashes_by_matched_account.setdefault(matched_id, []).append(item_hash)

        transfer_match = find_potential_transfers(db, matched_id or "__new__", dt, amount)

        parsed_items.append(
            ParsedTransactionItem(
                transaction_date=iso_date,
                raw_payee=raw_payee,
                normalized_payee=normalize_payee(raw_payee),
                amount=amount,
                currency=row_currency,
                is_duplicate=False,
                import_hash=item_hash,
                notes=row_notes,
                source_account_key=key,
                account_id=matched_id,
                account_label=account_labels[key],
                potential_transfer_account_id=transfer_match.account_id if transfer_match else None,
                potential_transfer_account_name=transfer_match.account_name if transfer_match else None,
            )
        )
        account_types.append(acc_preview.suggested_type.value)

    classify_preview_items(db, parsed_items, account_types)

    # Batch duplicate lookup per matched existing account
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

    _apply_transfer_category_fallback(
        db,
        parsed_items,
        detected_map=detected_map,
        account_labels=account_labels,
    )

    top_account_id = (
        detected_accounts[0].matched_account_id
        if len(detected_accounts) == 1
        else None
    )

    return IngestionPreviewResponse(
        filename=filename,
        file_type="CSV",
        account_id=top_account_id,
        is_multi_account=len(detected_accounts) > 1,
        detected_accounts=detected_accounts,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )
