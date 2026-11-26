"""Account inference, masking, naming, and existing-account matching for ingestion."""
import hashlib
import re
from pathlib import Path
from app.models.account import Account, AccountType

ACCOUNT_TYPE_DEFAULTS: dict[AccountType, tuple[str, str]] = {
    AccountType.CHECKING: ("wallet", "#3B82F6"),
    AccountType.SAVINGS: ("piggy-bank", "#10B981"),
    AccountType.HISA: ("coins", "#06B6D4"),
    AccountType.CASH: ("banknote", "#14B8A6"),
    AccountType.TFSA: ("sparkles", "#10B981"),
    AccountType.RRSP: ("umbrella", "#6366F1"),
    AccountType.FHSA: ("home", "#8B5CF6"),
    AccountType.RESP: ("graduation-cap", "#EC4899"),
    AccountType.RDSP: ("heart-handshake", "#06B6D4"),
    AccountType.RRIF: ("clock", "#F59E0B"),
    AccountType.LIRA: ("lock", "#64748B"),
    AccountType.LIF: ("calendar-clock", "#D97706"),
    AccountType.IPP: ("briefcase", "#4338CA"),
    AccountType.INVESTMENT: ("trending-up", "#6366F1"),
    AccountType.NON_REGISTERED: ("bar-chart-3", "#4F46E5"),
    AccountType.CRYPTO: ("layers", "#F59E0B"),
    AccountType.CREDIT_CARD: ("credit-card", "#F59E0B"),
    AccountType.LINE_OF_CREDIT: ("scale", "#EC4899"),
    AccountType.MORTGAGE: ("building-2", "#8B5CF6"),
    AccountType.VEHICLE_LOAN: ("car", "#3B82F6"),
    AccountType.STUDENT_LOAN: ("book-open", "#10B981"),
    AccountType.PERSONAL_LOAN: ("file-spreadsheet", "#EF4444"),
    AccountType.OTHER_LIABILITY: ("landmark", "#94A3B8"),
    AccountType.REAL_ESTATE: ("home", "#10B981"),
    AccountType.VEHICLE_ASSET: ("car", "#06B6D4"),
    AccountType.OTHER_ASSET: ("gem", "#A855F7"),
}

ACCOUNT_TYPE_LABELS: dict[AccountType, str] = {
    AccountType.CHECKING: "Chequing",
    AccountType.SAVINGS: "Savings",
    AccountType.HISA: "HISA",
    AccountType.CASH: "Cash",
    AccountType.TFSA: "TFSA",
    AccountType.RRSP: "RRSP",
    AccountType.FHSA: "FHSA",
    AccountType.RESP: "RESP",
    AccountType.RDSP: "RDSP",
    AccountType.RRIF: "RRIF",
    AccountType.LIRA: "LIRA",
    AccountType.LIF: "LIF",
    AccountType.IPP: "IPP",
    AccountType.INVESTMENT: "Brokerage",
    AccountType.NON_REGISTERED: "Non-Registered",
    AccountType.CRYPTO: "Crypto",
    AccountType.CREDIT_CARD: "Credit Card",
    AccountType.LINE_OF_CREDIT: "Line of Credit",
    AccountType.MORTGAGE: "Mortgage",
    AccountType.VEHICLE_LOAN: "Auto Loan",
    AccountType.STUDENT_LOAN: "Student Loan",
    AccountType.PERSONAL_LOAN: "Personal Loan",
    AccountType.OTHER_LIABILITY: "Other Liability",
    AccountType.REAL_ESTATE: "Real Estate",
    AccountType.VEHICLE_ASSET: "Vehicle Asset",
    AccountType.OTHER_ASSET: "Other Asset",
}

_INSTITUTION_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"\b(rbc|royal\s+bank(?:\s+of\s+canada)?|royal\s+credit\s+line)\b", re.IGNORECASE),
        "Royal Bank of Canada (RBC)",
        "RBC",
    ),
    (
        re.compile(r"\b(td\s+canada\s+trust|td\s+bank|toronto\s+dominion|td\s+direct\s+investing|td)\b", re.IGNORECASE),
        "TD Canada Trust",
        "TD",
    ),
    (
        re.compile(r"\b(bmo|bank\s+of\s+montreal)\b", re.IGNORECASE),
        "Bank of Montreal (BMO)",
        "BMO",
    ),
    (
        re.compile(r"\b(scotiabank|bank\s+of\s+nova\s+scotia|scotia\s+itrade)\b", re.IGNORECASE),
        "Scotiabank (Bank of Nova Scotia)",
        "Scotiabank",
    ),
    (
        re.compile(r"\b(cibc|canadian\s+imperial\s+bank)\b", re.IGNORECASE),
        "CIBC (Canadian Imperial Bank of Commerce)",
        "CIBC",
    ),
    (
        re.compile(r"\b(desjardins|caisse\s+populaire|disnat)\b", re.IGNORECASE),
        "Desjardins (Mouvement Desjardins)",
        "Desjardins",
    ),
    (
        re.compile(r"\b(national\s+bank(?:\s+of\s+canada)?|banque\s+nationale|nbdb)\b", re.IGNORECASE),
        "National Bank of Canada (Banque Nationale)",
        "National Bank",
    ),
    (
        re.compile(r"\b(tangerine(?:\s+bank)?)\b", re.IGNORECASE),
        "Tangerine Bank",
        "Tangerine",
    ),
    (
        re.compile(r"\b(eq\s+bank|equitable\s+bank)\b", re.IGNORECASE),
        "EQ Bank (Equitable Bank)",
        "EQ Bank",
    ),
    (
        re.compile(r"\b(wealthsimple)\b", re.IGNORECASE),
        "Wealthsimple",
        "Wealthsimple",
    ),
    (
        re.compile(r"\b(amex|american\s+express(?:\s+canada)?)\b", re.IGNORECASE),
        "American Express Canada (Amex)",
        "Amex",
    ),
    (
        re.compile(r"\b(simplii(?:\s+financial)?)\b", re.IGNORECASE),
        "Simplii Financial",
        "Simplii",
    ),
]

_RBC_SIGNATURE_HEADERS = {
    "account type",
    "account number",
    "transaction date",
    "description 1",
    "description 2",
    "cad$",
    "usd$",
}


def mask_account_number(raw_number: str | None) -> str | None:
    """Return a masked `*XXXX` suffix so full account or card numbers are never stored."""
    if not raw_number:
        return None
    digits = re.sub(r"\D", "", str(raw_number).strip())
    if len(digits) >= 4:
        return f"*{digits[-4:]}"
    if digits:
        return f"*{digits}"
    return None


def _last4_digits(raw_number: str | None) -> str | None:
    if not raw_number:
        return None
    digits = re.sub(r"\D", "", str(raw_number))
    return digits[-4:] if len(digits) >= 4 else None


def make_source_account_key(raw_type: str | None, raw_number: str | None) -> str:
    """Create a deterministic opaque key for grouping rows per account without exposing PANs."""
    type_norm = (raw_type or "").strip().lower()
    raw_str = (raw_number or "").strip()
    digits = re.sub(r"\D", "", raw_str)
    num_norm = digits if digits else raw_str.lower()
    digest = hashlib.sha256(f"{type_norm}|{num_norm}".encode("utf-8")).hexdigest()
    return f"acct_{digest[:12]}"


def infer_account_type(raw_type: str | None) -> AccountType:
    """Map Canadian, US, and OFX account type strings to a Folio AccountType."""
    if not raw_type:
        return AccountType.CHECKING
    t = re.sub(r"[\s_\-]+", " ", raw_type.strip().lower())

    if any(k in t for k in ("hisa", "high interest", "high-interest")):
        return AccountType.HISA
    if any(k in t for k in ("credit line", "line of credit", "royal credit line", "heloc", "creditline")) or t == "loc":
        return AccountType.LINE_OF_CREDIT
    if any(k in t for k in ("visa", "mastercard", "master card", "amex", "american express", "credit card", "creditcard")) or t in {"cc", "mc"}:
        return AccountType.CREDIT_CARD
    if any(k in t for k in ("chequing", "checking", "chq", "dda", "everyday", "day to day")):
        return AccountType.CHECKING
    if any(k in t for k in ("savings", "saving", "sav", "epargne", "épargne", "esavings", "e savings")):
        return AccountType.SAVINGS
    if any(k in t for k in ("tfsa", "celi")):
        return AccountType.TFSA
    if any(k in t for k in ("rrif", "ferr")):
        return AccountType.RRIF
    if any(k in t for k in ("rrsp", "reer")):
        return AccountType.RRSP
    if any(k in t for k in ("fhsa", "celiapp")):
        return AccountType.FHSA
    if any(k in t for k in ("resp", "reee")):
        return AccountType.RESP
    if any(k in t for k in ("rdsp", "reei")):
        return AccountType.RDSP
    if any(k in t for k in ("lira", "cri")):
        return AccountType.LIRA
    if any(k in t for k in ("lif", "frv")):
        return AccountType.LIF
    if any(k in t for k in ("mortgage", "hypotheque", "hypothèque")):
        return AccountType.MORTGAGE
    if any(k in t for k in ("auto loan", "vehicle loan", "car loan")):
        return AccountType.VEHICLE_LOAN
    if "student loan" in t:
        return AccountType.STUDENT_LOAN
    if "loan" in t:
        return AccountType.PERSONAL_LOAN
    if any(k in t for k in ("investment", "brokerage", "margin", "direct investing")):
        return AccountType.INVESTMENT
    if t == "cash":
        return AccountType.CASH
    return AccountType.CHECKING


def get_account_type_defaults(account_type: AccountType) -> tuple[str, str]:
    """Return `(icon, color)` matching the frontend Canadian account metadata."""
    return ACCOUNT_TYPE_DEFAULTS.get(account_type, ("wallet", "#3B82F6"))


def infer_institution(
    headers: list[str] | None = None,
    raw_types: list[str] | None = None,
    org_hint: str | None = None,
    text_hint: str | None = None,
    filename: str | None = None,
) -> tuple[str | None, str | None]:
    """Infer `(full_institution_name, short_prefix)` from CSV headers, OFX FI org, text, or filename."""
    if headers:
        norm_headers = {h.strip().lower() for h in headers if h}
        if _RBC_SIGNATURE_HEADERS.issubset(norm_headers) or {
            "account type",
            "account number",
            "description 1",
            "cad$",
        }.issubset(norm_headers):
            return ("Royal Bank of Canada (RBC)", "RBC")

    if raw_types:
        for rt in raw_types:
            if rt and "royal credit line" in rt.strip().lower():
                return ("Royal Bank of Canada (RBC)", "RBC")

    for candidate in (org_hint, text_hint, filename):
        if not candidate:
            continue
        cleaned = candidate.replace("_", " ").replace("-", " ")
        for pattern, full_name, short_name in _INSTITUTION_PATTERNS:
            if pattern.search(cleaned):
                return (full_name, short_name)

    if org_hint and org_hint.strip():
        clean_org = org_hint.strip()
        return (clean_org, clean_org)

    return (None, None)


# Account kinds written as acronyms, kept in capitals ("TFSA", not "Tfsa").
_ACRONYM_LABELS = {"TFSA", "RRSP", "RESP", "FHSA", "RDSP", "RRIF", "LIRA", "LIF", "IPP", "HISA", "GIC", "LOC", "CELI", "REER"}


def _format_raw_type_label(raw_type: str) -> str:
    cleaned = raw_type.strip()
    if cleaned.isupper() and cleaned in _ACRONYM_LABELS:
        return cleaned
    if cleaned.isupper():
        upper_map = {
            "CHECKING": "Chequing",
            "SAVINGS": "Savings",
            "CREDITCARD": "Credit Card",
            "CREDITLINE": "Line of Credit",
            "MONEYMRKT": "Money Market",
        }
        return upper_map.get(cleaned, cleaned.title())
    return cleaned


def _humanize_filename(filename: str | None) -> str:
    if not filename:
        return "Imported Account"
    stem = Path(filename).stem
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    if not stem or stem.lower() in {"statement", "export", "transactions", "download"}:
        return "Imported Account"
    return stem[:60].title()


def suggest_account_name(
    raw_type: str | None,
    account_type: AccountType,
    mask: str | None,
    short_institution: str | None,
    filename: str | None = None,
) -> str:
    """Build a concise, human-friendly default account name (<= 100 chars)."""
    if raw_type and raw_type.strip():
        base = _format_raw_type_label(raw_type)
    elif mask or short_institution:
        base = ACCOUNT_TYPE_LABELS.get(account_type, "Account")
    else:
        base = _humanize_filename(filename)

    if short_institution:
        inst_lower = short_institution.strip().lower()
        if not base.lower().startswith(inst_lower):
            base = f"{short_institution.strip()} {base}"

    if mask:
        suffix = f" ({mask})"
        if len(base) + len(suffix) > 100:
            base = base[: 100 - len(suffix)].rstrip()
        return f"{base}{suffix}"

    return base[:100]


def match_existing_account(
    existing_accounts: list[Account],
    mask: str | None,
    inferred_type: AccountType,
    raw_type: str | None = None,
    institution: str | None = None,
) -> Account | None:
    """Match a detected account against active existing Folio accounts using its last-4 digits."""
    target_last4 = _last4_digits(mask)
    if not target_last4:
        return None

    active = [a for a in existing_accounts if a.is_active]
    last4_matches = [a for a in active if _last4_digits(a.account_number_mask) == target_last4]
    if not last4_matches:
        return None

    # Tier 1: Match both last-4 digits and inferred AccountType
    type_matches = [a for a in last4_matches if a.type == inferred_type]
    if len(type_matches) == 1:
        return type_matches[0]

    if len(type_matches) > 1:
        if raw_type:
            rt_lower = raw_type.strip().lower()
            name_hits = [a for a in type_matches if rt_lower in (a.name or "").lower()]
            if len(name_hits) == 1:
                return name_hits[0]
            if name_hits:
                type_matches = name_hits
        if institution:
            inst_lower = institution.strip().lower()
            inst_hits = [
                a
                for a in type_matches
                if a.institution
                and (inst_lower in a.institution.lower() or a.institution.lower() in inst_lower)
            ]
            if len(inst_hits) == 1:
                return inst_hits[0]
        return type_matches[0]

    # Tier 2: Unique last-4 match regardless of AccountType (handles e.g. SAVINGS -> HISA)
    if len(last4_matches) == 1:
        return last4_matches[0]

    return None
