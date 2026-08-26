import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.money_fields import with_money


class RulePatternType(str, enum.Enum):
    EXACT = "EXACT"
    CONTAINS = "CONTAINS"
    REGEX = "REGEX"
    STARTS_WITH = "STARTS_WITH"


@with_money(min_amount=True, max_amount=True)
class CategorizationRule(Base):
    __tablename__ = "categorization_rules"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category_id = Column(String(36), ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    priority = Column(Integer, nullable=False, default=10)  # Lower number = higher priority
    pattern_type = Column(Enum(RulePatternType), nullable=False, default=RulePatternType.CONTAINS)
    pattern = Column(String(255), nullable=False)
    
    # Optional constraints
    min_amount_cents = Column(Integer, nullable=True)
    max_amount_cents = Column(Integer, nullable=True)
    target_account_id = Column(String(36), nullable=True)
    
    # Merchant name cleaning
    normalized_payee_override = Column(String(255), nullable=True)
    
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    category = relationship("Category", back_populates="rules")
