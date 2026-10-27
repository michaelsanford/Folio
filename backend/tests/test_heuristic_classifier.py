import pytest
from app.services.categorization.semantic_classifier import (
    classify_by_semantic_heuristics,
    classify_by_semantic_keywords,
    TAXONOMY_PRIORITY,
)


def test_bilingual_keywords():
    """Verifies that English and French commercial keywords across the 22 categories
    classify into the expected category slugs."""
    test_cases = [
        # Groceries
        ("SUPERMARCHÉ PROVIGO EXPRESS", "groceries"),
        ("EPICERIE FINE DU VILLAGE", "groceries"),
        ("WHOLE FOODS GROCERY STORE", "groceries"),
        # Restaurants
        ("BOUCHERIE ET ROTISSERIE DU COIN", "restaurants"),
        ("TRATTORIA ARTISANAL PIZZERIA", "restaurants"),
        ("BOULANGERIE PATISSERIE DE PARIS", "restaurants"),
        # Coffee Shops
        ("ESPRESSO COFFEE ROASTER NYC", "coffee-shops"),
        ("BRULERIE DE CAFE MONTLOUIS", "coffee-shops"),
        ("TIM HORTONS DOUGHNUT", "coffee-shops"),
        # Fast Food
        ("BURGER KING DRIVE THRU", "fast-food"),
        ("CASSE-CROUTE POUTINE ET FRITES", "fast-food"),
        ("RESTAURATION RAPIDE SANDWICH", "fast-food"),
        # Alcohol & Bars
        ("MICROBRASSERIE ET BRASSERIE ARTISANALE", "alcohol-bars"),
        ("SAQ SELECTION MONTREAL", "alcohol-bars"),
        ("LCBO WINE AND LIQUOR OUTLET", "alcohol-bars"),
        # Fuel
        ("STATION SERVICE ESSENCE CARBURANT", "fuel"),
        ("PETRO-CANADA GAS STATION", "fuel"),
        ("ELECTRIC VEHICLE SUPERCHARGER", "fuel"),
        # Transportation
        ("AUTOROUTE PÉAGE EXPRESSWAY TOLL", "transportation"),
        ("STATIONNEMENT AUTOPARC AEROPORT", "transportation"),
        ("STM CARTE OPUS TRANSIT", "transportation"),
        # Utilities
        ("HYDRO QUEBEC DISTRIBUTION", "utilities"),
        ("PROVINCIAL ELECTRIC POWER PYMT", "utilities"),
        ("VIDEOTRON INTERNET ET FIBRE", "utilities"),
        # Subscriptions
        ("SAAS CLOUD HOSTING ABONNEMENT", "subscriptions"),
        ("VPN STREAMING SUBSCRIPTION RECURRING", "subscriptions"),
        # Travel
        ("AIR CANADA VOL AERIEN BILLET", "travel"),
        ("RESORT HOTEL AND SUITES VACATION", "travel"),
        # Health & Medical
        ("CLINIQUE MEDICALE ET DENTAIRE", "health-medical"),
        ("PHARMACIE JEAN COUTU SANTE", "health-medical"),
        ("EYECARE OPTOMETRIE CLINIC", "health-medical"),
        # Personal Care
        ("SALON DE COIFFURE ET BARBIER", "personal-care"),
        ("SPA BEAUTY AND NAIL SALON", "personal-care"),
        # Shopping
        ("BOUTIQUE MODE VETEMENT", "shopping"),
        ("FASHION OUTLET CLOTHING STORE", "shopping"),
        # Electronics
        ("MAGASIN ORDINATEURS ET INFORMATIQUE", "electronics"),
        ("BEST BUY ELECTRONICS AND GADGETS", "electronics"),
        # Home Improvement
        ("QUINCAILLERIE RONA HOME IMPROVEMENT", "home-improvement"),
        ("HOME DEPOT RENOVATION LUMBER", "home-improvement"),
        # Entertainment
        ("BILLETTERIE SPECTACLES THEATRE", "entertainment"),
        ("CINEMA MOVIE THEATER TICKETS", "entertainment"),
        # Pets
        ("CLINIQUE VETERINAIRE POUR ANIMAUX", "pets"),
        ("PETSMART ANIMAL HOSPITAL FOOD", "pets"),
        # Childcare
        ("GARDERIE CENTRE DE LA PETITE ENFANCE", "childcare"),
        ("PRESCHOOL CHILDCARE EARLY LEARNING", "childcare"),
        # Education
        ("UNIVERSITÉ FRAIS DE SCOLARITÉ", "education"),
        ("COLLEGE TUITION CAMPUS BOOKSTORE", "education"),
        # Insurance
        ("ASSURANCE DESJARDINS HABITATION", "insurance"),
        ("STATE FARM LIFE INSURANCE POLICY", "insurance"),
        # Bank Fees
        ("FRAIS BANCAIRES MENSUELS", "bank-fees"),
        ("MONTHLY OVERDRAFT FEE CHARGE", "bank-fees"),
        # Income / Salary
        ("VERSEMENT SALAIRE PAIE DIRECT", "income-salary"),
        ("EMPLOYMENT INSURANCE WAGES", "income-salary"),
    ]

    for raw_payee, expected_slug in test_cases:
        res = classify_by_semantic_heuristics(raw_payee)
        assert res is not None, f"Failed to classify: {raw_payee}"
        assert res.category_slug == expected_slug, (
            f"Expected {expected_slug} for '{raw_payee}', got {res.category_slug}"
        )


def test_income_inflows():
    """Positive amounts with income signals should classify into income-salary with high confidence."""
    income_cases = [
        ("ACME CORP PAYROLL 2026-08", 2500.0, "income-salary"),
        ("DIRECT DEP CANADA FPT", 320.50, "income-salary"),
        ("EMPLOYMENT INSURANCE EI PYMT", 650.0, "income-salary"),
        ("CANADA CCB CHILD BENEFIT", 450.0, "income-salary"),
        ("PROVINCIAL TAX REFUND", 1250.0, "income-salary"),
        ("DEPOT SALAIRE DIRECT INTERAC", 1850.0, "income-salary"),
        ("VIREMENT VIREMENT INTERAC RECU", 200.0, "income-salary"),
        ("PAIE ACME INC DIRECT DEPOSIT", 3100.0, "income-salary"),
        ("GOV OF CANADA OAS BENEFIT", 700.0, "income-salary"),
    ]

    for raw_payee, amount, expected_slug in income_cases:
        res = classify_by_semantic_heuristics(raw_payee, amount=amount)
        assert res is not None, f"Expected match for {raw_payee}"
        assert res.category_slug == expected_slug
        assert res.confidence >= 0.90


def test_amount_heuristics_negative_bills_and_taxes():
    """Negative amounts matching bill/tax patterns should classify to utilities or bank-fees."""
    bill_cases = [
        ("CRA TAX INSTALLMENT PAYMENT", -450.0, "utilities"),
        ("CITY PROPERTY TAXES INSTALLMENT", -1200.0, "utilities"),
        ("REVENU QUEBEC IMPOT 2026", -320.0, "utilities"),
        ("BILL PMT HYDRO QUEBEC", -110.0, "utilities"),
        ("PAIEMENT FACTURE TELECOM", -85.0, "utilities"),
    ]

    for raw_payee, amount, expected_slug in bill_cases:
        res = classify_by_semantic_heuristics(raw_payee, amount=amount)
        assert res is not None, f"Expected match for {raw_payee}"
        assert res.category_slug == expected_slug
        assert res.confidence >= 0.90

    # Negative fee payments
    fee_cases = [
        ("MONTHLY ACCOUNT SERVICE FEE", -15.95, "bank-fees"),
        ("FRAIS DE SERVICE BANCAIRE", -4.95, "bank-fees"),
        ("NSF SANS PROVISION CHARGE", -48.00, "bank-fees"),
    ]
    for raw_payee, amount, expected_slug in fee_cases:
        res = classify_by_semantic_heuristics(raw_payee, amount=amount)
        assert res is not None, f"Expected match for {raw_payee}"
        assert res.category_slug == expected_slug
        assert res.confidence >= 0.90


def test_fuzzy_matching_and_token_overlap():
    """Tests token-set overlap, noise stripping, plural variations, and edit-distance tolerance."""
    # 1. Noise stripping (store IDs, postal codes, POS prefix)
    res_noise = classify_by_semantic_heuristics("POS PURCHASE #9942 SUPERMARKET MONTREAL QC H2X 1Y4")
    assert res_noise is not None
    assert res_noise.category_slug == "groceries"

    # 2. Plural variations (PHARMACIES -> PHARMACIE, BOULANGERIES -> BOULANGERIE)
    res_plural1 = classify_by_semantic_heuristics("JEAN COUTU PHARMACIES MONTREAL")
    assert res_plural1 is not None
    assert res_plural1.category_slug == "health-medical"

    res_plural2 = classify_by_semantic_heuristics("BOULANGERIES ARTISANALES DU NORD")
    assert res_plural2 is not None
    assert res_plural2.category_slug == "restaurants"

    # 3. Typo tolerance (Levenshtein distance <= 1 for words >= 5 chars)
    res_typo = classify_by_semantic_heuristics("CENTRE CLINIQU MEDICAL")
    assert res_typo is not None
    assert res_typo.category_slug == "health-medical"

    # 4. Multi-token keyword inclusion
    res_multi = classify_by_semantic_heuristics("SHELL GAS & CONVENIENCE STATION")
    assert res_multi is not None
    assert res_multi.category_slug == "fuel"


def test_empty_or_whitespace_input():
    """Empty or None payee should safely return None without throwing."""
    assert classify_by_semantic_heuristics("") is None
    assert classify_by_semantic_heuristics("   ") is None
    assert classify_by_semantic_heuristics(None) is None
    assert classify_by_semantic_keywords("") is None
    assert classify_by_semantic_keywords(None) is None
