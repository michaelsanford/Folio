import os
import uuid

# Must be set before app.core.config is imported: keeps the app lifespan from
# migrating and seeding the developer database during tests.
os.environ["FOLIO_SKIP_STARTUP_TASKS"] = "1"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import Base, build_engine, get_db
from app.core.security import require_auth
from app.main import app
from app.models.account import Account, AccountType
from app.api.categories import seed_default_categories

# The compose service's test database (scripts/db-init creates it). CI points
# this at its own Postgres service.
TEST_DATABASE_URL = os.environ.get(
    "FOLIO_TEST_DATABASE_URL", "postgresql+psycopg://folio:folio@127.0.0.1:5433/folio_test"
)

engine = build_engine(TEST_DATABASE_URL)


def reset_schema(bind=engine) -> None:
    """Drop everything in the test database and create the models' tables."""
    with bind.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(bind=bind)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    reset_schema()
    yield
    engine.dispose()


def new_scratch_database():
    """Create an empty database; returns (engine, drop). Call drop() when done."""
    name = f"folio_scratch_{uuid.uuid4().hex[:8]}"
    admin = build_engine(TEST_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    scratch = build_engine(TEST_DATABASE_URL.rsplit("/", 1)[0] + f"/{name}")

    def drop():
        scratch.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()

    return scratch, drop


@pytest.fixture
def scratch_db():
    """A brand-new, empty database for one test, dropped afterwards: (url, engine)."""
    scratch, drop = new_scratch_database()
    try:
        yield scratch.url.render_as_string(hide_password=False), scratch
    finally:
        drop()


@pytest.fixture(scope="function")
def db_session():
    """A session whose every change is rolled back when the test ends.

    The test's commits release savepoints inside one outer transaction, so each
    test starts from the same freshly seeded database without rebuilding it.
    """
    connection = engine.connect()
    outer = connection.begin()
    db = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
    seed_default_categories(db)
    try:
        yield db
    finally:
        db.close()
        if outer.is_active:
            outer.rollback()
        connection.close()


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
