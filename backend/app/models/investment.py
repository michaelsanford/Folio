"""Investment positions, lots, prices, and activity.

Before this, an INVESTMENT account was a manually typed balance -- there was no
way to answer "what is my return?", "how much of my growth was contributions
rather than the market?", or "what are my unrealized gains?".

Quantities are Numeric rather than integer minor units because a share count is
not money: fractional shares are routine and need more than two decimal places.
Everything monetary stays in exact integer cents.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.attribution import AttributedMixin
from app.models.money_fields import with_money

# 8 decimal places covers fractional-share brokers and crypto without float error.
QUANTITY = Numeric(28, 8)


class AssetClass(str, enum.Enum):
    EQUITY = "EQUITY"
    ETF = "ETF"
    MUTUAL_FUND = "MUTUAL_FUND"
    FIXED_INCOME = "FIXED_INCOME"
    CASH = "CASH"
    CRYPTO = "CRYPTO"
    OTHER = "OTHER"


class InvestmentActivityType(str, enum.Enum):
    """External flows move money in or out of the account; internal ones do not.

    The distinction is what makes money-weighted and time-weighted return
    different numbers, so it is modelled explicitly rather than inferred.
    """

    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    CONTRIBUTION = "CONTRIBUTION"
    WITHDRAWAL = "WITHDRAWAL"
    FEE = "FEE"

    @property
    def is_external_flow(self) -> bool:
        """True when the activity moves money across the account boundary."""
        return self in (
            InvestmentActivityType.CONTRIBUTION,
            InvestmentActivityType.WITHDRAWAL,
        )


class Security(Base):
    __tablename__ = "securities"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=True)
    exchange = Column(String(32), nullable=True)
    currency = Column(String(3), nullable=False, default="CAD")
    asset_class = Column(Enum(AssetClass, native_enum=False), nullable=False, default=AssetClass.EQUITY)
    # The listing that actually answered a quote request (``XEQT`` typed in a
    # CAD account resolves to ``XEQT.TO``), so it is looked up only once.
    quote_symbol = Column(String(32), nullable=True)
    # IANA zone of the listing's exchange, for its trading hours.
    exchange_timezone = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    quotes = relationship("PriceQuote", back_populates="security", cascade="all, delete-orphan")
    holdings = relationship("Holding", back_populates="security", cascade="all, delete-orphan")


class Holding(AttributedMixin, Base):
    """One security held within one investment account."""

    __tablename__ = "holdings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    security_id = Column(String(36), ForeignKey("securities.id", ondelete="CASCADE"), nullable=False, index=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    account = relationship("Account", back_populates="holdings")
    security = relationship("Security", back_populates="holdings")
    lots = relationship("Lot", back_populates="holding", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("account_id", "security_id", name="uq_holding_account_security"),
    )


@with_money(cost_basis=False, fee=False)
class Lot(AttributedMixin, Base):
    """A purchase tranche, kept separate so cost basis can be tracked per lot."""

    __tablename__ = "lots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    holding_id = Column(String(36), ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    trade_date = Column(Date, nullable=False, index=True)
    quantity = Column(QUANTITY, nullable=False)
    cost_basis_cents = Column(Integer, nullable=False, default=0)
    fee_cents = Column(Integer, nullable=False, default=0)
    # Set when the lot has been fully or partly disposed of.
    closed_quantity = Column(QUANTITY, nullable=False, default=0)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    holding = relationship("Holding", back_populates="lots")


class QuoteSource(str, enum.Enum):
    MANUAL = "MANUAL"
    YAHOO = "YAHOO"
    TMX = "TMX"
    # The last price in an imported holdings export; a refresh replaces it.
    IMPORT = "IMPORT"


class QuoteSession(str, enum.Enum):
    """Which part of the trading day an automated price comes from."""

    PRE = "PRE"
    REGULAR = "REGULAR"
    POST = "POST"


@with_money(price=False, previous_close=True)
class PriceQuote(Base):
    """One price per security per trading day.

    Typed in by hand (``MANUAL``) or fetched as a delayed quote. A manual price
    is never overwritten by a fetched one for the same day.
    """

    __tablename__ = "price_quotes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    security_id = Column(String(36), ForeignKey("securities.id", ondelete="CASCADE"), nullable=False, index=True)
    as_of_date = Column(Date, nullable=False, index=True)
    price_cents = Column(Integer, nullable=False)

    source = Column(String(16), nullable=False, default=QuoteSource.MANUAL.value, server_default="MANUAL")
    # Market time of the price (exchange clock), and when Folio fetched it.
    quoted_at = Column(DateTime(timezone=True), nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)
    session = Column(String(8), nullable=True)
    # Reference for the day's change: the prior close, or for a pre/post-market
    # price the regular session's close.
    previous_close_cents = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    security = relationship("Security", back_populates="quotes")

    __table_args__ = (
        UniqueConstraint("security_id", "as_of_date", name="uq_quote_security_date"),
        Index("ix_quotes_security_date", "security_id", "as_of_date"),
    )


@with_money(amount=False, fee=False)
class InvestmentActivity(AttributedMixin, Base):
    """A buy, sale, dividend, contribution, withdrawal, or fee."""

    __tablename__ = "investment_activities"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    security_id = Column(String(36), ForeignKey("securities.id", ondelete="SET NULL"), nullable=True, index=True)

    type = Column(Enum(InvestmentActivityType, native_enum=False), nullable=False)
    trade_date = Column(Date, nullable=False, index=True)
    quantity = Column(QUANTITY, nullable=True)
    # Signed in account terms: money into the account is positive.
    amount_cents = Column(Integer, nullable=False, default=0)
    fee_cents = Column(Integer, nullable=False, default=0)
    notes = Column(String(500), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    account = relationship("Account", back_populates="investment_activities")
    security = relationship("Security")

    __table_args__ = (
        Index("ix_activity_account_date", "account_id", "trade_date"),
    )
