import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.database import Base


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    total_income_target = Column(Float, nullable=False, default=0.0)
    total_expense_target = Column(Float, nullable=False, default=0.0)
    notes = Column(String(500), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    items = relationship("BudgetItem", back_populates="budget", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_budget_year_month"),
    )


class BudgetItem(Base):
    __tablename__ = "budget_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    budget_id = Column(String(36), ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(String(36), ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    planned_amount = Column(Float, nullable=False, default=0.0)

    # Relationships
    budget = relationship("Budget", back_populates="items")
    category = relationship("Category", back_populates="budget_items")

    __table_args__ = (
        UniqueConstraint("budget_id", "category_id", name="uq_budget_item_budget_category"),
    )
