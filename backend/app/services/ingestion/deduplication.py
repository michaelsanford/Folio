import hashlib
from sqlalchemy.orm import Session
from app.models.transaction import Transaction


def generate_transaction_hash(account_id: str, date_str: str, amount: float, raw_payee: str) -> str:
    """
    Generates a deterministic SHA-256 fingerprint for deduplication.
    Normalized amount string to 2 decimal places to avoid float precision variance.
    """
    normalized_payee = "".join(c for c in raw_payee.lower() if c.isalnum())
    normalized_amount = f"{amount:.2f}"
    # Standardize date to YYYY-MM-DD
    if "T" in date_str:
        date_str = date_str.split("T")[0]
    
    payload = f"{account_id}|{date_str}|{normalized_amount}|{normalized_payee}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def check_existing_duplicates(db: Session, account_id: str, import_hashes: list[str]) -> set[str]:
    """
    Given a list of import hashes, queries the database to find which hashes already exist.
    Returns a set of existing hashes.
    """
    if not import_hashes:
        return set()
    
    existing = (
        db.query(Transaction.import_hash)
        .filter(
            Transaction.account_id == account_id,
            Transaction.import_hash.in_(import_hashes)
        )
        .all()
    )
    return {row[0] for row in existing if row[0]}
