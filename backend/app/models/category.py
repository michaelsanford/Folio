import uuid
from datetime import datetime, timezone
import enum
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class CategoryType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"
    TRANSFER = "TRANSFER"


class Category(Base):
    __tablename__ = "categories"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    parent_id = Column(String(36), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    icon = Column(String(50), nullable=True, default="tag")
    color = Column(String(20), nullable=True, default="#6366F1")
    type = Column(Enum(CategoryType), nullable=False, default=CategoryType.EXPENSE)
    is_budgeted = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    parent = relationship("Category", remote_side=[id], backref="children")
    splits = relationship("TransactionSplit", back_populates="category")
    rules = relationship("CategorizationRule", back_populates="category")
    budget_items = relationship("BudgetItem", back_populates="category")
