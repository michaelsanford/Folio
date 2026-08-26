from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.investment import AssetClass, InvestmentActivityType


class SecurityBase(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    name: str | None = Field(None, max_length=200)
    exchange: str | None = Field(None, max_length=32)
    currency: str = Field("CAD", min_length=3, max_length=3)
    asset_class: AssetClass = AssetClass.EQUITY

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, v: str) -> str:
        return v.strip().upper()


class SecurityCreate(SecurityBase):
    pass


class SecurityResponse(SecurityBase):
    id: str
    model_config = ConfigDict(from_attributes=True)


class LotCreate(BaseModel):
    trade_date: date
    quantity: Decimal = Field(..., gt=0)
    # Total paid for the tranche, not the per-unit price.
    cost_basis: Decimal = Field(..., ge=0)
    fee: Decimal = Field(Decimal("0"), ge=0)


class LotResponse(BaseModel):
    id: str
    trade_date: date
    quantity: Decimal
    closed_quantity: Decimal
    cost_basis: Decimal
    fee: Decimal
    model_config = ConfigDict(from_attributes=True)


class HoldingCreate(BaseModel):
    account_id: str
    symbol: str = Field(..., min_length=1, max_length=32)
    name: str | None = None
    asset_class: AssetClass = AssetClass.EQUITY
    lots: list[LotCreate] = []

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, v: str) -> str:
        return v.strip().upper()


class HoldingValuation(BaseModel):
    holding_id: str
    security_id: str
    symbol: str
    name: str | None = None
    asset_class: str
    quantity: Decimal
    cost_basis: float
    market_value: float
    unrealized_gain: float
    unrealized_gain_pct: float
    price: float | None = None
    price_as_of: date | None = None
    # False when no quote has been entered, so the UI can label the row rather
    # than let a cost-basis fallback pass for a market valuation.
    is_priced: bool


class PriceQuoteCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    as_of_date: date
    price: Decimal = Field(..., ge=0)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, v: str) -> str:
        return v.strip().upper()


class PriceQuoteBulkCreate(BaseModel):
    quotes: list[PriceQuoteCreate]


class PriceQuoteResponse(BaseModel):
    id: str
    security_id: str
    symbol: str
    as_of_date: date
    price: float


class InvestmentActivityCreate(BaseModel):
    account_id: str
    type: InvestmentActivityType
    trade_date: date
    symbol: str | None = None
    quantity: Decimal | None = None
    # Signed in account terms: money arriving in the account is positive.
    amount: Decimal
    fee: Decimal = Decimal("0")
    notes: str | None = Field(None, max_length=500)


class InvestmentActivityResponse(BaseModel):
    id: str
    account_id: str
    type: InvestmentActivityType
    trade_date: date
    symbol: str | None = None
    quantity: Decimal | None = None
    amount: float
    fee: float
    notes: str | None = None


class PeriodReturn(BaseModel):
    # Null when the period has no meaningful return (no flows, or no valuation).
    money_weighted: float | None = None
    time_weighted: float | None = None


class PerformanceResponse(BaseModel):
    account_id: str
    as_of: date
    market_value: float
    cost_basis: float
    unrealized_gain: float
    contributions: float
    withdrawals: float
    net_invested: float
    # Balance attributable to market movement rather than money added.
    market_growth: float
    holdings: list[HoldingValuation]
    returns: dict[str, PeriodReturn]
    unpriced_holdings: list[str]
