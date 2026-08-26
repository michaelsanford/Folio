"""Investment holdings, prices, activity, and performance."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.money import from_cents, to_cents
from app.models.account import Account, AccountType
from app.models.investment import (
    Holding,
    InvestmentActivity,
    Lot,
    PriceQuote,
    Security,
)
from app.schemas.investment import (
    HoldingCreate,
    HoldingValuation,
    InvestmentActivityCreate,
    InvestmentActivityResponse,
    PerformanceResponse,
    PriceQuoteBulkCreate,
    PriceQuoteCreate,
    PriceQuoteResponse,
    SecurityCreate,
    SecurityResponse,
)
from app.services.investments.performance import account_performance, holding_valuation

router = APIRouter(prefix="/investments", tags=["Investments"])


def _get_or_create_security(db: Session, symbol: str, name: str | None = None, asset_class=None) -> Security:
    symbol = symbol.strip().upper()
    security = db.query(Security).filter(Security.symbol == symbol).first()
    if security:
        return security
    security = Security(symbol=symbol, name=name)
    if asset_class is not None:
        security.asset_class = asset_class
    db.add(security)
    db.flush()
    return security


def _require_investment_account(db: Session, account_id: str) -> Account:
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type != AccountType.INVESTMENT:
        raise HTTPException(
            status_code=400,
            detail="Holdings and investment activity apply only to INVESTMENT accounts",
        )
    return account


def _valuation_to_schema(v: dict) -> HoldingValuation:
    return HoldingValuation(
        holding_id=v["holding_id"],
        security_id=v["security_id"],
        symbol=v["symbol"],
        name=v["name"],
        asset_class=v["asset_class"],
        quantity=v["quantity"],
        cost_basis=float(from_cents(v["cost_basis_cents"])),
        market_value=float(from_cents(v["market_value_cents"])),
        unrealized_gain=float(from_cents(v["unrealized_gain_cents"])),
        unrealized_gain_pct=v["unrealized_gain_pct"],
        price=float(from_cents(v["price_cents"])) if v["price_cents"] is not None else None,
        price_as_of=v["price_as_of"],
        is_priced=v["is_priced"],
    )


# --------------------------------------------------------------------- securities

@router.get("/securities", response_model=list[SecurityResponse])
def list_securities(db: Session = Depends(get_db)):
    return db.query(Security).order_by(Security.symbol.asc()).all()


@router.post("/securities", response_model=SecurityResponse, status_code=status.HTTP_201_CREATED)
def create_security(payload: SecurityCreate, db: Session = Depends(get_db)):
    if db.query(Security).filter(Security.symbol == payload.symbol).first():
        raise HTTPException(status_code=400, detail=f"Security {payload.symbol} already exists")
    security = Security(**payload.model_dump())
    db.add(security)
    db.commit()
    db.refresh(security)
    return security


# ---------------------------------------------------------------------- holdings

@router.get("/holdings", response_model=list[HoldingValuation])
def list_holdings(
    account_id: str | None = None,
    as_of: date | None = Query(None, description="Value the positions as at this date"),
    db: Session = Depends(get_db),
):
    query = db.query(Holding).options(joinedload(Holding.security), joinedload(Holding.lots))
    if account_id:
        query = query.filter(Holding.account_id == account_id)
    return [_valuation_to_schema(holding_valuation(db, h, as_of)) for h in query.all()]


@router.post("/holdings", response_model=HoldingValuation, status_code=status.HTTP_201_CREATED)
def create_holding(payload: HoldingCreate, db: Session = Depends(get_db)):
    _require_investment_account(db, payload.account_id)
    security = _get_or_create_security(db, payload.symbol, payload.name, payload.asset_class)

    holding = (
        db.query(Holding)
        .filter(Holding.account_id == payload.account_id, Holding.security_id == security.id)
        .first()
    )
    if holding is None:
        holding = Holding(account_id=payload.account_id, security_id=security.id)
        db.add(holding)
        db.flush()

    for lot_in in payload.lots:
        holding.lots.append(
            Lot(
                trade_date=lot_in.trade_date,
                quantity=lot_in.quantity,
                cost_basis_cents=to_cents(lot_in.cost_basis),
                fee_cents=to_cents(lot_in.fee),
            )
        )

    db.commit()
    db.refresh(holding)
    return _valuation_to_schema(holding_valuation(db, holding))


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(holding_id: str, db: Session = Depends(get_db)):
    holding = db.query(Holding).filter(Holding.id == holding_id).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()
    return None


# ------------------------------------------------------------------------ prices

@router.post("/prices", response_model=PriceQuoteResponse, status_code=status.HTTP_201_CREATED)
def upsert_price(payload: PriceQuoteCreate, db: Session = Depends(get_db)):
    """Record a price. Manual by design: no external feed, so no network egress."""
    security = _get_or_create_security(db, payload.symbol)

    quote = (
        db.query(PriceQuote)
        .filter(PriceQuote.security_id == security.id, PriceQuote.as_of_date == payload.as_of_date)
        .first()
    )
    if quote:
        quote.price_cents = to_cents(payload.price)
    else:
        quote = PriceQuote(
            security_id=security.id,
            as_of_date=payload.as_of_date,
            price_cents=to_cents(payload.price),
        )
        db.add(quote)

    db.commit()
    db.refresh(quote)
    return PriceQuoteResponse(
        id=quote.id,
        security_id=security.id,
        symbol=security.symbol,
        as_of_date=quote.as_of_date,
        price=float(from_cents(quote.price_cents)),
    )


@router.post("/prices/bulk", response_model=list[PriceQuoteResponse])
def upsert_prices_bulk(payload: PriceQuoteBulkCreate, db: Session = Depends(get_db)):
    """Paste a batch of quotes at once -- the realistic way to keep prices current."""
    results: list[PriceQuoteResponse] = []
    for item in payload.quotes:
        security = _get_or_create_security(db, item.symbol)
        quote = (
            db.query(PriceQuote)
            .filter(PriceQuote.security_id == security.id, PriceQuote.as_of_date == item.as_of_date)
            .first()
        )
        if quote:
            quote.price_cents = to_cents(item.price)
        else:
            quote = PriceQuote(
                security_id=security.id,
                as_of_date=item.as_of_date,
                price_cents=to_cents(item.price),
            )
            db.add(quote)
        db.flush()
        results.append(
            PriceQuoteResponse(
                id=quote.id,
                security_id=security.id,
                symbol=security.symbol,
                as_of_date=quote.as_of_date,
                price=float(from_cents(quote.price_cents)),
            )
        )
    db.commit()
    return results


@router.get("/prices", response_model=list[PriceQuoteResponse])
def list_prices(symbol: str | None = None, db: Session = Depends(get_db)):
    query = db.query(PriceQuote).join(Security, PriceQuote.security_id == Security.id)
    if symbol:
        query = query.filter(Security.symbol == symbol.strip().upper())
    quotes = query.order_by(PriceQuote.as_of_date.desc()).limit(500).all()
    return [
        PriceQuoteResponse(
            id=q.id,
            security_id=q.security_id,
            symbol=q.security.symbol,
            as_of_date=q.as_of_date,
            price=float(from_cents(q.price_cents)),
        )
        for q in quotes
    ]


# ---------------------------------------------------------------------- activity

@router.post("/activities", response_model=InvestmentActivityResponse, status_code=status.HTTP_201_CREATED)
def create_activity(payload: InvestmentActivityCreate, db: Session = Depends(get_db)):
    _require_investment_account(db, payload.account_id)

    security = _get_or_create_security(db, payload.symbol) if payload.symbol else None

    activity = InvestmentActivity(
        account_id=payload.account_id,
        security_id=security.id if security else None,
        type=payload.type,
        trade_date=payload.trade_date,
        quantity=payload.quantity,
        amount_cents=to_cents(payload.amount),
        fee_cents=to_cents(payload.fee),
        notes=payload.notes,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)

    return InvestmentActivityResponse(
        id=activity.id,
        account_id=activity.account_id,
        type=activity.type,
        trade_date=activity.trade_date,
        symbol=security.symbol if security else None,
        quantity=activity.quantity,
        amount=float(from_cents(activity.amount_cents)),
        fee=float(from_cents(activity.fee_cents)),
        notes=activity.notes,
    )


@router.get("/activities", response_model=list[InvestmentActivityResponse])
def list_activities(account_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(InvestmentActivity).options(joinedload(InvestmentActivity.security))
    if account_id:
        query = query.filter(InvestmentActivity.account_id == account_id)
    activities = query.order_by(InvestmentActivity.trade_date.desc()).all()
    return [
        InvestmentActivityResponse(
            id=a.id,
            account_id=a.account_id,
            type=a.type,
            trade_date=a.trade_date,
            symbol=a.security.symbol if a.security else None,
            quantity=a.quantity,
            amount=float(from_cents(a.amount_cents)),
            fee=float(from_cents(a.fee_cents)),
            notes=a.notes,
        )
        for a in activities
    ]


# ------------------------------------------------------------------- performance

@router.get("/performance", response_model=PerformanceResponse)
def get_performance(
    account_id: str,
    as_of: date | None = Query(None, description="Report as at this date (default today)"),
    db: Session = Depends(get_db),
):
    _require_investment_account(db, account_id)
    report = account_performance(db, account_id, as_of)

    return PerformanceResponse(
        account_id=report["account_id"],
        as_of=report["as_of"],
        market_value=float(from_cents(report["market_value_cents"])),
        cost_basis=float(from_cents(report["cost_basis_cents"])),
        unrealized_gain=float(from_cents(report["unrealized_gain_cents"])),
        contributions=float(from_cents(report["contributions_cents"])),
        withdrawals=float(from_cents(report["withdrawals_cents"])),
        net_invested=float(from_cents(report["net_invested_cents"])),
        market_growth=float(from_cents(report["market_growth_cents"])),
        holdings=[_valuation_to_schema(v) for v in report["holdings"]],
        returns=report["returns"],
        unpriced_holdings=report["unpriced_holdings"],
    )


class RevalueResponse(BaseModel):
    accounts_revalued: int
    unpriced_holdings: list[str]


@router.post("/revalue", response_model=RevalueResponse)
def revalue_investment_accounts(
    as_of: date | None = Query(None, description="Use prices at or before this date"),
    db: Session = Depends(get_db),
):
    """Set each INVESTMENT account balance from its holdings' market value.

    Writing the balance rather than deriving it on read means net worth, the
    sidebar total, and the balance snapshot series all pick up real position
    values with no special-casing, and the figure stays stable until the user
    enters new prices.
    """
    from app.services.snapshots.balance_history import record_snapshot

    accounts = db.query(Account).filter(Account.type == AccountType.INVESTMENT).all()
    unpriced: list[str] = []
    revalued = 0

    for account in accounts:
        holdings = db.query(Holding).filter(Holding.account_id == account.id).all()
        if not holdings:
            continue
        total = 0
        for holding in holdings:
            valuation = holding_valuation(db, holding, as_of)
            total += valuation["market_value_cents"]
            if not valuation["is_priced"]:
                unpriced.append(valuation["symbol"])
        account.current_balance_cents = total
        record_snapshot(db, account.id, total, as_of)
        revalued += 1

    db.commit()
    return RevalueResponse(accounts_revalued=revalued, unpriced_holdings=sorted(set(unpriced)))
