import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class HouseholdMember(Base):
    __tablename__ = "household_members"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    color = Column(String(20), nullable=False, default="#10B981")
    avatar_icon = Column(String(50), nullable=False, default="user")
    role = Column(String(50), nullable=True, default="Member")  # "Primary", "Partner", "Dependent"
    notes = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    accounts = relationship("Account", back_populates="owner_member")
    transactions = relationship("Transaction", back_populates="assigned_member")
    goals = relationship("Goal", back_populates="owner_member")
