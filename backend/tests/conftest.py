import os

# Must be set before app.core.config is imported: keeps the app lifespan from
# migrating and seeding the developer database during tests.
os.environ["FOLIO_SKIP_STARTUP_TASKS"] = "1"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import require_auth
from app.main import app
from app.models.account import Account, AccountType
from app.api.categories import seed_default_categories

# Use in-memory SQLite for testing
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    seed_default_categories(db)
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    def override_require_auth():
        return {"sub": "test-owner"}

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = override_require_auth
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()



@pytest.fixture
def sample_checking_account(db_session):
    account = Account(
        name="Main Checking",
        type=AccountType.CHECKING,
        institution="Chase",
        account_number_mask="*1234",
        current_balance=2500.0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@pytest.fixture
def sample_mortgage_account(db_session):
    account = Account(
        name="Home Mortgage",
        type=AccountType.MORTGAGE,
        institution="Wells Fargo",
        account_number_mask="*9876",
        current_balance=350000.0,
        loan_original_principal=380000.0,
        interest_rate=6.5,
        loan_term_months=360,
        monthly_payment=2401.87,
        escrow_payment=450.0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@pytest.fixture
def unauthenticated_client(db_session):
    """Client with a real auth dependency but an isolated database.

    Auth tests must exercise require_auth for real, so they cannot use the
    ``client`` fixture -- but they still must not touch the developer database.
    """
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
