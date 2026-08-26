import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.money_fields import with_money


class LoanCompounding(str, enum.Enum):
    """How often interest is compounded on a loan.

    Canadian fixed-rate mortgages are compounded semi-annually, not in advance
    (Interest Act, s.6); US mortgages compound monthly. Using the US convention
    for a Canadian mortgage overstates interest by thousands over the term.
    """

    MONTHLY = "MONTHLY"
    SEMI_ANNUAL = "SEMI_ANNUAL"


class AccountType(str, enum.Enum):
    CHECKING = "CHECKING"
    SAVINGS = "SAVINGS"
    CREDIT_CARD = "CREDIT_CARD"
    MORTGAGE = "MORTGAGE"
    VEHICLE_LOAN = "VEHICLE_LOAN"
    INVESTMENT = "INVESTMENT"
    OTHER_ASSET = "OTHER_ASSET"
    OTHER_LIABILITY = "OTHER_LIABILITY"


@with_money(
    current_balance=False,
    credit_limit=True,
    loan_original_principal=True,
    monthly_payment=True,
    escrow_payment=True,
)
class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    type = Column(Enum(AccountType), nullable=False)
    institution = Column(String(100), nullable=True)
    account_number_mask = Column(String(20), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    current_balance_cents = Column(Integer, nullable=False, default=0)
    
    # Credit Card specific
    credit_limit_cents = Column(Integer, nullable=True)
    
    # Loan / Mortgage specific
    interest_rate = Column(Float, nullable=True)  # Annual percentage rate, e.g. 6.5
    loan_origination_date = Column(DateTime, nullable=True)
    loan_term_months = Column(Integer, nullable=True)
    loan_original_principal_cents = Column(Integer, nullable=True)
    monthly_payment_cents = Column(Integer, nullable=True)
    escrow_payment_cents = Column(Integer, nullable=True)  # Property tax + insurance portion
    compounding = Column(
        Enum(LoanCompounding), nullable=False, default=LoanCompounding.MONTHLY
    )
    
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    statement_files = relationship("StatementFile", back_populates="account", cascade="all, delete-orphan")
    balance_snapshots = relationship("AccountBalanceSnapshot", back_populates="account", cascade="all, delete-orphan")
    holdings = relationship("Holding", back_populates="account", cascade="all, delete-orphan")
    investment_activities = relationship("InvestmentActivity", back_populates="account", cascade="all, delete-orphan")
