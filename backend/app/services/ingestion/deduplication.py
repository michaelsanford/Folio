import hashlib
from sqlalchemy.orm import Session
from app.core.money import to_cents
from app.models.transaction import Transaction

# Comfortably below SQLite's bound-parameter limit.
_IN_CHUNK = 500


def generate_transaction_hash(
    account_id: str,
    date_str: str,
    amount: float,
    raw_payee: str,
    ordinal: int = 0,
) -> str:
    """
    Generates a deterministic SHA-256 fingerprint for deduplication.
    The amount is keyed on exact integer cents so the fingerprint cannot vary
    with float representation.

    ``ordinal`` distinguishes repeated identical rows (same date, amount and
    payee) within one statement. Ordinal 0 produces exactly the historical
    fingerprint, so rows imported before ordinals existed still de-duplicate;
    the n-th repeat (n >= 1) appends ``|n``.
    """
    normalized_payee = "".join(c for c in raw_payee.lower() if c.isalnum())
    # Exact integer cents: f"{amount:.2f}" could render the same economic amount
    # two different ways depending on float representation, which would let a
    # duplicate row slip past the fingerprint.
    normalized_amount = str(to_cents(amount))
    # Standardize date to YYYY-MM-DD
    if "T" in date_str:
        date_str = date_str.split("T")[0]

    payload = f"{account_id}|{date_str}|{normalized_amount}|{normalized_payee}"
    if ordinal:
        payload = f"{payload}|{ordinal}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def check_existing_duplicates(db: Session, account_id: str, import_hashes: list[str]) -> set[str]:
    """
    Given a list of import hashes, queries the database to find which hashes already exist.
    Returns a set of existing hashes. Batched ``IN`` lookups, served by the
    (account_id, import_hash) index.
    """
    unique = list(dict.fromkeys(h for h in import_hashes if h))
    if not unique:
        return set()

    found: set[str] = set()
    for i in range(0, len(unique), _IN_CHUNK):
        rows = (
            db.query(Transaction.import_hash)
            .filter(
                Transaction.account_id == account_id,
                Transaction.import_hash.in_(unique[i : i + _IN_CHUNK]),
            )
            .all()
        )
        found.update(row[0] for row in rows if row[0])
    return found
