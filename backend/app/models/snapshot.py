import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.money_fields import with_money


@with_money(balance=False)
class AccountBalanceSnapshot(Base):
    """One balance per account per day.

    Exists so net worth history is a real measured series rather than today's
    figure repeated backwards. Written whenever a balance is recalculated, and
    backfilled by replaying transactions from the current balance.
    """

    __tablename__ = "account_balance_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    as_of_date = Column(Date, nullable=False, index=True)
    balance_cents = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    account = relationship("Account", back_populates="balance_snapshots")

    __table_args__ = (
        UniqueConstraint("account_id", "as_of_date", name="uq_snapshot_account_date"),
        Index("ix_snapshots_date_account", "as_of_date", "account_id"),
    )
