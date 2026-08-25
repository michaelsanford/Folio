import re

# Regex patterns for common prefixes/suffixes in bank statements (Bilingual EN/FR)
NOISE_PATTERNS = [
    # English prefix noise
    r"^POS\s+DEBIT\s+",
    r"^POS\s+PURCHASE\s+",
    r"^CHECKCARD\s+\d*\s*",
    r"^PURCHASE\s+AUTHORIZED\s+ON\s+\d{2}/\d{2}\s+",
    r"^DEBIT\s+CARD\s+PURCHASE\s+",
    r"^RECURRING\s+PAYMENT\s+AUTHORIZED\s+ON\s+\d{2}/\d{2}\s+",
    r"^ACH\s+DEBIT\s+",
    r"^ACH\s+CREDIT\s+",
    r"^ACH\s+PYMT\s+",
    r"^SQ\s*\*\s*",
    r"^TST\s*\*\s*",
    r"^PAYPAL\s*\*\s*",
    r"^SP\s*\*\s*",
    r"^APLPAY\s+",
    r"^GOOGLE\s*\*\s*",
    r"^BILL\s+PMT\s+",
    r"^E-PAY\s+",
    r"^WEB\s+BANKING\s+",
    
    # French prefix noise (Desjardins, National Bank, BMO, RBC QC, etc.)
    r"^PR[É|E]L[È|E]VEMENT\s+(AUTOMATIQUE\s+)?",
    r"^PAIEMENT\s+(DIRECT|INTERNET|FACTURE|MOBILE|PAR\s+CARTE)\s+",
    r"^VIR(EMENT)?\s+INTERAC\s+",
    r"^INTERAC\s+E-?TRANSFER\s+",
    r"^RETRAIT\s+(GUICHET|INTERAC|DIRECT)\s+",
    r"^ACHAT\s+INTERAC\s+",
    r"^CARTE\s+DE\s+D[É|E]BIT\s+",
    r"^FRAIS\s+DE\s+SERVICE\s+",
    r"^COTISATION\s+",
    
    # Common suffix noise (Store IDs, Phone numbers, Postal codes, Ref codes)
    r"\s*#\s*\d+",                    # Store numbers like #1234
    r"\s+\d{3}-\d{3}-\d{4}",           # Phone numbers
    r"\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$",   # Canadian postal codes e.g. H2X 1Y4
    r"\s+[A-Z]{2}\s+\d{5}$",           # US State + Zip e.g. NY 10001
    r"\s+\d{4,}$",                     # Trailing reference numbers
    r"\s+ID:\s*\w+",                   # Transaction IDs
    r"\s+STORE\s+\d+",                 # STORE 1234
    r"\s+LOC\s+\d+",                   # LOC 1234
]

COMPILED_NOISE = [re.compile(p, re.IGNORECASE) for p in NOISE_PATTERNS]

KNOWN_MERCHANT_MAP = {
    # Tech & Subscriptions
    "suno": "Suno AI",
    "tidal": "Tidal",
    "tradingview": "TradingView",
    "seeking alpha": "Seeking Alpha",
    "finviz": "Finviz",
    "chatgpt": "OpenAI / ChatGPT",
    "openai": "OpenAI",
    "anthropic": "Anthropic Claude",
    "claude.ai": "Anthropic Claude",
    "github": "GitHub",
    "jetbrains": "JetBrains",
    "netflix": "Netflix",
    "spotify": "Spotify",
    "apple.com/bill": "Apple Services",
    "itunes.com": "Apple iTunes",
    "amazon prime": "Amazon Prime",
    "prime video": "Prime Video",
    "disney plus": "Disney+",
    "disney+": "Disney+",
    "hulu": "Hulu",
    "max.com": "Max (HBO)",
    "steam": "Steam",
    "playstation": "PlayStation",
    "xbox": "Xbox",
    "1password": "1Password",
    "dropbox": "Dropbox",

    # Transportation, Tolls & Gas
    "a30 express": "A30 Express",
    "autoroute 30": "A30 Express",
    "407 etr": "407 ETR Tolls",
    "ultramar": "Ultramar",
    "couche-tard": "Couche-Tard",
    "couche tard": "Couche-Tard",
    "harnois": "Harnois",
    "canadian tire gas": "Canadian Tire Gas+",
    "petro-canada": "Petro-Canada",
    "petrocan": "Petro-Canada",
    "esso": "Esso",
    "shell": "Shell",
    "chevron": "Chevron",
    "exxon": "ExxonMobil",
    "mobil": "Mobil",
    "bixi": "BIXI Montréal",
    "communauto": "Communauto",
    "stm ": "STM Transit Montréal",
    "opus": "Carte OPUS Transit",
    "uber": "Uber",
    "lyft": "Lyft",

    # Restaurants & Dining
    "boustan": "Boustan",
    "a&w": "A&W Canada",
    "a & w": "A&W Canada",
    "kinton": "Kinton Ramen",
    "mishoya": "Ramen Mishoya",
    "st-hubert": "St-Hubert",
    "saint-hubert": "St-Hubert",
    "chez ashton": "Chez Ashton",
    "ashton": "Chez Ashton",
    "belle province": "La Belle Province",
    "the keg": "The Keg Steakhouse",
    "boston pizza": "Boston Pizza",
    "swiss chalet": "Swiss Chalet",
    "harvey": "Harvey's",
    "mcdonald": "McDonald's",
    "chipotle": "Chipotle",
    "five guys": "Five Guys",
    "popeye": "Popeyes",
    "starbucks": "Starbucks",
    "tim horton": "Tim Hortons",
    "second cup": "Second Cup",
    "premiere moisson": "Première Moisson",

    # Health & Pharmacy
    "jean coutu": "Jean Coutu",
    "jean-coutu": "Jean Coutu",
    "pjc ": "Jean Coutu",
    "privamed": "Clinique Privamed",
    "pharmaprix": "Pharmaprix",
    "shoppers drug mart": "Shoppers Drug Mart",
    "uniprix": "Uniprix",
    "familiprix": "Familiprix",
    "brunet": "Brunet",

    # Supermarkets & Retail
    "iga": "IGA",
    "maxi": "Maxi",
    "super c": "Super C",
    "metro": "Metro",
    "provigo": "Provigo",
    "costco": "Costco Wholesale",
    "walmart": "Walmart",
    "wal-mart": "Walmart",
    "target": "Target",
    "trader joe": "Trader Joe's",
    "whole foods": "Whole Foods",
    "wholefds": "Whole Foods",
    "canadian tire": "Canadian Tire",
    "dollarama": "Dollarama",
    "saq": "SAQ",
    "lcbo": "LCBO",
    "rona": "RONA",
    "reno-depot": "Réno-Dépôt",
    "home depot": "The Home Depot",
    "lowe": "Lowe's",
    "ikea": "IKEA",
    "best buy": "Best Buy",
    "amazon": "Amazon",
    "amzn": "Amazon",

    # Utilities
    "hydro-quebec": "Hydro-Québec",
    "hydro quebec": "Hydro-Québec",
    "energir": "Énergir",
    "gaz metro": "Énergir",
    "videotron": "Vidéotron",
    "vidéotron": "Vidéotron",
    "fizz": "Fizz",
    "bell": "Bell Canada",
    "telus": "Telus",
    "rogers": "Rogers",
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
