import re
from dataclasses import dataclass

@dataclass
class SemanticClassificationResult:
    category_slug: str
    matched_keyword: str
    confidence: float = 0.85


# Specific domain taxonomies checked in priority order
TAXONOMY_PRIORITY: list[tuple[str, list[str]]] = [
    (
        "health-medical",
        [
            "PHARMACY", "PHARMACIE", "DRUGSTORE", "CLINIQUE", "CLINIC", "DENTAL",
            "DENTAIRE", "DENTIST", "DENTISTE", "ORTHODONT", "LABORATOIRE", "HOSPITAL",
            "HÔPITAL", "HOPITAL", "SANTE", "SANTÉ", "OPTOMETRY", "OPTOMETRIE",
            "OPTIQUE", "EYECARE", "PHYSIO", "CHIRO", "MEDECIN", "DOCTOR",
        ],
    ),
    (
        "transportation",
        [
            "TOLL", "PÉAGE", "PEAGE", "EXPRESSWAY", "HIGHWAY", "AUTOROUTE", "BRIDGE",
            "TUNNEL", "STATIONNEMENT", "AUTOPARC", "PARKING", "TRANSIT", "METRO",
            "MÉTRO", "FERRY", "RIDESHARE",
        ],
    ),
    (
        "coffee-shops",
        [
            "COFFEE", "ESPRESSO", "ROASTER", "ROASTERY", "MATCHA", "DONUT", "DOUGHNUT",
        ],
    ),
    (
        "restaurants",
        [
            "RESTAURANT", "RESTO", "BISTRO", "BRASSERIE", "GRILL", "BAKERY",
            "BOULANGERIE", "PIZZA", "PIZZERIA", "BURGER", "TACO", "SUSHI",
            "RAMEN", "NOODLE", "BBQ", "DINER", "PUB", "TAVERN", "EATERY",
            "KITCHEN", "STEAKHOUSE", "ROTISSERIE", "SHAWARMA", "KEBAB",
            "FALAFEL", "POKE", "BAGEL", "CREPERIE", "TRATTORIA", "TAQUERIA",
            "CANTINE", "CANTEEN", "CAFE", "CAFÉ",
        ],
    ),
    (
        "groceries",
        [
            "SUPERMARKET", "GROCERY", "GROCERIES", "EPICERIE", "ÉPICERIE", "PRODUCE",
            "BUTCHER", "BOUCHERIE", "POISSONNERIE", "SUPERSTORE", "MARCHÉ", "MARCHE",
            "MARKET",
        ],
    ),
    (
        "fuel",
        [
            "PETRO", "PETROLEUM", "PÉTROLE", "GAS STATION", "STATION SERVICE", "ESSENCE",
            "PETROL", "OIL",
        ],
    ),
    (
        "utilities",
        [
            "HYDRO", "ELECTRIC", "ELECTRICITE", "ÉLECTRICITÉ", "POWER", "GAZ",
            "TELECOM", "WIRELESS", "INTERNET", "FIBRE", "SEWAGE", "ENERGY", "ÉNERGIE",
        ],
    ),
    (
        "subscriptions",
        [
            "SUBSCRIPTION", "MEMBERSHIP", "RECURRING", "SAAS", "STREAMING",
            "HOSTING", "VPN", "CLOUD",
        ],
    ),
    (
        "travel",
        [
            "AIRLINES", "AIRWAYS", "HOTEL", "MOTEL", "RESORT", "AIRBNB", "FLIGHT",
            "LODGE", "INN", "SUITES", "VOYAGE",
        ],
    ),
    (
        "shopping",
        [
            "BOUTIQUE", "OUTLET", "FASHION", "CLOTHING", "VETEMENT", "VÊTEMENT",
            "HARDWARE", "QUINCALLERIE", "ELECTRONICS", "BOOKSTORE", "LIBRAIRIE",
            "JEWELRY", "BIJOUTERIE", "MAGASIN", "MALL",
        ],
    ),
]


def classify_by_semantic_keywords(raw_payee: str) -> SemanticClassificationResult | None:
    """
    Analyzes raw merchant text and extracts commercial category intent
    based on prioritized semantic business tokens.
    """
    if not raw_payee:
        return None

    cleaned = re.sub(r"[^\w\s\-\']", " ", raw_payee).upper()
    tokens = set(cleaned.split())

    for category_slug, keywords in TAXONOMY_PRIORITY:
        for keyword in keywords:
            if " " in keyword:
                if keyword in cleaned:
                    return SemanticClassificationResult(
                        category_slug=category_slug,
                        matched_keyword=keyword,
                        confidence=0.85,
                    )
            elif keyword in tokens:
                return SemanticClassificationResult(
                    category_slug=category_slug,
                    matched_keyword=keyword,
                    confidence=0.85,
                )

    return None
