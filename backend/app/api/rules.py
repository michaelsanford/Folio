from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models.rule import CategorizationRule, RulePatternType
from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.schemas.rule import (
    CategorizationRuleCreate,
    CategorizationRuleUpdate,
    CategorizationRuleResponse,
    TestRuleMatchRequest,
    TestRuleMatchResponse,
)
from app.services.categorization.rules_engine import evaluate_rules

router = APIRouter(prefix="/rules", tags=["Categorization Rules"])

DEFAULT_RULES = [
    # --- Health, Medical & Pharmacy (slug: "health-medical") ---
    {"pattern": "JEAN COUTU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Jean Coutu", "priority": 4},
    {"pattern": "JEAN-COUTU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Jean Coutu", "priority": 4},
    {"pattern": "PJC ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Jean Coutu", "priority": 5},
    {"pattern": "PRIVAMED", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Clinique Privamed", "priority": 3},
    {"pattern": "CLINIQUE PRIVAMED", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Clinique Privamed", "priority": 3},
    {"pattern": "PHARMAPRIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Pharmaprix", "priority": 4},
    {"pattern": "SHOPPERS DRUG MART", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Shoppers Drug Mart", "priority": 4},
    {"pattern": "SDM #", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Shoppers Drug Mart", "priority": 5},
    {"pattern": "UNIPRIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Uniprix", "priority": 4},
    {"pattern": "FAMILIPRIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Familiprix", "priority": 4},
    {"pattern": "BRUNET", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Brunet", "priority": 5},
    {"pattern": "CVS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "CVS Pharmacy", "priority": 5},
    {"pattern": "WALGREENS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Walgreens", "priority": 5},
    {"pattern": "CLINIQUE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Medical Clinic", "priority": 8},
    {"pattern": "DENTAIRE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Dental Clinic", "priority": 7},
    {"pattern": "DENTAL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Dental Clinic", "priority": 7},
    {"pattern": "OPTIQUE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Optometry & Eyewear", "priority": 7},
    {"pattern": "OPTOMETRY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Optometry & Eyewear", "priority": 7},
    {"pattern": "BIRON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "Biron Health Diagnostics", "priority": 5},
    {"pattern": "LIFELABS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "health-medical", "normalized_payee": "LifeLabs Diagnostics", "priority": 5},

    # --- Gas & Fuel (slug: "fuel") ---
    {"pattern": "ULTRAMAR", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Ultramar", "priority": 4},
    {"pattern": "COUCHE-TARD", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Couche-Tard", "priority": 5},
    {"pattern": "COUCHE TARD", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Couche-Tard", "priority": 5},
    {"pattern": "CIRCLE K", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Circle K", "priority": 5},
    {"pattern": "HARNOIS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Harnois Énergies", "priority": 5},
    {"pattern": "CANADIAN TIRE GAS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Canadian Tire Gas+", "priority": 4},
    {"pattern": "IRVING", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Irving Oil", "priority": 5},
    {"pattern": "PIONEER", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Pioneer Energy", "priority": 5},
    {"pattern": "PETRO-CANADA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Petro-Canada", "priority": 4},
    {"pattern": "PETROCAN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Petro-Canada", "priority": 4},
    {"pattern": "ESSO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Esso", "priority": 5},
    {"pattern": "SHELL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Shell", "priority": 5},
    {"pattern": "CHEVRON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Chevron", "priority": 5},
    {"pattern": "EXXON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "ExxonMobil", "priority": 5},
    {"pattern": "MOBIL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Mobil", "priority": 5},
    {"pattern": "SPEEDWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Speedway", "priority": 5},
    {"pattern": "7-ELEVEN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "7-Eleven", "priority": 6},
    {"pattern": "7 ELEVEN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "7-Eleven", "priority": 6},

    # --- Restaurants, Fast Food & Dining (slug: "restaurants") ---
    {"pattern": "BOUSTAN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Boustan", "priority": 4},
    {"pattern": "A&W", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "A&W", "priority": 4},
    {"pattern": "A & W", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "A&W", "priority": 4},
    {"pattern": "RAMEN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Ramen Restaurant", "priority": 5},
    {"pattern": "KINTON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Kinton Ramen", "priority": 4},
    {"pattern": "SANTOUKA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Santouka Ramen", "priority": 4},
    {"pattern": "MISHOYA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Ramen Mishoya", "priority": 4},
    {"pattern": "MARUTAMA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Marutama Ramen", "priority": 4},
    {"pattern": "ST-HUBERT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "St-Hubert", "priority": 4},
    {"pattern": "SAINT-HUBERT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "St-Hubert", "priority": 4},
    {"pattern": "BELLE PROVINCE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "La Belle Province", "priority": 5},
    {"pattern": "ASHTON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Chez Ashton", "priority": 4},
    {"pattern": "AMIR", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Restaurant Amir", "priority": 5},
    {"pattern": "BATON ROUGE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Bâton Rouge", "priority": 4},
    {"pattern": "THE KEG", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "The Keg Steakhouse", "priority": 4},
    {"pattern": "KEG STEAKHOUSE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "The Keg Steakhouse", "priority": 4},
    {"pattern": "BOSTON PIZZA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Boston Pizza", "priority": 4},
    {"pattern": "HARVEY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Harvey's", "priority": 5},
    {"pattern": "SWISS CHALET", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Swiss Chalet", "priority": 4},
    {"pattern": "MCDONALD", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "McDonald's", "priority": 4},
    {"pattern": "CHIPOTLE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Chipotle Mexican Grill", "priority": 4},
    {"pattern": "FIVE GUYS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Five Guys", "priority": 4},
    {"pattern": "POPEYE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Popeyes Louisiana Kitchen", "priority": 5},
    {"pattern": "UBER EATS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Uber Eats", "priority": 4},
    {"pattern": "UBEREATS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Uber Eats", "priority": 4},
    {"pattern": "DOORDASH", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "DoorDash", "priority": 4},
    {"pattern": "SKIPTHEDISHES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "SkipTheDishes", "priority": 4},
    {"pattern": "GRUBHUB", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Grubhub", "priority": 4},
    {"pattern": "WENDY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Wendy's", "priority": 5},
    {"pattern": "SUBWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Subway", "priority": 5},
    {"pattern": "DOMINO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Domino's Pizza", "priority": 5},
    {"pattern": "PIZZA HUT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Pizza Hut", "priority": 5},
    {"pattern": "TACO BELL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Taco Bell", "priority": 5},
    {"pattern": "BURGER KING", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Burger King", "priority": 5},
    {"pattern": "CHICK-FIL-A", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Chick-fil-A", "priority": 5},
    {"pattern": "PANERA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Panera Bread", "priority": 5},
    {"pattern": "SUSHI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Sushi Restaurant", "priority": 7},
    {"pattern": "SHAWARMA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Shawarma Restaurant", "priority": 7},
    {"pattern": "PIZZA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Pizzeria", "priority": 8},

    # --- Coffee Shops & Bakeries (slug: "coffee-shops") ---
    {"pattern": "TIM HORTON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Tim Hortons", "priority": 4},
    {"pattern": "TIMS #", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Tim Hortons", "priority": 4},
    {"pattern": "STARBUCKS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Starbucks", "priority": 4},
    {"pattern": "SECOND CUP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Second Cup", "priority": 4},
    {"pattern": "PREMIERE MOISSON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Première Moisson", "priority": 4},
    {"pattern": "VAN HOUTTE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Café Van Houtte", "priority": 4},
    {"pattern": "BLUE BOTTLE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Blue Bottle Coffee", "priority": 4},
    {"pattern": "DUNKIN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Dunkin'", "priority": 4},
    {"pattern": "PEET'S", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Peet's Coffee", "priority": 4},

    # --- Subscriptions, Financial Tools & Tech (slug: "subscriptions") ---
    {"pattern": "TRADINGVIEW", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "TradingView", "priority": 3},
    {"pattern": "TRADING VIEW", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "TradingView", "priority": 3},
    {"pattern": "SEEKING ALPHA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Seeking Alpha", "priority": 3},
    {"pattern": "FINVIZ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Finviz", "priority": 3},
    {"pattern": "BENZINGA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Benzinga", "priority": 3},
    {"pattern": "CHATGPT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "OpenAI / ChatGPT", "priority": 3},
    {"pattern": "OPENAI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "OpenAI", "priority": 3},
    {"pattern": "ANTHROPIC", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Anthropic Claude", "priority": 3},
    {"pattern": "CLAUDE.AI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Anthropic Claude", "priority": 3},
    {"pattern": "MIDJOURNEY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Midjourney", "priority": 3},
    {"pattern": "PERPLEXITY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Perplexity AI", "priority": 3},
    {"pattern": "GITHUB", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "GitHub", "priority": 4},
    {"pattern": "JETBRAINS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "JetBrains", "priority": 4},
    {"pattern": "NETFLIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Netflix", "priority": 4},
    {"pattern": "SPOTIFY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Spotify", "priority": 4},
    {"pattern": "APPLE.COM/BILL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Apple Services", "priority": 4},
    {"pattern": "ITUNES.COM", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Apple iTunes", "priority": 4},
    {"pattern": "GOOGLE *YOUTUBE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "YouTube Premium", "priority": 4},
    {"pattern": "GOOGLE *STORAGE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Google One Storage", "priority": 4},
    {"pattern": "GOOGLE PLAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Google Play", "priority": 5},
    {"pattern": "DISNEY PLUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Disney+", "priority": 4},
    {"pattern": "DISNEY+", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Disney+", "priority": 4},
    {"pattern": "HULU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Hulu", "priority": 4},
    {"pattern": "HBO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Max (HBO)", "priority": 4},
    {"pattern": "MAX.COM", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Max", "priority": 4},
    {"pattern": "AMZN DIGITAL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Amazon Digital", "priority": 4},
    {"pattern": "AMAZON PRIME", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Amazon Prime", "priority": 4},
    {"pattern": "PRIME VIDEO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Prime Video", "priority": 4},
    {"pattern": "NYTIMES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "New York Times", "priority": 4},
    {"pattern": "MICROSOFT*365", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Microsoft 365", "priority": 4},
    {"pattern": "ADOBE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Adobe Creative Cloud", "priority": 4},
    {"pattern": "1PASSWORD", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "1Password", "priority": 4},
    {"pattern": "DROPBOX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Dropbox", "priority": 4},
    {"pattern": "NORDVPN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "NordVPN", "priority": 4},
    {"pattern": "PROTON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Proton Mail / VPN", "priority": 4},

    # --- Groceries & Supermarkets (slug: "groceries") ---
    {"pattern": "IGA ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "IGA", "priority": 4},
    {"pattern": "IGA EXTRA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "IGA Extra", "priority": 4},
    {"pattern": "MAXI ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Maxi", "priority": 4},
    {"pattern": "MAXI & CIE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Maxi & Cie", "priority": 4},
    {"pattern": "SUPER C", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Super C", "priority": 4},
    {"pattern": "METRO ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Metro", "priority": 5},
    {"pattern": "PROVIGO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Provigo", "priority": 4},
    {"pattern": "ADONIS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Marché Adonis", "priority": 4},
    {"pattern": "T&T", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "T&T Supermarket", "priority": 4},
    {"pattern": "COSTCO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Costco Wholesale", "priority": 4},
    {"pattern": "WALMART", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Walmart", "priority": 5},
    {"pattern": "WAL-MART", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Walmart", "priority": 5},
    {"pattern": "TRADER JOE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Trader Joe's", "priority": 4},
    {"pattern": "WHOLE FOODS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Whole Foods Market", "priority": 4},
    {"pattern": "WHOLEFDS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Whole Foods Market", "priority": 4},
    {"pattern": "LOBLAWS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Loblaws", "priority": 4},
    {"pattern": "NO FRILLS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "No Frills", "priority": 4},
    {"pattern": "SOBEYS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Sobeys", "priority": 4},
    {"pattern": "SUPERSTORE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Real Canadian Superstore", "priority": 4},
    {"pattern": "FARM BOY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Farm Boy", "priority": 4},
    {"pattern": "SAFEWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Safeway", "priority": 5},
    {"pattern": "KROGER", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Kroger", "priority": 5},
    {"pattern": "ALDI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Aldi", "priority": 5},
    {"pattern": "TARGET", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Target", "priority": 6},
    {"pattern": "WEGMANS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Wegmans", "priority": 5},
    {"pattern": "PUBLIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Publix", "priority": 5},

    # --- Shopping, Hardware & Retail (slug: "shopping" / "home-maintenance") ---
    {"pattern": "CANADIAN TIRE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Canadian Tire", "priority": 5},
    {"pattern": "CAN TIRE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Canadian Tire", "priority": 5},
    {"pattern": "RONA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "RONA", "priority": 4},
    {"pattern": "RENO-DEPOT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Réno-Dépôt", "priority": 4},
    {"pattern": "RENO DEPOT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Réno-Dépôt", "priority": 4},
    {"pattern": "HOME HARDWARE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Home Hardware", "priority": 4},
    {"pattern": "HOME DEPOT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "The Home Depot", "priority": 4},
    {"pattern": "LOWES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Lowe's", "priority": 4},
    {"pattern": "LOWE'S", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Lowe's", "priority": 4},
    {"pattern": "IKEA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "IKEA", "priority": 4},
    {"pattern": "DOLLARAMA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Dollarama", "priority": 4},
    {"pattern": "DOLLAR TREE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Dollar Tree", "priority": 4},
    {"pattern": "SAQ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Société des alcools du Québec (SAQ)", "priority": 4},
    {"pattern": "LCBO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "LCBO", "priority": 4},
    {"pattern": "WINNERS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Winners", "priority": 4},
    {"pattern": "HOMESENSE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "HomeSense", "priority": 4},
    {"pattern": "MARSHALLS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Marshalls", "priority": 4},
    {"pattern": "SIMONS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "La Maison Simons", "priority": 4},
    {"pattern": "INDIGO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Indigo Books & Music", "priority": 4},
    {"pattern": "AMAZON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Amazon", "priority": 7},
    {"pattern": "AMZN MKT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Amazon Marketplace", "priority": 7},
    {"pattern": "BEST BUY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Best Buy", "priority": 4},
    {"pattern": "BESTBUY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Best Buy", "priority": 4},
    {"pattern": "EBAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "eBay", "priority": 5},

    # --- Utilities & Telecom (slug: "utilities") ---
    {"pattern": "HYDRO-QUEBEC", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Hydro-Québec", "priority": 3},
    {"pattern": "HYDRO QUEBEC", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Hydro-Québec", "priority": 3},
    {"pattern": "HYDRO ONE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Hydro One", "priority": 3},
    {"pattern": "TORONTO HYDRO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Toronto Hydro", "priority": 3},
    {"pattern": "BC HYDRO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "BC Hydro", "priority": 3},
    {"pattern": "ENERGIR", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Énergir", "priority": 3},
    {"pattern": "GAZ METRO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Énergir Gaz", "priority": 3},
    {"pattern": "ENBRIDGE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Enbridge Gas", "priority": 3},
    {"pattern": "VIDEOTRON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Vidéotron", "priority": 3},
    {"pattern": "VIDÉOTRON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Vidéotron", "priority": 3},
    {"pattern": "FIZZ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Fizz Mobile & Internet", "priority": 4},
    {"pattern": "BELL MOBILITY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Bell Mobility", "priority": 3},
    {"pattern": "BELL CANADA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Bell Canada", "priority": 3},
    {"pattern": "TELUS MOBILITY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Telus Mobility", "priority": 3},
    {"pattern": "TELUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Telus", "priority": 4},
    {"pattern": "ROGERS WIRELESS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Rogers Wireless", "priority": 3},
    {"pattern": "ROGERS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Rogers", "priority": 4},
    {"pattern": "FIDO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Fido", "priority": 4},
    {"pattern": "KOODO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Koodo Mobile", "priority": 4},
    {"pattern": "VIRGIN PLUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Virgin Plus", "priority": 4},
    {"pattern": "COMCAST", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Comcast Xfinity", "priority": 4},
    {"pattern": "XFINITY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Xfinity", "priority": 4},
    {"pattern": "VERIZON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Verizon Wireless", "priority": 4},
    {"pattern": "AT&T", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "AT&T", "priority": 4},
    {"pattern": "T-MOBILE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "T-Mobile", "priority": 4},
    {"pattern": "WATER", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Water Utility", "priority": 8},

    # --- Transportation, Transit & Rideshare (slug: "transportation") ---
    {"pattern": "STM ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "STM Transit Montréal", "priority": 4},
    {"pattern": "OPUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Carte OPUS Transit", "priority": 4},
    {"pattern": "TTC ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "TTC Transit Toronto", "priority": 4},
    {"pattern": "PRESTO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Presto Transit Card", "priority": 4},
    {"pattern": "COMMUNAUTO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Communauto", "priority": 4},
    {"pattern": "BIXI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "BIXI Montréal", "priority": 4},
    {"pattern": "UBER TRIP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Uber Rides", "priority": 4},
    {"pattern": "UBER *TRIP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Uber Rides", "priority": 4},
    {"pattern": "LYFT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Lyft", "priority": 4},

    # --- Transfers & Payments (slug: "cc-payment") ---
    {"pattern": "AUTOPAY PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card AutoPay", "priority": 3},
    {"pattern": "PAYMENT - THANK YOU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card Payment", "priority": 3},
    {"pattern": "ONLINE PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Online Payment", "priority": 4},
    {"pattern": "CREDIT CARD PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card Payment", "priority": 3},

    # --- Income & Salary (slug: "salary") ---
    {"pattern": "DIRECT DEP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Payroll Direct Deposit", "priority": 3},
    {"pattern": "PAYROLL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Payroll Deposit", "priority": 3},
    {"pattern": "SALARY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Salary Payment", "priority": 3},
    {"pattern": "GUSTO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Gusto Payroll", "priority": 3},
    {"pattern": "ADP ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "ADP Payroll", "priority": 3},
]


def seed_default_rules(db: Session):
    """Populates default categorization rules, adding any missing rules incrementally."""
    categories = db.query(Category).all()
    slug_map = {cat.slug: cat.id for cat in categories}

    existing_patterns = {r.pattern.upper() for r in db.query(CategorizationRule).all()}

    new_rules = []
    for rule_def in DEFAULT_RULES:
        if rule_def["pattern"].upper() in existing_patterns:
            continue

        cat_id = slug_map.get(rule_def["category_slug"])
        if not cat_id:
            continue

        new_rules.append(
            CategorizationRule(
                category_id=cat_id,
                priority=rule_def["priority"],
                pattern_type=rule_def["pattern_type"],
                pattern=rule_def["pattern"],
                normalized_payee_override=rule_def["normalized_payee"],
                is_active=True,
            )
        )

    if new_rules:
        db.add_all(new_rules)
        db.commit()


@router.get("", response_model=list[CategorizationRuleResponse])
def list_rules(db: Session = Depends(get_db)):
    seed_default_rules(db)
    return (
        db.query(CategorizationRule)
        .options(joinedload(CategorizationRule.category))
        .order_by(CategorizationRule.priority.asc(), CategorizationRule.created_at.desc())
        .all()
    )


@router.post("", response_model=CategorizationRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(rule_in: CategorizationRuleCreate, db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == rule_in.category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    rule = CategorizationRule(**rule_in.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CategorizationRuleResponse)
def update_rule(rule_id: str, rule_in: CategorizationRuleUpdate, db: Session = Depends(get_db)):
    rule = db.query(CategorizationRule).filter(CategorizationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = rule_in.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(rule, field, val)

    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(CategorizationRule).filter(CategorizationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    db.delete(rule)
    db.commit()
    return None


@router.post("/test", response_model=TestRuleMatchResponse)
def test_rule_match(req: TestRuleMatchRequest, db: Session = Depends(get_db)):
    seed_default_rules(db)
    match_result = evaluate_rules(db, req.raw_payee, req.amount, req.account_id)
    if not match_result.matched:
        return TestRuleMatchResponse(matched=False)

    rule = db.query(CategorizationRule).filter(CategorizationRule.id == match_result.rule_id).first()
    rule_resp = CategorizationRuleResponse.model_validate(rule) if rule else None

    return TestRuleMatchResponse(
        matched=True,
        matched_rule=rule_resp,
        suggested_category_id=match_result.category_id,
        suggested_payee=match_result.normalized_payee,
    )


@router.post("/apply-batch", status_code=status.HTTP_200_OK)
def apply_rules_batch(db: Session = Depends(get_db)):
    """
    Applies active categorization rules to all uncategorized transactions.
    """
    seed_default_rules(db)
    uncategorized_txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.splits))
        .all()
    )

    applied_count = 0
    for txn in uncategorized_txns:
        # Check if uncategorized
        is_uncategorized = not txn.splits or all(s.category_id is None for s in txn.splits)
        if not is_uncategorized:
            continue

        match = evaluate_rules(db, txn.raw_payee, txn.amount, txn.account_id)
        if match.matched:
            if match.normalized_payee:
                txn.normalized_payee = match.normalized_payee

            if txn.splits:
                txn.splits[0].category_id = match.category_id
            else:
                txn.splits.append(TransactionSplit(category_id=match.category_id, amount=txn.amount))

            applied_count += 1

    if applied_count > 0:
        db.commit()

    return {"applied_count": applied_count}
