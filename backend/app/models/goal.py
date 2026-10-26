import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Date, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.money_fields import with_money


class GoalType(str, enum.Enum):
    SAVINGS = "SAVINGS"
    EMERGENCY_FUND = "EMERGENCY_FUND"
    TFSA_ANNUAL = "TFSA_ANNUAL"
    FHSA_ANNUAL = "FHSA_ANNUAL"
    HBP_REPAYMENT = "HBP_REPAYMENT"
    DEBT_PAYOFF = "DEBT_PAYOFF"


@with_money(target_amount=False, current_amount=True)
class Goal(Base):
    __tablename__ = "goals"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    type = Column(Enum(GoalType), nullable=False, default=GoalType.SAVINGS)
    target_amount_cents = Column(Integer, nullable=False, default=0)
    current_amount_cents = Column(Integer, nullable=True)
    target_date = Column(Date, nullable=True)

    # Emergency fund specific configuration
    emergency_fund_months = Column(Integer, nullable=True, default=6)
    excluded_category_ids = Column(Text, nullable=True)  # Comma-separated category IDs excluded from calculation

    # Optional attribution links
    linked_account_id = Column(String(36), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    owner_member_id = Column(String(36), ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True)

    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    linked_account = relationship("Account")
    owner_member = relationship("HouseholdMember", back_populates="goals")
