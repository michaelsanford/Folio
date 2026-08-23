import re

# Regex patterns for common prefixes/suffixes in bank statements
NOISE_PATTERNS = [
    r"^POS\s+DEBIT\s+",
    r"^CHECKCARD\s+\d*\s*",
    r"^PURCHASE\s+AUTHORIZED\s+ON\s+\d{2}/\d{2}\s+",
    r"^DEBIT\s+CARD\s+PURCHASE\s+",
    r"^RECURRING\s+PAYMENT\s+AUTHORIZED\s+ON\s+\d{2}/\d{2}\s+",
    r"^SQ\s*\*\s*",
    r"^TST\s*\*\s*",
    r"^PAYPAL\s*\*\s*",
    r"^SP\s*\*\s*",
    r"^APLPAY\s+",
    r"^GOOGLE\s*\*\s*",
    r"\s*#\s*\d+",                   # Store numbers like #1234
    r"\s+\d{3}-\d{3}-\d{4}",          # Phone numbers
    r"\s+[A-Z]{2}\s+\d{5}$",          # State + Zip e.g. NY 10001
    r"\s+\d{4,}$",                    # Trailing reference numbers
    r"\s+ID:\s*\w+",                  # Transaction IDs
]

COMPILED_NOISE = [re.compile(p, re.IGNORECASE) for p in NOISE_PATTERNS]

KNOWN_MERCHANT_MAP = {
    "amzn": "Amazon",
    "amazon": "Amazon",
    "target": "Target",
    "wal-mart": "Walmart",
    "walmart": "Walmart",
    "costco": "Costco",
    "netflix": "Netflix",
    "spotify": "Spotify",
    "apple.com/bill": "Apple",
    "uber": "Uber",
    "uber eats": "Uber Eats",
    "lyft": "Lyft",
    "doordash": "DoorDash",
    "grubhub": "Grubhub",
    "starbucks": "Starbucks",
    "shell": "Shell",
    "chevron": "Chevron",
    "exxon": "ExxonMobil",
    "kroger": "Kroger",
    "trader joe": "Trader Joe's",
    "wholefds": "Whole Foods",
    "whole foods": "Whole Foods",
    "mcdonald": "McDonald's",
    "chick-fil-a": "Chick-fil-A",
}


def normalize_payee(raw_payee: str) -> str:
    """
    Cleans raw bank statement payee descriptions into human-readable merchant names.
    """
    if not raw_payee:
        return "Unknown"

    cleaned = raw_payee.strip()

    for pattern in COMPILED_NOISE:
        cleaned = pattern.sub("", cleaned).strip()

    # Check known merchant substrings
    lower_cleaned = cleaned.lower()
    for key, normalized in KNOWN_MERCHANT_MAP.items():
        if key in lower_cleaned:
            return normalized

    # Clean multiple spaces and special punctuation
    cleaned = re.sub(r"[\*\_]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Title-case if all uppercase or lowercase
    if cleaned.isupper() or cleaned.islower():
        words = cleaned.split()
        cleaned = " ".join(w.capitalize() for w in words)

    return cleaned or raw_payee.strip()
