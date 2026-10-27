import hashlib
import uuid
from datetime import date, datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.money import to_cents
from app.models.account import Account, AccountType, LoanCompounding
from app.models.budget import Budget, BudgetItem
from app.models.category import Category, CategoryType
from app.models.goal import Goal, GoalType
from app.models.household import HouseholdMember
from app.models.investment import AssetClass, Holding, Lot, PriceQuote, Security
from app.models.rule import CategorizationRule
from app.models.snapshot import AccountBalanceSnapshot
from app.models.transaction import Transaction, TransactionSplit, TransactionStatus
from app.api.categories import seed_default_categories
from app.api.rules import seed_default_rules
from app.api.transactions import recalculate_account_balance
from app.services.snapshots.balance_history import backfill_all


def _make_hash(account_id: str, dt: datetime, amount_cents: int, payee: str) -> str:
    raw = f"{account_id}|{dt.isoformat()}|{amount_cents}|{payee}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def seed_canadian_demo_dataset(db: Session, force: bool = False) -> dict:
    """
    Populates a rich, realistic Canadian household dataset with:
    - 2 Household Members (Michael & Sarah)
    - 7 Canadian Accounts (Chequing, HISA, TFSA, RRSP, Visa, Mortgage, Auto Loan)
    - 2 Canadian Goals (6-Month Emergency Cushion, 2026 TFSA Max)
    - Canadian TSX Securities, Holdings & Bank of Canada FX quotes
    - Current month budgets with category envelopes & rollovers
    - ~65 realistic ledger entries spanning the past 90 days with proper splits,
      paired transfers, household attribution, and category links.
    - Historical balance snapshots for net worth progression charts.
    """
    # 1. Ensure categories and rules are seeded
    seed_default_categories(db)
    seed_default_rules(db)

    cat_map = {c.slug: c for c in db.query(Category).all()}

    # Check existing transaction count
    existing_txns = db.query(Transaction).count()
    if existing_txns > 0 and not force:
        return {
            "message": "Demo transactions already exist. Pass force=True to reset.",
            "accounts_count": db.query(Account).count(),
            "transactions_count": existing_txns,
            "categories_count": db.query(Category).count(),
            "rules_count": db.query(CategorizationRule).count(),
            "goals_count": db.query(Goal).count(),
            "household_members_count": db.query(HouseholdMember).count(),
            "snapshots_count": db.query(AccountBalanceSnapshot).count(),
        }

    if force:
        # Clear existing data in child -> parent order
        db.query(TransactionSplit).delete()
        db.query(Transaction).delete()
        db.query(AccountBalanceSnapshot).delete()
        db.query(BudgetItem).delete()
        db.query(Budget).delete()
        db.query(Lot).delete()
        db.query(Holding).delete()
        db.query(PriceQuote).delete()
        db.query(Security).delete()
        db.query(Goal).delete()
        db.query(Account).delete()
        db.query(HouseholdMember).delete()
        db.commit()

    now = datetime.now(timezone.utc)
    today = now.date()

    # 2. Household Members
    members = {m.name: m for m in db.query(HouseholdMember).all()}
    if "Michael" not in members:
        m1 = HouseholdMember(name="Michael", role="Self", color="#3B82F6", notes="Primary earner")
        db.add(m1)
        members["Michael"] = m1
    if "Sarah" not in members:
        m2 = HouseholdMember(name="Sarah", role="Partner", color="#10B981", notes="Partner / Spouse")
        db.add(m2)
        members["Sarah"] = m2
    db.flush()

    m_michael = members["Michael"]
    m_sarah = members["Sarah"]

    # 3. Accounts
    accs = {a.name: a for a in db.query(Account).all()}
    
    # Joint Chequing (RBC)
    if "Joint Chequing" not in accs:
        acc = Account(
            name="Joint Chequing",
            type=AccountType.CHECKING,
            institution="RBC",
            account_number_mask="*1234",
            currency="CAD",
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Joint Chequing"] = acc

    # Emergency HISA (EQ Bank)
    if "Emergency HISA" not in accs:
        acc = Account(
            name="Emergency HISA",
            type=AccountType.HISA,
            institution="EQ Bank",
            account_number_mask="*7711",
            currency="CAD",
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Emergency HISA"] = acc

    # Michael's TFSA (Wealthsimple)
    if "Michael's TFSA" not in accs:
        acc = Account(
            name="Michael's TFSA",
            type=AccountType.TFSA,
            institution="Wealthsimple",
            account_number_mask="*5566",
            currency="CAD",
            owner_member_id=m_michael.id,
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Michael's TFSA"] = acc

    # Sarah's RRSP (TD Direct)
    if "Sarah's RRSP" not in accs:
        acc = Account(
            name="Sarah's RRSP",
            type=AccountType.RRSP,
            institution="TD Direct",
            account_number_mask="*3344",
            currency="CAD",
            owner_member_id=m_sarah.id,
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Sarah's RRSP"] = acc

    # Visa Infinite (RBC)
    if "Visa Infinite" not in accs:
        acc = Account(
            name="Visa Infinite",
            type=AccountType.CREDIT_CARD,
            institution="RBC",
            account_number_mask="*8888",
            currency="CAD",
            credit_limit_cents=to_cents(15000.0),
            interest_rate=20.99,
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Visa Infinite"] = acc

    # Home Mortgage (Desjardins)
    if "Home Mortgage" not in accs:
        acc = Account(
            name="Home Mortgage",
            type=AccountType.MORTGAGE,
            institution="Desjardins",
            account_number_mask="*4567",
            currency="CAD",
            loan_original_principal_cents=to_cents(400000.0),
            interest_rate=4.79,
            loan_term_months=300,
            monthly_payment_cents=to_cents(2278.0),
            escrow_payment_cents=to_cents(375.0),
            compounding=LoanCompounding.SEMI_ANNUAL,
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Home Mortgage"] = acc

    # Vehicle Loan (Toyota Financial)
    if "Vehicle Loan" not in accs:
        acc = Account(
            name="Vehicle Loan",
            type=AccountType.VEHICLE_LOAN,
            institution="Toyota Financial",
            account_number_mask="*9012",
            currency="CAD",
            loan_original_principal_cents=to_cents(32000.0),
            interest_rate=4.99,
            loan_term_months=60,
            monthly_payment_cents=to_cents(603.82),
            escrow_payment_cents=0,
            compounding=LoanCompounding.MONTHLY,
            current_balance_cents=0,
        )
        db.add(acc)
        accs["Vehicle Loan"] = acc

    db.flush()

    chequing = accs["Joint Chequing"]
    hisa = accs["Emergency HISA"]
    tfsa = accs["Michael's TFSA"]
    rrsp = accs["Sarah's RRSP"]
    visa = accs["Visa Infinite"]
    mortgage = accs["Home Mortgage"]
    car_loan = accs["Vehicle Loan"]

    # 4. Canadian Goals
    existing_goals = {g.name: g for g in db.query(Goal).all()}
    if "6-Month Emergency Cushion" not in existing_goals:
        db.add(
            Goal(
                name="6-Month Emergency Cushion",
                type=GoalType.EMERGENCY_FUND,
                target_amount_cents=to_cents(25000.0),
                current_amount_cents=to_cents(15000.0),
                emergency_fund_months=6,
                linked_account_id=hisa.id,
                notes="Liquid cash cushion in EQ Bank HISA",
            )
        )
    if "Michael 2026 TFSA Max" not in existing_goals:
        db.add(
            Goal(
                name="Michael 2026 TFSA Max",
                type=GoalType.TFSA_ANNUAL,
                target_amount_cents=to_cents(7000.0),
                current_amount_cents=to_cents(3500.0),
                linked_account_id=tfsa.id,
                owner_member_id=m_michael.id,
                notes="Annual CRA statutory allowance tracking",
            )
        )
    db.flush()

    # 5. Canadian Investments & Securities (TSX)
    sec_map = {s.symbol: s for s in db.query(Security).all()}
    sec_defs = [
        ("VFV.TO", "Vanguard S&P 500 Index ETF", "TSX", "CAD", AssetClass.ETF, 142.50),
        ("XEQT.TO", "iShares Core Equity ETF Portfolio", "TSX", "CAD", AssetClass.ETF, 34.20),
        ("CASH.TO", "Global X High Interest Savings ETF", "TSX", "CAD", AssetClass.ETF, 50.05),
    ]
    for sym, name, exch, curr, aclass, price in sec_defs:
        sec = sec_map.get(sym)
        if not sec:
            sec = Security(symbol=sym, name=name, exchange=exch, currency=curr, asset_class=aclass)
            db.add(sec)
            db.flush()
            sec_map[sym] = sec

        # Add price quote for today
        quote = db.query(PriceQuote).filter(PriceQuote.security_id == sec.id, PriceQuote.as_of_date == today).first()
        if not quote:
            db.add(PriceQuote(security_id=sec.id, as_of_date=today, price_cents=to_cents(price)))

    # Holdings & Lots
    vfv = sec_map["VFV.TO"]
    cash_etf = sec_map["CASH.TO"]
    xeqt = sec_map["XEQT.TO"]

    # TFSA Holdings (Michael)
    h_vfv = db.query(Holding).filter(Holding.account_id == tfsa.id, Holding.security_id == vfv.id).first()
    if not h_vfv:
        h_vfv = Holding(account_id=tfsa.id, security_id=vfv.id)
        db.add(h_vfv)
        db.flush()
        db.add(Lot(holding_id=h_vfv.id, trade_date=today - timedelta(days=60), quantity=120, cost_basis_cents=to_cents(15600.0)))

    h_cash = db.query(Holding).filter(Holding.account_id == tfsa.id, Holding.security_id == cash_etf.id).first()
    if not h_cash:
        h_cash = Holding(account_id=tfsa.id, security_id=cash_etf.id)
        db.add(h_cash)
        db.flush()
        db.add(Lot(holding_id=h_cash.id, trade_date=today - timedelta(days=45), quantity=140, cost_basis_cents=to_cents(7007.0)))

    # RRSP Holdings (Sarah)
    h_xeqt = db.query(Holding).filter(Holding.account_id == rrsp.id, Holding.security_id == xeqt.id).first()
    if not h_xeqt:
        h_xeqt = Holding(account_id=rrsp.id, security_id=xeqt.id)
        db.add(h_xeqt)
        db.flush()
        db.add(Lot(holding_id=h_xeqt.id, trade_date=today - timedelta(days=75), quantity=1110, cost_basis_cents=to_cents(35500.0)))

    # 6. Budgets (Current Month)
    cur_year = today.year
    cur_month = today.month
    budget = db.query(Budget).filter(Budget.year == cur_year, Budget.month == cur_month).first()
    if not budget:
        budget = Budget(
            year=cur_year,
            month=cur_month,
            total_income_target_cents=to_cents(5750.0),
            total_expense_target_cents=to_cents(4850.0),
            notes="Household Monthly Operating Budget",
        )
        db.add(budget)
        db.flush()

        budget_envelope_defs = [
            ("groceries", 950.0, 0.0),
            ("restaurants", 350.0, 45.0),
            ("coffee-shops", 75.0, 0.0),
            ("fast-food", 80.0, 0.0),
            ("utilities", 240.0, 0.0),
            ("telecom", 135.0, 0.0),
            ("fuel", 260.0, 0.0),
            ("transportation", 120.0, 0.0),
            ("auto-insurance", 185.0, 0.0),
            ("home-maintenance", 150.0, 100.0),
            ("shopping", 200.0, -35.0),
            ("subscriptions", 50.0, 0.0),
            ("childcare", 420.0, 0.0),
            ("pets", 75.0, 20.0),
            ("health-medical", 80.0, 0.0),
        ]
        for slug, planned, rollover in budget_envelope_defs:
            cat = cat_map.get(slug)
            if cat:
                db.add(
                    BudgetItem(
                        budget_id=budget.id,
                        category_id=cat.id,
                        planned_amount_cents=to_cents(planned),
                        rollover_amount_cents=to_cents(rollover),
                    )
                )

    # 7. Rich 90-Day Ledger Entries
    txns_to_add: list[Transaction] = []

    def add_txn(
        acc: Account,
        days_ago: int,
        raw_payee: str,
        norm_payee: str,
        amount: float,
        cat_slug: str | None = None,
        member: HouseholdMember | None = None,
        notes: str | None = None,
        splits: list[tuple[str, float]] | None = None,
    ) -> Transaction:
        dt = now - timedelta(days=days_ago)
        amt_cents = to_cents(amount)
        t = Transaction(
            account_id=acc.id,
            transaction_date=dt,
            posted_date=dt,
            raw_payee=raw_payee,
            normalized_payee=norm_payee,
            amount_cents=amt_cents,
            currency="CAD",
            import_hash=_make_hash(acc.id, dt, amt_cents, raw_payee),
            status=TransactionStatus.CLEARED,
            assigned_member_id=member.id if member else None,
            notes=notes,
        )
        if splits:
            for s_slug, s_amt in splits:
                s_cat = cat_map.get(s_slug)
                t.splits.append(
                    TransactionSplit(
                        category_id=s_cat.id if s_cat else None,
                        amount_cents=to_cents(s_amt),
                    )
                )
        else:
            cat = cat_map.get(cat_slug) if cat_slug else None
            t.splits.append(
                TransactionSplit(
                    category_id=cat.id if cat else None,
                    amount_cents=amt_cents,
                )
            )
        txns_to_add.append(t)
        return t

    # Helper for paired transfers
    def add_transfer(
        from_acc: Account,
        to_acc: Account,
        days_ago: int,
        amount: float,
        desc: str,
        cat_slug: str = "internal-transfer",
    ):
        dt = now - timedelta(days=days_ago)
        amt_cents = to_cents(amount)
        cat = cat_map.get(cat_slug)
        cat_id = cat.id if cat else None

        t_out = Transaction(
            account_id=from_acc.id,
            transaction_date=dt,
            posted_date=dt,
            raw_payee=f"Transfer to {to_acc.name}",
            normalized_payee=desc,
            amount_cents=-amt_cents,
            currency="CAD",
            import_hash=_make_hash(from_acc.id, dt, -amt_cents, f"OUT-{desc}"),
            status=TransactionStatus.CLEARED,
        )
        t_out.splits.append(TransactionSplit(category_id=cat_id, amount_cents=-amt_cents))

        t_in = Transaction(
            account_id=to_acc.id,
            transaction_date=dt,
            posted_date=dt,
            raw_payee=f"Transfer from {from_acc.name}",
            normalized_payee=desc,
            amount_cents=amt_cents,
            currency="CAD",
            import_hash=_make_hash(to_acc.id, dt, amt_cents, f"IN-{desc}"),
            status=TransactionStatus.CLEARED,
        )
        t_in.splits.append(TransactionSplit(category_id=cat_id, amount_cents=amt_cents))

        # Cross-link transfer pair
        t_out.transfer_pair = t_in
        t_in.transfer_pair = t_out

        txns_to_add.extend([t_out, t_in])

    # A. Initial Opening Balances at Day -90
    add_txn(chequing, 90, "OPENING BALANCE", "Opening Balance", 4500.0, None, None, "Starting ledger balance")
    add_txn(hisa, 90, "OPENING BALANCE", "Opening Balance", 13500.0, None, None, "Starting HISA savings balance")
    add_txn(tfsa, 90, "OPENING BALANCE", "Opening Balance", 23000.0, None, m_michael, "Starting TFSA balance")
    add_txn(rrsp, 90, "OPENING BALANCE", "Opening Balance", 36700.0, None, m_sarah, "Starting RRSP balance")
    add_txn(visa, 90, "OPENING BALANCE", "Opening Balance", -650.0, None, None, "Starting credit card balance")
    add_txn(mortgage, 90, "OPENING BALANCE", "Opening Balance", -383450.0, None, None, "Mortgage principal starting balance")
    add_txn(car_loan, 90, "OPENING BALANCE", "Opening Balance", -26011.46, None, None, "Auto loan starting balance")

    # B. Bi-weekly Payroll deposits (every 14 days)
    for days_ago in [84, 70, 56, 42, 28, 14, 0]:
        add_txn(chequing, days_ago, "ADP / ACME TECH PAYROLL", "Acme Tech Payroll", 2850.0, "salary", m_michael)
        add_txn(chequing, days_ago, "HEALTHCARE SYSTEM PAYROLL", "Healthcare Payroll", 2420.0, "salary", m_sarah)

    # C. Monthly Government Benefits (CCB on the 20th, GST credit)
    for days_ago in [70, 40, 10]:
        add_txn(chequing, days_ago, "CANADA RYC / CHILD BENEFIT CCB", "Canada Child Benefit (CCB)", 480.0, "government-benefits")
    add_txn(chequing, 25, "CANADA PRO / GST HST CREDIT", "CRA GST/HST Credit", 260.0, "government-benefits")

    # D. Monthly Mortgage Payments with Principal/Interest/Escrow Splits
    for days_ago in [65, 35, 5]:
        add_txn(
            chequing,
            days_ago,
            "DESJARDINS PRÊT HYPOTHÉCAIRE #4567",
            "Desjardins Mortgage",
            -2278.0,
            splits=[
                ("mortgage-principal", -1150.0),
                ("mortgage-interest", -753.0),
                ("escrow", -375.0),
            ],
            notes="Monthly fixed mortgage payment",
        )
        # Principal paydown in mortgage account
        add_txn(mortgage, days_ago, "PRÊT HYPOTHÉCAIRE PAIEMENT CAPITAL", "Mortgage Principal Payment", 1150.0, "mortgage-principal")

    # E. Monthly Vehicle Loan Payments with Principal/Interest Splits
    for days_ago in [68, 38, 8]:
        add_txn(
            chequing,
            days_ago,
            "TOYOTA FINANCIAL AUTO PAYMENT",
            "Toyota Financial",
            -603.82,
            splits=[
                ("vehicle-loan-principal", -503.82),
                ("vehicle-loan-interest", -100.0),
            ],
            notes="Monthly auto financing payment",
        )
        # Principal paydown in vehicle loan account
        add_txn(car_loan, days_ago, "TOYOTA FINANCIAL CAPITAL", "Auto Loan Principal Paydown", 503.82, "vehicle-loan-principal")

    # F. Monthly Household Operating Bills from Chequing
    for days_ago in [72, 42, 12]:
        add_txn(chequing, days_ago, "HYDRO-QUÉBEC PRELEVEMENT AUTO", "Hydro-Québec", -142.80, "utilities")
        add_txn(chequing, days_ago + 3, "BELL CANADA FIBE INTERNET & TEL", "Bell Canada", -135.00, "telecom")
        add_txn(chequing, days_ago + 6, "ENBRIDGE GAS HEATING", "Enbridge Gas", -88.50, "utilities")
        add_txn(chequing, days_ago - 10, "CPE LES PETITS AMIS GARDERIE", "CPE Daycare", -420.00, "childcare")
        add_txn(chequing, days_ago + 8, "INTACT ASSURANCE AUTO", "Intact Insurance", -185.00, "auto-insurance")

    # G. Monthly Paired Transfers
    # Chequing -> Emergency HISA ($500/mo)
    for days_ago in [67, 37, 7]:
        add_transfer(chequing, hisa, days_ago, 500.0, "Monthly Emergency Savings Transfer", "internal-transfer")

    # Chequing -> Michael's TFSA ($500/mo)
    for days_ago in [70, 42, 14]:
        add_transfer(chequing, tfsa, days_ago, 500.0, "TFSA Automated Contribution", "internal-transfer")

    # Chequing -> Sarah's RRSP ($500/mo)
    for days_ago in [84, 56, 28]:
        add_transfer(chequing, rrsp, days_ago, 500.0, "RRSP Monthly Contribution", "internal-transfer")

    # Chequing -> Visa Infinite (Credit Card Payoff, $1450/mo)
    for days_ago in [70, 40, 10]:
        add_transfer(chequing, visa, days_ago, 1450.0, "Credit Card AutoPay Payment", "cc-payment")

    # H. Credit Card Expenses on Visa Infinite
    card_txns = [
        # Groceries
        (83, "METRO PLUS #224", "Metro", -142.50, "groceries", m_sarah),
        (76, "LOBLAWS SUPERSTORE #102", "Loblaws", -195.40, "groceries", m_michael),
        (69, "COSTCO WHOLESALE #541", "Costco", -248.60, "groceries", None),
        (62, "MARCHE ADONIS", "Marché Adonis", -78.30, "groceries", m_sarah),
        (55, "SUPER C #311", "Super C", -112.40, "groceries", m_michael),
        (48, "METRO PLUS #224", "Metro", -164.20, "groceries", m_sarah),
        (41, "LOBLAWS SUPERSTORE #102", "Loblaws", -188.10, "groceries", m_michael),
        (34, "FARM BOY #44", "Farm Boy", -92.50, "groceries", m_sarah),
        (27, "COSTCO WHOLESALE #541", "Costco", -265.80, "groceries", None),
        (20, "MAXI #8812", "Maxi", -135.40, "groceries", m_michael),
        (13, "METRO PLUS #224", "Metro", -156.80, "groceries", m_sarah),
        (6, "LOBLAWS SUPERSTORE #102", "Loblaws", -174.20, "groceries", m_michael),
        (2, "MARCHE ADONIS", "Marché Adonis", -84.90, "groceries", m_sarah),

        # Fuel
        (80, "PETRO-CANADA #1822", "Petro-Canada", -72.40, "fuel", m_michael),
        (66, "ESSO EXPRESS", "Esso", -68.10, "fuel", m_sarah),
        (52, "SHELL CANADA #401", "Shell", -74.50, "fuel", m_michael),
        (38, "PETRO-CANADA #1822", "Petro-Canada", -76.80, "fuel", m_sarah),
        (24, "ESSO EXPRESS", "Esso", -70.20, "fuel", m_michael),
        (10, "PETRO-CANADA #1822", "Petro-Canada", -75.00, "fuel", m_sarah),
        (3, "SHELL CANADA #401", "Shell", -71.80, "fuel", m_michael),

        # Public Transit
        (75, "OPUS CARTE MENSUELLE", "Carte OPUS", -97.00, "transportation", m_sarah),
        (45, "OPUS CARTE MENSUELLE", "Carte OPUS", -97.00, "transportation", m_sarah),
        (15, "OPUS CARTE MENSUELLE", "Carte OPUS", -97.00, "transportation", m_sarah),
        (22, "UBER TRIP CAD", "Uber", -28.50, "transportation", m_michael),

        # Coffee & Fast Food
        (82, "TIM HORTONS #4122", "Tim Hortons", -5.45, "coffee-shops", m_michael),
        (71, "STARBUCKS #18241", "Starbucks", -7.85, "coffee-shops", m_sarah),
        (64, "MCDONALD'S RESTAURANT", "McDonald's", -19.40, "fast-food", None),
        (53, "TIM HORTONS #4122", "Tim Hortons", -6.20, "coffee-shops", m_michael),
        (46, "A&W CANADA #204", "A&W", -22.50, "fast-food", None),
        (32, "STARBUCKS #18241", "Starbucks", -8.20, "coffee-shops", m_sarah),
        (25, "TIM HORTONS #4122", "Tim Hortons", -5.75, "coffee-shops", m_michael),
        (18, "SUBWAY SANDWICH", "Subway", -16.80, "fast-food", m_michael),
        (9, "STARBUCKS #18241", "Starbucks", -7.65, "coffee-shops", m_sarah),
        (4, "TIM HORTONS #4122", "Tim Hortons", -5.50, "coffee-shops", m_michael),

        # Restaurants & Dining
        (73, "RESTAURANT LE BISTRO", "Le Bistro", -94.50, "restaurants", None),
        (58, "PIZZERIA NO. 900", "Pizzeria No. 900", -56.00, "restaurants", m_sarah),
        (44, "RESTAURANT LA BRASSERIE", "La Brasserie", -112.00, "restaurants", None),
        (30, "SUSHI EXPRESS", "Sushi Express", -64.50, "restaurants", m_michael),
        (16, "RESTAURANT LE BISTRO", "Le Bistro", -88.00, "restaurants", None),
        (5, "PIZZERIA NO. 900", "Pizzeria No. 900", -52.00, "restaurants", m_sarah),

        # Alcohol & Bars
        (78, "SAQ SELECTION #312", "SAQ", -58.25, "alcohol-bars", None),
        (49, "LCBO #0412", "LCBO", -46.50, "alcohol-bars", None),
        (21, "SAQ SELECTION #312", "SAQ", -64.00, "alcohol-bars", None),

        # Family, Pets & Pharmacy
        (65, "PET VALU #610", "Pet Valu", -54.20, "pets", None),
        (35, "PET VALU #610", "Pet Valu", -58.90, "pets", None),
        (7, "PET VALU #610", "Pet Valu", -52.40, "pets", None),
        (50, "JEAN COUTU PHARMACIE", "Jean Coutu", -32.80, "health-medical", m_sarah),
        (19, "PHARMAPRIX / SHOPPERS", "Pharmaprix", -26.40, "health-medical", m_michael),

        # Shopping & Hardware
        (61, "CANADIAN TIRE #312", "Canadian Tire", -68.50, "shopping", m_michael),
        (47, "AMAZON.CA*MKTPLACE", "Amazon.ca", -44.99, "shopping", m_sarah),
        (33, "THE HOME DEPOT #7011", "The Home Depot", -89.20, "home-maintenance", m_michael),
        (23, "AMAZON.CA*MKTPLACE", "Amazon.ca", -56.80, "shopping", m_sarah),
        (11, "DOLLARAMA #401", "Dollarama", -24.50, "shopping", m_sarah),

        # Subscriptions
        (75, "NETFLIX.COM CAD", "Netflix", -22.99, "subscriptions", None),
        (45, "NETFLIX.COM CAD", "Netflix", -22.99, "subscriptions", None),
        (15, "NETFLIX.COM CAD", "Netflix", -22.99, "subscriptions", None),
        (70, "SPOTIFY CANADA", "Spotify", -16.99, "subscriptions", None),
        (40, "SPOTIFY CANADA", "Spotify", -16.99, "subscriptions", None),
        (10, "SPOTIFY CANADA", "Spotify", -16.99, "subscriptions", None),
    ]

    for days_ago, raw, norm, amt, slug, member in card_txns:
        add_txn(visa, days_ago, raw, norm, amt, slug, member)

    # Insert all transactions
    db.add_all(txns_to_add)
    db.commit()

    # Recalculate account balances so current_balance_cents matches ledger exactly
    for acc in [chequing, hisa, tfsa, rrsp, visa, mortgage, car_loan]:
        recalculate_account_balance(db, acc.id)
    db.commit()

    # Backfill balance snapshots for Net Worth History
    backfill_all(db, months=6)
    db.commit()

    return {
        "message": "Canadian demo dataset successfully seeded with accounts, budgets, goals, and 90-day ledger history.",
        "accounts_count": db.query(Account).count(),
        "transactions_count": db.query(Transaction).count(),
        "categories_count": db.query(Category).count(),
        "rules_count": db.query(CategorizationRule).count(),
        "goals_count": db.query(Goal).count(),
        "household_members_count": db.query(HouseholdMember).count(),
        "snapshots_count": db.query(AccountBalanceSnapshot).count(),
    }
