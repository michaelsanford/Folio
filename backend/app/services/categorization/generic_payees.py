import re

from app.services.categorization.normalizer import normalize_payee

GENERIC_BANK_PAYEES: frozenset[str] = frozenset(
    {
        "MISC PAYMENT",
        "MISCELLANEOUS PAYMENT",
        "PAYMENT",
        "PAIEMENT",
        "ONLINE PAYMENT",
        "BILL PAYMENT",
        "BILL PMT",
        "SCHEDULED PAYMENT",
        "TRANSFER",
        "TRANSFERT",
        "VIREMENT",
        "EMAIL TRFS",
        "E-TRANSFER",
        "INTERAC E-TRANSFER",
        "DEPOSIT",
        "DEPOT",
        "DÉPÔT",
        "WITHDRAWAL",
        "RETRAIT",
        "CASH WITHDRAWAL",
        "LOAN",
        "LOAN PMT",
        "LOAN PAYMENT",
        "MORTGAGE",
        "INTEREST PAYMENT",
        "DEBIT",
        "CREDIT",
        "PURCHASE",
        "POS PURCHASE",
        "C-IDP PURCHASE",
        "IDP PURCHASE",
        "BR TO BR",
        "CHEQUE",
        "CHECK",
        "ATM",
        "ABM",
    }
)

GENERIC_BANK_PAYEE_PREFIXES: tuple[str, ...] = (
    "WWW TRF",
    "WWW TFR",
    "WWW TRANSFER",
    "WWW PMT",
    "BR TO BR",
    "C-IDP PURCHASE",
    "IDP PURCHASE",
    "EMAIL TRF",
    "E-TRANSFER",
)

GENERIC_BANK_NOTES: frozenset[str] = frozenset(
    {
        "E-TRANSFER SENT",
        "E-TRANSFER RECEIVED",
        "E-TRANSFER",
        "INTERAC E-TRANSFER",
        "ONLINE TRANSFER",
        "ONLINE BANKING TRANSFER",
        "WWW TRANSFER",
        "WWW TRF",
        "WWW TFR",
        "INTERNET TRANSFER",
        "MOBILE TRANSFER",
        "SCHEDULED TRANSFER",
        "TELEPHONE TRANSFER",
        "AUTO TRANSFER",
        "BRANCH TRANSFER",
        "ATM WITHDRAWAL",
        "CASH WITHDRAWAL",
        "CHEQUE",
        "DEPOSIT",
        "WITHDRAWAL",
        "PAYMENT",
        "TRANSFER",
        "MIN PAYMENT",
        "MINIMUM PAYMENT",
    }
)

_TRAILING_PAYEE_REF_RE = re.compile(r"(?:\s*#\s*\d+|\s*-\s*\d+|\s+\d{3,})+$")

_NOTE_WRAPPER_PREFIXES: tuple[re.Pattern[str], ...] = (
    re.compile(r"^WWW\s+PAYMENT\s*-\s*\d*\s*", re.IGNORECASE),
    re.compile(r"^WWW\s+PMT\s*-?\s*\d*\s*", re.IGNORECASE),
    re.compile(r"^BILL\s+P(?:AY)?M(?:EN)?T\s*-?\s*", re.IGNORECASE),
    re.compile(r"^PAIEMENT\s*-?\s*", re.IGNORECASE),
    re.compile(r"^PRE-?AUTHORIZED\s+", re.IGNORECASE),
    re.compile(r"^DIRECT\s+DEPOSIT\s*-?\s*", re.IGNORECASE),
)

_NOTE_TRAILING_REFS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\s*·\s*Cheque\s*#\S+$", re.IGNORECASE),
    re.compile(r"\s*[-·]\s*\d{3,}$"),
    re.compile(r"\s*#\s*\d+$"),
    re.compile(r"\s+\d{4,}$"),
)


def _collapse_upper(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().upper()


def is_generic_bank_payee(raw_payee: str | None) -> bool:
    """Return True when raw_payee is an uninformative bank transaction label."""
    collapsed = _collapse_upper(raw_payee)
    if not collapsed:
        return True

    stripped = _TRAILING_PAYEE_REF_RE.sub("", collapsed).strip(" -")
    if not stripped:
        return True

    if stripped in GENERIC_BANK_PAYEES or collapsed in GENERIC_BANK_PAYEES:
        return True

    return stripped.startswith(GENERIC_BANK_PAYEE_PREFIXES) or collapsed.startswith(
        GENERIC_BANK_PAYEE_PREFIXES
    )


def clean_bank_note_for_matching(notes: str | None) -> str:
    """Strip transport wrappers and trailing reference numbers from bank notes."""
    if not notes:
        return ""

    cleaned = re.sub(r"\s+", " ", notes).strip()
    if not cleaned:
        return ""

    for prefix_re in _NOTE_WRAPPER_PREFIXES:
        cleaned = prefix_re.sub("", cleaned).strip(" -")

    for suffix_re in _NOTE_TRAILING_REFS:
        cleaned = suffix_re.sub("", cleaned).strip()

    return re.sub(r"\s+", " ", cleaned).strip()


def is_generic_bank_note(notes: str | None) -> bool:
    """Return True when a note carries no specific merchant or biller identity."""
    cleaned = clean_bank_note_for_matching(notes)
    if not cleaned:
        return True

    if sum(1 for ch in cleaned if ch.isalpha()) < 3:
        return True

    upper = cleaned.upper()
    if upper in GENERIC_BANK_NOTES:
        return True

    return upper.startswith(GENERIC_BANK_PAYEE_PREFIXES)


def extract_learnable_pattern(
    raw_payee: str,
    normalized_payee: str | None = None,
    notes: str | None = None,
) -> tuple[str, str] | None:
    """Derive a safe ``(pattern, normalized_payee)`` pair for auto-learning.

    Generic bank labels (e.g. ``MISC PAYMENT``, ``Email Trfs``) defer to
    cleaned ``notes`` instead of creating an over-broad ``CONTAINS`` rule.
    Returns ``None`` when neither payee nor notes uniquely identifies a merchant.
    """
    if not raw_payee or not raw_payee.strip():
        return None

    if not is_generic_bank_payee(raw_payee):
        norm = (normalized_payee or normalize_payee(raw_payee)).strip()
        if not norm or len(norm) < 2:
            return None
        return (norm.upper(), norm)

    if is_generic_bank_note(notes):
        return None

    cleaned_note = clean_bank_note_for_matching(notes)
    norm_note = normalize_payee(cleaned_note).strip()
    if not norm_note or len(norm_note) < 3 or sum(1 for ch in norm_note if ch.isalpha()) < 3:
        return None

    return (norm_note.upper(), norm_note)
