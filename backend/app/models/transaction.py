import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Integer, DateTime, Enum, ForeignKey, Index, text
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.attribution import AttributedMixin
from app.core.config import settings
from app.models.money_fields import with_money


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    CLEARED = "CLEARED"
    RECONCILED = "RECONCILED"


@with_money(amount=False)
class Transaction(AttributedMixin, Base):
    __tablename__ = "transactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # account_id lookups are served by ix_transactions_account_date (leading column).
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    transfer_transaction_id = Column(String(36), ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    statement_file_id = Column(String(36), ForeignKey("statement_files.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_member_id = Column(String(36), ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True)
    
    transaction_date = Column(DateTime, nullable=False, index=True)
    posted_date = Column(DateTime, nullable=True)
    raw_payee = Column(String(255), nullable=False)
    normalized_payee = Column(String(255), nullable=True, index=True)
    
    # Financial convention: Negative = Outflow / Expense / Debit, Positive = Inflow / Income / Credit
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False, default=settings.DEFAULT_CURRENCY)
    
    # Deduplication fingerprint: SHA256(account_id|date|amount|raw_payee)
    # Looked up only together with account_id (see the composite indexes below).
    import_hash = Column(String(64), nullable=True)
    
    status = Column(Enum(TransactionStatus), nullable=False, default=TransactionStatus.CLEARED)
    notes = Column(String(500), nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    account = relationship("Account", back_populates="transactions")
    assigned_member = relationship("HouseholdMember", back_populates="transactions")
    statement_file = relationship("StatementFile", back_populates="transactions")
    splits = relationship("TransactionSplit", back_populates="transaction", cascade="all, delete-orphan")
    transfer_pair = relationship("Transaction", remote_side=[id], foreign_keys=[transfer_transaction_id], post_update=True)

    __table_args__ = (
        Index("ix_transactions_account_date", "account_id", "transaction_date"),
        # Deduplication looks up (account, hash) on every imported row.
        Index("ix_transactions_account_import_hash", "account_id", "import_hash"),
        # The database refuses a second copy of an imported row. Migration 0005
        # skips this on vaults that already contain duplicates.
        Index(
            "uq_transactions_account_import_hash",
            "account_id",
            "import_hash",
            unique=True,
            sqlite_where=text("import_hash IS NOT NULL"),
        ),
        # Transfer matching probes opposite amounts inside a date window.
        Index("ix_transactions_amount_date", "amount_cents", "transaction_date"),
    )


@with_money(amount=False)
class TransactionSplit(Base):
    __tablename__ = "transaction_splits"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Served by ix_splits_transaction_category (leading column).
    transaction_id = Column(String(36), ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(String(36), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    amount_cents = Column(Integer, nullable=False)
    memo = Column(String(255), nullable=True)

    # Relationships
    transaction = relationship("Transaction", back_populates="splits")
    category = relationship("Category", back_populates="splits")

    __table_args__ = (
        # Analytics groups splits by category after joining to transactions;
        # the single-column indexes cannot serve that as well as the pair.
        Index("ix_splits_transaction_category", "transaction_id", "category_id"),
    )
