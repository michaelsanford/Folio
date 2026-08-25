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
    # Groceries (slug: "groceries")
    {"pattern": "COSTCO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Costco Wholesale", "priority": 5},
    {"pattern": "WALMART", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Walmart", "priority": 5},
    {"pattern": "WAL-MART", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Walmart", "priority": 5},
    {"pattern": "TRADER JOE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Trader Joe's", "priority": 5},
    {"pattern": "WHOLE FOODS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Whole Foods Market", "priority": 5},
    {"pattern": "WHOLEFDS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Whole Foods Market", "priority": 5},
    {"pattern": "SAFEWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Safeway", "priority": 5},
    {"pattern": "KROGER", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Kroger", "priority": 5},
    {"pattern": "ALDI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Aldi", "priority": 5},
    {"pattern": "TARGET", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Target", "priority": 6},
    {"pattern": "LOBLAWS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Loblaws", "priority": 5},
    {"pattern": "NO FRILLS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "No Frills", "priority": 5},
    {"pattern": "METRO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Metro", "priority": 6},
    {"pattern": "SOBEYS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Sobeys", "priority": 5},
    {"pattern": "SUPERSTORE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Real Canadian Superstore", "priority": 5},
    {"pattern": "FARM BOY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Farm Boy", "priority": 5},
    {"pattern": "WEGMANS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Wegmans", "priority": 5},
    {"pattern": "PUBLIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "groceries", "normalized_payee": "Publix", "priority": 5},

    # Restaurants & Dining (slug: "restaurants")
    {"pattern": "MCDONALD", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "McDonald's", "priority": 5},
    {"pattern": "CHIPOTLE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Chipotle Mexican Grill", "priority": 5},
    {"pattern": "UBER EATS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Uber Eats", "priority": 5},
    {"pattern": "UBEREATS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Uber Eats", "priority": 5},
    {"pattern": "DOORDASH", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "DoorDash", "priority": 5},
    {"pattern": "GRUBHUB", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Grubhub", "priority": 5},
    {"pattern": "SKIPTHEDISHES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "SkipTheDishes", "priority": 5},
    {"pattern": "WENDY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Wendy's", "priority": 5},
    {"pattern": "SUBWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Subway", "priority": 5},
    {"pattern": "DOMINO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Domino's Pizza", "priority": 5},
    {"pattern": "PIZZA HUT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Pizza Hut", "priority": 5},
    {"pattern": "TACO BELL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Taco Bell", "priority": 5},
    {"pattern": "BURGER KING", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Burger King", "priority": 5},
    {"pattern": "CHICK-FIL-A", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Chick-fil-A", "priority": 5},
    {"pattern": "PANERA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "restaurants", "normalized_payee": "Panera Bread", "priority": 5},

    # Coffee Shops (slug: "coffee-shops")
    {"pattern": "STARBUCKS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Starbucks", "priority": 5},
    {"pattern": "TIM HORTON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Tim Hortons", "priority": 5},
    {"pattern": "DUNKIN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Dunkin'", "priority": 5},
    {"pattern": "BLUE BOTTLE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Blue Bottle Coffee", "priority": 5},
    {"pattern": "PEET'S", "pattern_type": RulePatternType.CONTAINS, "category_slug": "coffee-shops", "normalized_payee": "Peet's Coffee", "priority": 5},

    # Gas / Fuel (slug: "fuel")
    {"pattern": "SHELL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Shell Oil", "priority": 5},
    {"pattern": "CHEVRON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Chevron", "priority": 5},
    {"pattern": "EXXON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "ExxonMobil", "priority": 5},
    {"pattern": "MOBIL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Mobil", "priority": 5},
    {"pattern": "ESSO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Esso", "priority": 5},
    {"pattern": "PETRO-CANADA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Petro-Canada", "priority": 5},
    {"pattern": "PETROCAN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Petro-Canada", "priority": 5},
    {"pattern": "CIRCLE K", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Circle K", "priority": 5},
    {"pattern": "SPEEDWAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "Speedway", "priority": 5},
    {"pattern": "7-ELEVEN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "7-Eleven", "priority": 6},
    {"pattern": "7 ELEVEN", "pattern_type": RulePatternType.CONTAINS, "category_slug": "fuel", "normalized_payee": "7-Eleven", "priority": 6},

    # Subscriptions & Streaming (slug: "subscriptions")
    {"pattern": "NETFLIX", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Netflix", "priority": 5},
    {"pattern": "SPOTIFY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Spotify", "priority": 5},
    {"pattern": "APPLE.COM/BILL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Apple Services", "priority": 5},
    {"pattern": "ITUNES.COM", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Apple iTunes", "priority": 5},
    {"pattern": "GOOGLE *YOUTUBE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "YouTube Premium", "priority": 5},
    {"pattern": "GOOGLE *STORAGE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Google One Storage", "priority": 5},
    {"pattern": "GOOGLE PLAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Google Play", "priority": 5},
    {"pattern": "DISNEY PLUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Disney+", "priority": 5},
    {"pattern": "DISNEY+", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Disney+", "priority": 5},
    {"pattern": "HULU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Hulu", "priority": 5},
    {"pattern": "HBO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Max (HBO)", "priority": 5},
    {"pattern": "MAX.COM", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Max", "priority": 5},
    {"pattern": "AMZN DIGITAL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Amazon Digital", "priority": 5},
    {"pattern": "AMAZON PRIME", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Amazon Prime", "priority": 5},
    {"pattern": "PRIME VIDEO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Prime Video", "priority": 5},
    {"pattern": "NYTIMES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "New York Times", "priority": 5},
    {"pattern": "GITHUB", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "GitHub", "priority": 5},
    {"pattern": "CHATGPT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "OpenAI / ChatGPT", "priority": 5},
    {"pattern": "OPENAI", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "OpenAI", "priority": 5},
    {"pattern": "MICROSOFT*365", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Microsoft 365", "priority": 5},
    {"pattern": "ADOBE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "subscriptions", "normalized_payee": "Adobe Creative Cloud", "priority": 5},

    # Shopping & Retail (slug: "shopping")
    {"pattern": "AMAZON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Amazon", "priority": 7},
    {"pattern": "AMZN MKT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Amazon Marketplace", "priority": 7},
    {"pattern": "BEST BUY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Best Buy", "priority": 5},
    {"pattern": "BESTBUY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "Best Buy", "priority": 5},
    {"pattern": "HOME DEPOT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "The Home Depot", "priority": 5},
    {"pattern": "LOWES", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Lowe's", "priority": 5},
    {"pattern": "LOWE'S", "pattern_type": RulePatternType.CONTAINS, "category_slug": "home-maintenance", "normalized_payee": "Lowe's", "priority": 5},
    {"pattern": "IKEA", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "IKEA", "priority": 5},
    {"pattern": "EBAY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "shopping", "normalized_payee": "eBay", "priority": 5},

    # Utilities (slug: "utilities")
    {"pattern": "HYDRO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Electric Utility", "priority": 5},
    {"pattern": "ELECTRIC", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Electric Utility", "priority": 6},
    {"pattern": "ENBRIDGE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Enbridge Gas", "priority": 5},
    {"pattern": "WATER", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Water & Sewage Utility", "priority": 7},
    {"pattern": "COMCAST", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Comcast Xfinity", "priority": 5},
    {"pattern": "XFINITY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Xfinity", "priority": 5},
    {"pattern": "VERIZON", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Verizon Wireless", "priority": 5},
    {"pattern": "AT&T", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "AT&T", "priority": 5},
    {"pattern": "T-MOBILE", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "T-Mobile", "priority": 5},
    {"pattern": "ROGERS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Rogers Telecom", "priority": 5},
    {"pattern": "BELL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Bell Canada", "priority": 6},
    {"pattern": "TELUS", "pattern_type": RulePatternType.CONTAINS, "category_slug": "utilities", "normalized_payee": "Telus", "priority": 5},

    # Transportation & Rideshare (slug: "transportation")
    {"pattern": "UBER TRIP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Uber", "priority": 5},
    {"pattern": "UBER *TRIP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Uber", "priority": 5},
    {"pattern": "LYFT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "transportation", "normalized_payee": "Lyft", "priority": 5},

    # Transfers & Payments (slug: "cc-payment")
    {"pattern": "AUTOPAY PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card AutoPay", "priority": 3},
    {"pattern": "PAYMENT - THANK YOU", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card Payment", "priority": 3},
    {"pattern": "ONLINE PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Online Payment", "priority": 4},
    {"pattern": "CREDIT CARD PAYMENT", "pattern_type": RulePatternType.CONTAINS, "category_slug": "cc-payment", "normalized_payee": "Credit Card Payment", "priority": 3},

    # Income & Salary (slug: "salary")
    {"pattern": "DIRECT DEP", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Payroll Direct Deposit", "priority": 3},
    {"pattern": "PAYROLL", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Payroll Deposit", "priority": 3},
    {"pattern": "SALARY", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Salary Payment", "priority": 3},
    {"pattern": "GUSTO", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "Gusto Payroll", "priority": 3},
    {"pattern": "ADP ", "pattern_type": RulePatternType.CONTAINS, "category_slug": "salary", "normalized_payee": "ADP Payroll", "priority": 3},
]


def seed_default_rules(db: Session):
    """Populates default categorization rules if the rules table is empty."""
    if db.query(CategorizationRule).count() > 0:
        return

    # Map category slugs to IDs
    categories = db.query(Category).all()
    slug_map = {cat.slug: cat.id for cat in categories}

    for rule_def in DEFAULT_RULES:
        cat_id = slug_map.get(rule_def["category_slug"])
        if not cat_id:
            continue

        rule = CategorizationRule(
            category_id=cat_id,
            priority=rule_def["priority"],
            pattern_type=rule_def["pattern_type"],
            pattern=rule_def["pattern"],
            normalized_payee_override=rule_def["normalized_payee"],
            is_active=True,
        )
        db.add(rule)

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
