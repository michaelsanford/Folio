import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship
from app.core.database import Base


class AccountType(str, enum.Enum):
    CHECKING = "CHECKING"
    SAVINGS = "SAVINGS"
    CREDIT_CARD = "CREDIT_CARD"
    MORTGAGE = "MORTGAGE"
    VEHICLE_LOAN = "VEHICLE_LOAN"
    INVESTMENT = "INVESTMENT"
    OTHER_ASSET = "OTHER_ASSET"
    OTHER_LIABILITY = "OTHER_LIABILITY"


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    type = Column(Enum(AccountType), nullable=False)
    institution = Column(String(100), nullable=True)
    account_number_mask = Column(String(20), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    current_balance = Column(Float, nullable=False, default=0.0)
    
    # Credit Card specific
    credit_limit = Column(Float, nullable=True)
    
    # Loan / Mortgage specific
    interest_rate = Column(Float, nullable=True)  # Annual percentage rate, e.g. 6.5
    loan_origination_date = Column(DateTime, nullable=True)
    loan_term_months = Column(Integer, nullable=True)
    loan_original_principal = Column(Float, nullable=True)
    monthly_payment = Column(Float, nullable=True)
    escrow_payment = Column(Float, nullable=True)  # Property tax + insurance portion
    
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    statement_files = relationship("StatementFile", back_populates="account", cascade="all, delete-orphan")
