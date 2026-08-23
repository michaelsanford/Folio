import io
import re
from datetime import datetime
from ofxtools import OFXTree
from sqlalchemy.orm import Session
from app.schemas.ingestion import (
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


def parse_ofx_content(
    db: Session,
    account_id: str,
    content: bytes | str,
    filename: str,
) -> IngestionPreviewResponse:
    """
    Parses OFX / QFX / QBO files into normalized transaction preview items.
    """
    if isinstance(content, str):
        raw_bytes = content.encode("utf-8")
    else:
        raw_bytes = content

    parsed_items: list[ParsedTransactionItem] = []
    hashes: list[str] = []

    try:
        parser = OFXTree()
        parser.parse(io.BytesIO(raw_bytes))
        ofx = parser.convert()
        statements = getattr(ofx, "statements", [])
        
        for stmt in statements:
            transactions = getattr(stmt, "transactions", [])
            for trn in transactions:
                dt_posted = getattr(trn, "dtposted", None)
                if isinstance(dt_posted, datetime):
                    iso_date = dt_posted.strftime("%Y-%m-%d")
                    dt_obj = dt_posted
                else:
                    iso_date = datetime.now().strftime("%Y-%m-%d")
                    dt_obj = datetime.now()

                amt = float(getattr(trn, "trnamt", 0.0))
                payee = str(getattr(trn, "name", "") or getattr(trn, "memo", "") or "Unknown").strip()
                fitid = str(getattr(trn, "fitid", "") or "")

                item_hash = fitid if fitid else generate_transaction_hash(account_id, iso_date, amt, payee)
                hashes.append(item_hash)

                norm_payee = normalize_payee(payee)

                rule_match = evaluate_rules(db, payee, amt, account_id)
                suggested_cat_id = rule_match.category_id if rule_match.matched else None
                suggested_cat_name = rule_match.category_name if rule_match.matched else None
                suggested_cat_color = rule_match.category_color if rule_match.matched else None
                if rule_match.matched and rule_match.normalized_payee:
                    norm_payee = rule_match.normalized_payee

                transfer_match = find_potential_transfers(db, account_id, dt_obj, amt)
                potential_xfer_acc_id = transfer_match.account_id if transfer_match else None
                potential_xfer_acc_name = transfer_match.account_name if transfer_match else None

                item = ParsedTransactionItem(
                    transaction_date=iso_date,
                    raw_payee=payee,
                    normalized_payee=norm_payee,
                    amount=amt,
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

    except Exception:
        # Fallback regex parser for non-standard SGML OFX files
        text = raw_bytes.decode("latin-1", errors="ignore")
        trn_blocks = re.findall(r"<STMTTRN>(.*?)</STMTTRN>", text, re.DOTALL | re.IGNORECASE)
        for block in trn_blocks:
            dt_match = re.search(r"<DTPOSTED>(\d{8})", block, re.IGNORECASE)
            amt_match = re.search(r"<TRNAMT>([-\d\.]+)", block, re.IGNORECASE)
            name_match = re.search(r"<NAME>(.*?)(?:<|\r|\n)", block, re.IGNORECASE)
            memo_match = re.search(r"<MEMO>(.*?)(?:<|\r|\n)", block, re.IGNORECASE)
            fitid_match = re.search(r"<FITID>(.*?)(?:<|\r|\n)", block, re.IGNORECASE)

            if dt_match and amt_match:
                raw_dt = dt_match.group(1)
                try:
                    dt_obj = datetime.strptime(raw_dt[:8], "%Y%m%d")
                    iso_date = dt_obj.strftime("%Y-%m-%d")
                except Exception:
                    iso_date = datetime.now().strftime("%Y-%m-%d")
                    dt_obj = datetime.now()

                amt = float(amt_match.group(1))
                payee = (name_match.group(1) if name_match else (memo_match.group(1) if memo_match else "Unknown")).strip()
                fitid = fitid_match.group(1).strip() if fitid_match else ""

                item_hash = fitid if fitid else generate_transaction_hash(account_id, iso_date, amt, payee)
                hashes.append(item_hash)

                norm_payee = normalize_payee(payee)
                rule_match = evaluate_rules(db, payee, amt, account_id)
                suggested_cat_id = rule_match.category_id if rule_match.matched else None
                suggested_cat_name = rule_match.category_name if rule_match.matched else None
                suggested_cat_color = rule_match.category_color if rule_match.matched else None
                if rule_match.matched and rule_match.normalized_payee:
                    norm_payee = rule_match.normalized_payee

                transfer_match = find_potential_transfers(db, account_id, dt_obj, amt)
                potential_xfer_acc_id = transfer_match.account_id if transfer_match else None
                potential_xfer_acc_name = transfer_match.account_name if transfer_match else None

                item = ParsedTransactionItem(
                    transaction_date=iso_date,
                    raw_payee=payee,
                    normalized_payee=norm_payee,
                    amount=amt,
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
        file_type="OFX",
        account_id=account_id,
        total_parsed=len(parsed_items),
        duplicates_count=duplicates_count,
        new_count=len(parsed_items) - duplicates_count,
        items=parsed_items,
    )
