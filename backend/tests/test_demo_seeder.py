import pytest
from app.models.account import Account, AccountType
from app.models.budget import Budget
from app.models.category import Category
from app.models.goal import Goal
from app.models.household import HouseholdMember
from app.models.transaction import Transaction
from app.services.seed.demo_seeder import seed_canadian_demo_dataset


def test_seed_canadian_demo_dataset_creates_complete_household(db_session):
    stats = seed_canadian_demo_dataset(db_session, force=True)

    assert stats["accounts_count"] == 7
    assert stats["household_members_count"] == 2
    assert stats["goals_count"] == 2
    assert stats["transactions_count"] >= 50
    assert stats["snapshots_count"] > 0

    # Household members
    michael = db_session.query(HouseholdMember).filter(HouseholdMember.name == "Michael").first()
    sarah = db_session.query(HouseholdMember).filter(HouseholdMember.name == "Sarah").first()
    assert michael is not None
    assert sarah is not None

    # Accounts
    chequing = db_session.query(Account).filter(Account.name == "Joint Chequing").first()
    hisa = db_session.query(Account).filter(Account.name == "Emergency HISA").first()
    tfsa = db_session.query(Account).filter(Account.name == "Michael's TFSA").first()
    rrsp = db_session.query(Account).filter(Account.name == "Sarah's RRSP").first()
    visa = db_session.query(Account).filter(Account.name == "Visa Infinite").first()
    mortgage = db_session.query(Account).filter(Account.name == "Home Mortgage").first()
    car_loan = db_session.query(Account).filter(Account.name == "Vehicle Loan").first()

    assert chequing is not None and chequing.current_balance_cents > 0
    assert hisa is not None and hisa.current_balance_cents == 1500000
    assert tfsa is not None and tfsa.current_balance_cents == 2450000
    assert rrsp is not None and rrsp.current_balance_cents == 3820000
    assert visa is not None and visa.current_balance_cents < 0
    assert mortgage is not None and mortgage.current_balance_cents == -38000000
    assert car_loan is not None and car_loan.current_balance_cents == -2450000

    # Transactions & Splits
    txns = db_session.query(Transaction).all()
    assert len(txns) >= 50

    # Check that transfers are paired
    transfers = [t for t in txns if t.transfer_transaction_id is not None]
    assert len(transfers) >= 8
    for t in transfers:
        counterpart = db_session.query(Transaction).filter(Transaction.id == t.transfer_transaction_id).first()
        assert counterpart is not None
        assert counterpart.transfer_transaction_id == t.id
        assert t.amount_cents == -counterpart.amount_cents

    # Check mortgage splits
    mortgage_pmts = [t for t in txns if "DESJARDINS" in t.raw_payee]
    assert len(mortgage_pmts) == 3
    for m in mortgage_pmts:
        assert len(m.splits) == 3

    # Check budget exists
    budget = db_session.query(Budget).first()
    assert budget is not None
    assert len(budget.items) > 0


def test_seed_demo_data_api_endpoint(client, db_session):
    resp = client.post("/api/maintenance/seed-demo-data?force=true")
    assert resp.status_code == 200
    data = resp.json()
    assert data["accounts_count"] == 7
    assert data["transactions_count"] >= 50

    # Second call without force should report already exists
    resp2 = client.post("/api/maintenance/seed-demo-data?force=false")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert "already exist" in data2["message"]
