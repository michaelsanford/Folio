from dataclasses import dataclass
import re

@dataclass
class SemanticClassificationResult:
    category_slug: str
    matched_keyword: str
    confidence: float = 0.85


# Specific domain taxonomies checked in priority order
# 22 granular Canadian & US household categories with bilingual English & French keywords
TAXONOMY_PRIORITY: list[tuple[str, list[str]]] = [
    (
        "pets",
        [
            "VET", "VETERINARY", "VETERINARIAN", "VÉTÉRINAIRE", "VETERINAIRE",
            "ANIMAL HOSPITAL", "HOPITAL VETERINAIRE", "PET FOOD",
            "NOURRITURE POUR ANIMAUX", "PET SUPPLIES", "ANIMALERIE", "PETSMART",
            "PET VALU", "MONDIOU", "DOG GROOMING", "TOILETTAGE", "CAT CLINIC",
            "KENNEL", "PENSION CANINE", "AQUARIUM", "REFUGE ANIMAL",
        ],
    ),
    (
        "childcare",
        [
            "GARDERIE", "DAYCARE", "CHILDCARE", "CPE", "CENTRE DE LA PETITE ENFANCE",
            "SERVICE DE GARDE", "PRESCHOOL", "PRÉMATERNELLE", "HALTE-GARDERIE",
            "NURSERY SCHOOL", "POUPONNIERE", "POUPONNIÈRE", "BABYSITTING",
            "GARDIENNAGE", "INFANT CARE", "EARLY LEARNING", "KIDS CLUB",
            "CAMP DE JOUR", "SUMMER CAMP",
        ],
    ),
    (
        "education",
        [
            "UNIVERSITY", "UNIVERSITÉ", "UNIVERSITE", "COLLEGE", "COLLÈGE", "CÉGEP",
            "CEGEP", "ACADEMY", "ACADÉMIE", "TUITION", "FRAIS DE SCOLARITÉ",
            "SCOLARITE", "CAMPUS", "BOOKSTORE", "LIBRAIRIE", "TEXTBOOK",
            "MANUELS SCOLAIRES", "COURSE", "COURS", "TRAINING", "FORMATION",
            "SCHOOL", "ÉCOLE", "ECOLE", "SEMINAR", "SÉMINAIRE", "STUDENT LOAN",
            "PRET ETUDIANT", "PRÊT ÉTUDIANT",
        ],
    ),
    (
        "health-medical",
        [
            "PHARMACY", "PHARMACIE", "DRUGSTORE", "CLINIQUE", "CLINIC", "DENTAL",
            "DENTAIRE", "DENTIST", "DENTISTE", "ORTHODONT", "ORTHODONTIE", "LABORATOIRE",
            "LABORATORY", "HOSPITAL", "HÔPITAL", "HOPITAL", "SANTE", "SANTÉ",
            "OPTOMETRY", "OPTOMETRIE", "OPTOMÉTRIE", "OPTIQUE", "EYECARE", "PHYSIO",
            "PHYSIOTHÉRAPIE", "CHIRO", "CHIROPRA", "MEDECIN", "MÉDECIN", "DOCTOR",
            "MEDICAL", "MÉDICAL", "HEALTH", "SURGERY", "CHIRURGIE", "THERAPY",
            "THÉRAPIE", "PSYCHOLOG", "SOINS DE SANTÉ",
        ],
    ),
    (
        "transportation",
        [
            "TOLL", "PÉAGE", "PEAGE", "EXPRESSWAY", "HIGHWAY", "AUTOROUTE", "BRIDGE",
            "PONT", "TUNNEL", "STATIONNEMENT", "AUTOPARC", "PARKING", "TRANSIT", "METRO",
            "MÉTRO", "SUBWAY", "BUS", "AUTOBUS", "FERRY", "TRAVERSIER", "RIDESHARE",
            "COVOITURAGE", "TAXI", "CAB", "UBER", "LYFT", "BIKE SHARE", "BIXI",
            "COMMUNAUTO", "SCOOTER", "TRAIN", "RAILWAY", "AMTRAK", "VIA RAIL",
            "CHEMIN DE FER", "OPUS", "CARTE OPUS",
        ],
    ),
    (
        "coffee-shops",
        [
            "COFFEE", "ESPRESSO", "ROASTER", "ROASTERY", "TORREFACTION", "TORRÉFACTION",
            "BRULERIE", "BRÛLERIE", "MATCHA", "DONUT", "DOUGHNUT", "BEIGNE", "BEIGNES",
            "TIM HORTONS", "STARBUCKS", "SECOND CUP",
        ],
    ),
    (
        "fast-food",
        [
            "FAST FOOD", "FAST-FOOD", "DRIVE-THRU", "DRIVE THRU", "BURGER KING",
            "MCDONALD", "WENDY", "TACO BELL", "A&W", "HARVEY", "PIZZA PIZZA",
            "SUBWAY", "POPEYES", "KFC", "POUTINE", "FRITES", "CASSE-CROUTE",
            "CASSE-CROÛTE", "RESTAURATION RAPIDE", "PRET-A-MANGER", "PRÊT-À-MANGER",
            "FRITERIE",
        ],
    ),
    (
        "alcohol-bars",
        [
            "SAQ", "LCBO", "BEER STORE", "BREWERY", "BREWPUB", "MICROBRASSERIE",
            "WINERY", "VIGNOBLE", "DISTILLERY", "DISTILLERIE", "LIQUOR", "SPIRITS",
            "SPIRITUEUX", "ALCOHOL", "ALCOOL", "BIERE", "BIÈRE", "VIN", "VINS",
            "BAR", "PUB", "TAVERN", "TAVERNE", "LOUNGE", "COCKTAIL", "CIDER",
            "CIDRERIE", "CIDRE", "BAR A VIN", "BAR À VIN",
        ],
    ),
    (
        "restaurants",
        [
            "RESTAURANT", "RESTO", "BISTRO", "BRASSERIE", "GRILL", "BAKERY",
            "BOULANGERIE", "PATISSERIE", "PÂTISSERIE", "PIZZA", "PIZZERIA", "BURGER",
            "TACO", "SUSHI", "RAMEN", "NOODLE", "BBQ", "BARBECUE", "DINER",
            "EATERY", "KITCHEN", "STEAKHOUSE", "ROTISSERIE", "RÔTISSERIE",
            "SHAWARMA", "KEBAB", "FALAFEL", "POKE", "BAGEL", "CREPERIE", "CRÊPERIE",
            "TRATTORIA", "TAQUERIA", "CANTINE", "CANTEEN", "CAFE", "CAFÉ",
            "AUBERGE", "TRAITEUR", "CHARCUTERIE", "GASTRO", "BUFFET",
        ],
    ),
    (
        "groceries",
        [
            "SUPERMARKET", "SUPERMARCHÉ", "SUPERMARCHE", "GROCERY", "GROCERIES",
            "EPICERIE", "ÉPICERIE", "ALIMENTATION", "PRODUCE", "BUTCHER",
            "BOUCHERIE", "POISSONNERIE", "SUPERSTORE", "MARCHÉ", "MARCHE",
            "MARKET", "FOOD MARKET", "COSTCO", "METRO", "IGA", "MAXI",
            "SUPER C", "PROVIGO", "LOBLAWS", "SOBEYS", "SAFEWAY", "FARM BOY",
            "NO FRILLS", "FOOD BASICS", "TRADER JOE", "WHOLE FOODS", "ALDI",
            "KROGER", "WEGMANS", "SPROUTS", "FRUITS ET LEGUMES", "FRUITS ET LÉGUMES",
        ],
    ),
    (
        "fuel",
        [
            "PETRO", "PETROLEUM", "PÉTROLE", "PETROL", "GAS STATION", "STATION SERVICE",
            "STATION-SERVICE", "ESSENCE", "CARBURANT", "OIL", "SUPERTEST", "DIESEL",
            "EV CHARGING", "CHARGING POINT", "SUPERCHARGER", "BORNE RECHARGE",
        ],
    ),
    (
        "utilities",
        [
            "HYDRO", "ELECTRIC", "ELECTRICITE", "ÉLECTRICITÉ", "ELECTRICITY", "POWER",
            "GAZ", "GAS", "NATURAL GAS", "TELECOM", "WIRELESS", "INTERNET", "FIBRE",
            "SEWAGE", "ENERGY", "ÉNERGIE", "ENERGIE", "WATER", "EAU", "WASTE",
            "DECHETS", "DÉCHETS", "SERVICES PUBLICS", "CABLE", "EAUX USEES", "EAUX USÉES",
        ],
    ),
    (
        "subscriptions",
        [
            "SUBSCRIPTION", "ABONNEMENT", "ABONNEMENTS", "MEMBERSHIP", "RECURRING",
            "STREAMING", "HOSTING", "HEBERGEMENT", "HÉBERGEMENT", "VPN",
            "CLOUD HOSTING", "CLOUD STORAGE", "CLOUD BACKUP", "SOFTWARE", "PATREON",
            "SUBSTACK", "MONTHLY SUB", "MENSUALITE", "MENSUALITÉ",
        ],
    ),
    (
        "travel",
        [
            "AIRLINES", "AIRWAYS", "AÉRIEN", "AERIEN", "HOTEL", "HÔTEL", "MOTEL",
            "RESORT", "AIRBNB", "VRBO", "FLIGHT", "VOL", "LODGE", "INN", "SUITES",
            "VOYAGE", "VOYAGES", "CRUISE", "CROISIÈRE", "CROISIERE", "CAR RENTAL",
            "LOCATION D'AUTO", "HOSTEL", "AUBERGE DE JEUNESSE", "AGENCE DE VOYAGE",
            "EXPEDIA", "BOOKING.COM",
        ],
    ),
    (
        "income-salary",
        [
            "PAYROLL", "PAIE", "SALARY", "SALAIRE", "DIRECT DEP", "DEPOT DIRECT",
            "DÉPÔT DIRECT", "DIRECT DEPOSIT", "EI", "ASSURANCE-EMPLOI",
            "EMPLOYMENT INSURANCE", "CANADA FPT", "CCB", "ACE", "CHILD BENEFIT",
            "ALLOCATION FAMILIALE", "REFUND", "REMBOURSEMENT", "WAGES",
            "REMUNERATION", "RÉMUNÉRATION", "PAYCHEQUE", "PAYCHECK", "PENSION",
            "OAS", "SV", "CPP", "RPC", "QPP", "RRQ", "VIREMENT INTERAC RECU",
        ],
    ),
    (
        "insurance",
        [
            "INSURANCE", "ASSURANCE", "ASSURANCES", "DESJARDINS ASSUR", "BELAIRDIRECT",
            "INTACT ASSURANCE", "MANULIFE", "SUN LIFE", "CANADA LIFE", "GREAT-WEST",
            "ALLSTATE", "GEICO", "STATE FARM", "CO-OPERATORS", "POLICY",
            "POLICE D'ASSURANCE", "ASSURANCE-VIE", "ASSUR-AUTO", "ASSUR-HABITATION",
        ],
    ),
    (
        "bank-fees",
        [
            "MONTHLY FEE", "FRAIS MENSUELS", "SERVICE CHARGE", "FRAIS DE SERVICE",
            "FRAIS DE COMPTE", "FRAIS BANCAIRE", "FRAIS BANCAIRES", "OVERDRAFT",
            "DECOUVERT", "DÉCOUVERT", "NSF", "SANS PROVISION", "ATM FEE",
            "FRAIS GUICHET", "WIRE FEE", "FRAIS DE VIREMENT", "TRANSACTION FEE",
            "ACCOUNT FEE", "ANNUAL FEE", "COTISATION ANNUELLE", "INTEREST CHARGE",
            "INTERET DEBITEUR", "INTÉRÊT DÉBITEUR", "BANK FEE",
        ],
    ),
    (
        "electronics",
        [
            "ELECTRONICS", "ELECTRONIQUE", "ÉLECTRONIQUE", "COMPUTER", "COMPUTERS",
            "INFORMATIQUE", "ORDINATEUR", "ORDINATEURS", "TECH STORE", "CELL PHONE",
            "SMARTPHONE", "TÉLÉPHONIE", "TELEPHONIE", "AUDIO", "VIDEO GAMES",
            "JEUX VIDEO", "JEUX VIDÉO", "GADGET", "BEST BUY", "MICRO CENTER",
            "APPLE STORE",
        ],
    ),
    (
        "home-improvement",
        [
            "HARDWARE", "QUINCALLERIE", "QUINCAILLERIE", "HOME IMPROVEMENT",
            "RENOVATION", "RÉNOVATION", "LUMBER", "BOIS", "PLUMBING", "PLOMBERIE",
            "PAINT", "PEINTURE", "GARDENING", "JARDINERIE", "NURSERY", "FURNITURE",
            "AMEUBLEMENT", "MEUBLES", "HOME DEPOT", "LOWE", "RONA", "RENO-DEPOT",
            "RÉNO-DÉPÔT", "IKEA", "BRICOLAGE", "MATERIAUX", "MATÉRIAUX",
        ],
    ),
    (
        "entertainment",
        [
            "CINEMA", "CINÉMA", "THEATER", "THEATRE", "THÉÂTRE", "MOVIES", "CONCERT",
            "SPECTACLE", "SPECTACLES", "TICKETMASTER", "BILLETTERIE", "MUSEUM",
            "MUSÉE", "MUSEE", "AMUSEMENT PARK", "PARC D'ATTRACTIONS", "BOWLING",
            "QUILLES", "ARCADE", "CASINO", "EVENT", "ÉVÉNEMENT", "FESTIVAL",
            "OPERA", "OPÉRA", "COMEDY CLUB", "DIVERTISSEMENT",
        ],
    ),
    (
        "personal-care",
        [
            "BARBER", "BARBIER", "HAIR SALON", "SALON DE COIFFURE", "COIFFURE",
            "HAIRSTYLIST", "BEAUTY", "BEAUTÉ", "BEAUTE", "SPA", "NAIL SALON",
            "MANICURE", "MANUCURE", "PEDICURE", "PÉDICURE", "COSMETICS",
            "COSMÉTIQUES", "SKINCARE", "SOINS DE LA PEAU", "ESTHETICS",
            "ESTHÉTIQUE", "MASSAGE", "MASSOTHÉRAPIE", "TATTOO", "TATOO",
            "TATOUAGE", "TANNING", "BRONZAGE",
        ],
    ),
    (
        "shopping",
        [
            "BOUTIQUE", "OUTLET", "FASHION", "CLOTHING", "VETEMENT", "VÊTEMENT",
            "VÊTEMENTS", "APPAREL", "SHOES", "CHAUSSURES", "JEWELRY", "BIJOUTERIE",
            "MAGASIN", "MALL", "CENTRE COMMERCIAL", "DEPARTMENT STORE",
            "GRAND MAGASIN", "THRIFT", "FRIPERIE", "VINTAGE", "RETAIL", "MODE",
        ],
    ),
]


def _clean_payee_text(text: str) -> str:
    """Strips store numbers, postal codes, and punctuation from raw payee."""
    cleaned = re.sub(r"#\s*\d+", " ", text)
    cleaned = re.sub(r"\b(STORE|SUCCURSALE|SUCC|LOC)\s*#?\d+\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^\w\s\-\'\u00C0-\u017F]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).upper().strip()


def _tokenize(text: str) -> list[str]:
    """Extracts alphanumeric words including French accents."""
    return re.findall(r"[\w\u00C0-\u017F]+", text.upper())


def _is_levenshtein_1(s1: str, s2: str) -> bool:
    """Checks whether two strings have Levenshtein distance <= 1."""
    if abs(len(s1) - len(s2)) > 1:
        return False
    if s1 == s2:
        return True
    if len(s1) == len(s2):
        return sum(c1 != c2 for c1, c2 in zip(s1, s2)) == 1
    if len(s1) > len(s2):
        s1, s2 = s2, s1  # s1 is shorter
    for i in range(len(s2)):
        if s2[:i] + s2[i + 1:] == s1:
            return True
    return False


def classify_by_semantic_heuristics(
    raw_payee: str,
    amount: float | None = None,
    account_type: str | None = None,
) -> SemanticClassificationResult | None:
    """
    Tier 3 auto-classification: Enhanced Semantic & Heuristic Classifier.
    
    1. Sign & Amount heuristics:
       - If amount > 0: Check for income signals ("PAYROLL", "SALARY", "DIRECT DEP",
         "EI", "CANADA FPT", "CCB", "REFUND", "DEPOT", "VIREMENT") -> income-salary.
       - If amount < 0: Check for tax and bill patterns -> utilities / bank-fees.
    2. Prioritized taxonomy semantic matching (22 Canadian & US household categories).
    3. Fuzzy matching with token-set overlap (Jaccard similarity, token inclusion,
       typo tolerance via edit distance <= 1, prefix/suffix variations).
    """
    if not raw_payee or not raw_payee.strip():
        return None

    cleaned_text = _clean_payee_text(raw_payee)
    tokens = set(_tokenize(cleaned_text))

    # 1. Sign & Amount Heuristics
    if amount is not None and amount > 0:
        income_signals = [
            "PAYROLL", "SALARY", "DIRECT DEP", "DIRECT DEPOSIT",
            "EI", "CANADA FPT", "CCB", "REFUND", "DEPOT", "DÉPÔT",
            "VIREMENT", "PAYCHEQUE", "PAYCHECK", "WAGES", "PAIE",
            "SALAIRE", "REMUNERATION", "RÉMUNÉRATION", "REMBOURSEMENT",
            "EMPLOYMENT INSURANCE", "ASSURANCE-EMPLOI", "CHILD BENEFIT",
            "OAS", "SV", "CPP", "RPC", "QPP", "RRQ", "PENSION", "BENEFIT",
        ]
        for sig in income_signals:
            if " " in sig:
                if sig in cleaned_text:
                    return SemanticClassificationResult(
                        category_slug="income-salary",
                        matched_keyword=sig,
                        confidence=0.90,
                    )
            elif sig in tokens:
                return SemanticClassificationResult(
                    category_slug="income-salary",
                    matched_keyword=sig,
                    confidence=0.90,
                )

    if amount is not None and amount < 0:
        # Check bill/tax patterns
        tax_patterns = [
            "PROPERTY TAX", "TAXES MUNICIPALES", "MUNICIPAL TAX",
            "CRA", "REVENUE QUEBEC", "REVENU QUÉBEC", "REVENU QUEBEC",
            "INTERNAL REVENUE", "IRS", "TAX INSTALLMENT", "IMPOT", "IMPÔT",
            "TAX PYMT", "TAX PAYMENT", "SCHOOL TAX", "TAXE SCOLAIRE",
            "PROPERTY TAXES",
        ]
        for pat in tax_patterns:
            if " " in pat:
                if pat in cleaned_text:
                    return SemanticClassificationResult(
                        category_slug="utilities",
                        matched_keyword=pat,
                        confidence=0.90,
                    )
            elif pat in tokens:
                return SemanticClassificationResult(
                    category_slug="utilities",
                    matched_keyword=pat,
                    confidence=0.90,
                )

        bill_patterns = [
            "BILL PMT", "BILL PAYMENT", "PAIEMENT FACTURE", "E-PAY BILL",
            "HYDRO BILL", "WATER BILL", "ELECTRIC BILL", "GAS BILL",
            "FACTURE", "PAYMENT TO UTILITY",
        ]
        for pat in bill_patterns:
            if " " in pat:
                if pat in cleaned_text:
                    return SemanticClassificationResult(
                        category_slug="utilities",
                        matched_keyword=pat,
                        confidence=0.90,
                    )
            elif pat in tokens:
                return SemanticClassificationResult(
                    category_slug="utilities",
                    matched_keyword=pat,
                    confidence=0.90,
                )

        fee_patterns = [
            "MONTHLY FEE", "FRAIS DE SERVICE", "FRAIS MENSUELS",
            "OVERDRAFT", "NSF", "ATM FEE", "SERVICE CHARGE",
            "FRAIS BANCAIRES", "FRAIS BANCAIRE", "COTISATION ANNUELLE",
            "SERVICE FEE", "ACCOUNT FEE", "ACCOUNT SERVICE",
        ]
        for pat in fee_patterns:
            if " " in pat:
                if pat in cleaned_text or set(_tokenize(pat)).issubset(tokens):
                    return SemanticClassificationResult(
                        category_slug="bank-fees",
                        matched_keyword=pat,
                        confidence=0.90,
                    )
            elif pat in tokens:
                return SemanticClassificationResult(
                    category_slug="bank-fees",
                    matched_keyword=pat,
                    confidence=0.90,
                )

    # 2. Priority Taxonomy: Exact Substring and Token Inclusion
    for category_slug, keywords in TAXONOMY_PRIORITY:
        for keyword in keywords:
            kw_clean = keyword.upper()
            if " " in kw_clean:
                if kw_clean in cleaned_text:
                    return SemanticClassificationResult(
                        category_slug=category_slug,
                        matched_keyword=keyword,
                        confidence=0.85,
                    )
                # Check multi-token inclusion
                kw_toks = set(_tokenize(kw_clean))
                if kw_toks and kw_toks.issubset(tokens):
                    return SemanticClassificationResult(
                        category_slug=category_slug,
                        matched_keyword=keyword,
                        confidence=0.85,
                    )
            elif kw_clean in tokens:
                return SemanticClassificationResult(
                    category_slug=category_slug,
                    matched_keyword=keyword,
                    confidence=0.85,
                )

    # 3. Fuzzy Matching: variations, token-set overlap, typo tolerance (edit dist <= 1)
    for category_slug, keywords in TAXONOMY_PRIORITY:
        for keyword in keywords:
            kw_clean = keyword.upper()
            if " " not in kw_clean and len(kw_clean) >= 4:
                for token in tokens:
                    if len(token) < 4 or token.isdigit():
                        continue
                    # Suffix / stem variation for words >= 5 (e.g. PHARMACIE / PHARMACIES)
                    if min(len(kw_clean), len(token)) >= 5:
                        if (token.startswith(kw_clean) or kw_clean.startswith(token)) and abs(len(token) - len(kw_clean)) <= 3:
                            return SemanticClassificationResult(
                                category_slug=category_slug,
                                matched_keyword=keyword,
                                confidence=0.80,
                            )
                        # Typo tolerance
                        if _is_levenshtein_1(kw_clean, token):
                            return SemanticClassificationResult(
                                category_slug=category_slug,
                                matched_keyword=keyword,
                                confidence=0.80,
                            )
            elif " " in kw_clean:
                kw_toks = set(_tokenize(kw_clean))
                overlap = kw_toks & tokens
                if len(kw_toks) >= 2 and len(overlap) / len(kw_toks) >= 0.67:
                    return SemanticClassificationResult(
                        category_slug=category_slug,
                        matched_keyword=keyword,
                        confidence=0.80,
                    )

    return None


def classify_by_semantic_keywords(raw_payee: str) -> SemanticClassificationResult | None:
    """
    Analyzes raw merchant text and extracts commercial category intent
    based on prioritized semantic business tokens.
    Maintained for backward compatibility.
    """
    return classify_by_semantic_heuristics(raw_payee, amount=None, account_type=None)
