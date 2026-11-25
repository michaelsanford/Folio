"""Investment holdings, prices, activity, and performance."""
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.money import from_cents, to_cents
from app.models.account import Account
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
    ReturnHistoryPoint,
    ReturnHistoryResponse,
    SecurityCreate,
    SymbolLookupResponse,
    SecurityResponse,
)
from app.services.investments.performance import (
    account_performance,
    holding_valuation,
    load_holdings,
    monthly_return_history,
    value_holdings,
)
from app.services.investments.quote_fetcher import (
    INVESTMENT_ACCOUNT_TYPES,
    fetch_boc_usdcad_rate,
    lookup_listing,
    revalue_accounts,
    update_quotes_for_securities,
)
from app.services.investments.symbols import quote_candidates

router = APIRouter(prefix="/investments", tags=["Investments"])


def _find_security(db: Session, symbol: str, currency: str | None = None) -> Security | None:
    """An existing security for this symbol, or for the listing it means.

    ``XEQT`` typed in a CAD account finds ``XEQT.TO`` rather than becoming a
    second, unquotable security.
    """
    symbol = symbol.strip().upper()
    exact = db.query(Security).filter(Security.symbol == symbol).first()
    if exact:
        return exact
    candidates = quote_candidates(symbol, currency)
    if not candidates:
        return None
    matches = (
        db.query(Security)
        .filter(Security.symbol.in_(candidates) | Security.quote_symbol.in_(candidates))
        .all()
    )
    # Most likely listing first, as quote_candidates orders them.
    rank = {c: i for i, c in enumerate(candidates)}
    matches.sort(key=lambda s: min(rank.get(s.symbol, 99), rank.get(s.quote_symbol or "", 99)))
    return matches[0] if matches else None


def _get_or_create_security(
    db: Session,
    symbol: str,
    name: str | None = None,
    asset_class=None,
    currency: str | None = None,
) -> Security:
    symbol = symbol.strip().upper()
    security = _find_security(db, symbol, currency)
    if security:
        return security
    security = Security(symbol=symbol, name=name, currency=(currency or "CAD").upper())
    if asset_class is not None:
        security.asset_class = asset_class
    db.add(security)
    db.flush()
    return security


def _require_investment_account(db: Session, account_id: str) -> Account:
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.type not in INVESTMENT_ACCOUNT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Holdings and investment activity apply only to INVESTMENT and registered accounts",
        )
    return account


def _valuation_to_schema(v: dict) -> HoldingValuation:
    price_cents = v["price_cents"]
    prev_cents = v.get("previous_close_cents")
    day_change = day_change_pct = None
    if price_cents is not None and prev_cents:
        day_change = float(from_cents(price_cents - prev_cents))
        day_change_pct = round((price_cents - prev_cents) / prev_cents * 100.0, 2)
    return HoldingValuation(
        price_source=v.get("price_source"),
        price_session=v.get("price_session"),
        price_quoted_at=v.get("price_quoted_at"),
        previous_close=float(from_cents(prev_cents)) if prev_cents else None,
        day_change=day_change,
        day_change_pct=day_change_pct,
        quote_symbol=v.get("quote_symbol"),
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
    holdings = load_holdings(db, [account_id] if account_id else None)
    # One batched price lookup for every position instead of one per holding.
    return [_valuation_to_schema(v) for v in value_holdings(db, holdings, as_of)]


@router.post("/holdings", response_model=HoldingValuation, status_code=status.HTTP_201_CREATED)
def create_holding(payload: HoldingCreate, db: Session = Depends(get_db)):
    account = _require_investment_account(db, payload.account_id)
    security = _get_or_create_security(
        db, payload.symbol, payload.name, payload.asset_class, currency=account.currency
    )

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

def _set_manual_price(quote: PriceQuote, price) -> None:
    """A typed price replaces a fetched one for that day and is never overwritten by a fetch."""
    quote.price_cents = to_cents(price)
    quote.source = "MANUAL"
    quote.session = None
    quote.quoted_at = None
    quote.fetched_at = None
    quote.previous_close_cents = None


@router.post("/prices", response_model=PriceQuoteResponse, status_code=status.HTTP_201_CREATED)
def upsert_price(payload: PriceQuoteCreate, db: Session = Depends(get_db)):
    """Record a price by hand. It takes precedence over fetched quotes for that day."""
    security = _get_or_create_security(db, payload.symbol)

    quote = (
        db.query(PriceQuote)
        .filter(PriceQuote.security_id == security.id, PriceQuote.as_of_date == payload.as_of_date)
        .first()
    )
    if quote is None:
        quote = PriceQuote(security_id=security.id, as_of_date=payload.as_of_date)
        db.add(quote)
    _set_manual_price(quote, payload.price)

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
        if quote is None:
            quote = PriceQuote(security_id=security.id, as_of_date=item.as_of_date)
            db.add(quote)
        _set_manual_price(quote, item.price)
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
            source=q.source,
            session=q.session,
            quoted_at=q.quoted_at,
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


@router.get("/return-history", response_model=ReturnHistoryResponse)
def get_return_history(
    account_id: str,
    as_of: date | None = Query(None, description="History up to this date (default today)"),
    db: Session = Depends(get_db),
):
    """Month-end values of the current positions, with return and volatility estimates."""
    _require_investment_account(db, account_id)
    h = monthly_return_history(db, account_id, as_of)
    return ReturnHistoryResponse(
        account_id=h["account_id"],
        as_of=h["as_of"],
        points=[
            ReturnHistoryPoint(
                month=p["month"],
                value=float(from_cents(p["value_cents"])),
                return_pct=p["return"],
            )
            for p in h["points"]
        ],
        months_of_history=h["months_of_history"],
        mean_monthly_log_return=h["mean_monthly_log_return"],
        stdev_monthly_log_return=h["stdev_monthly_log_return"],
        annualized_return=h["annualized_return"],
        annualized_volatility=h["annualized_volatility"],
        average_monthly_contribution=float(from_cents(h["average_monthly_contribution_cents"])),
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
    revalued, unpriced = revalue_accounts(db, as_of=as_of)
    return RevalueResponse(accounts_revalued=revalued, unpriced_holdings=unpriced)


class AutomatedQuotesResponse(BaseModel):
    updated_count: int
    failed_count: int
    quotes: list[dict]
    failed_symbols: list[str]
    usdcad_fx_rate: float | None = None
    accounts_revalued: int
    quotes_fetched: int = 0
    # Symbols not fetched: market closed with its close recorded, fetched in
    # the last few minutes, or priced by hand today.
    skipped_count: int = 0
    skipped_symbols: list[str] = []
    skipped_closed: list[str] = []
    skipped_recent: list[str] = []
    skipped_manual: list[str] = []
    # One entry per symbol that could not be quoted, with the reason.
    failures: list[dict] = []
    # True when the overall fetch deadline cut slow symbols off.
    timed_out: bool = False
    refreshed_at: str | None = None


class FxRateResponse(BaseModel):
    pair: str = "USDCAD"
    rate: float | None = None
    source: str = "Bank of Canada"
    as_of_date: str | None = None


@router.post("/quotes/fetch-automated", response_model=AutomatedQuotesResponse)
def fetch_automated_quotes(
    payload: list[str] | dict | None = Body(None),
    as_of: date | None = Query(None, description="Price quote date"),
    db: Session = Depends(get_db),
):
    """Fetches automated market quotes for TSX/US tickers and Bank of Canada FX."""
    symbols: list[str] | None = None
    if isinstance(payload, list):
        symbols = payload
    elif isinstance(payload, dict):
        symbols = payload.get("symbols")
    # An empty list means "everything", not "nothing": the app used to send
    # {"symbols": []} and so refreshed zero securities.
    res = update_quotes_for_securities(db, symbols=symbols or None, as_of=as_of)
    res["quotes_fetched"] = res.get("updated_count", 0)
    return AutomatedQuotesResponse(**res)


@router.get("/symbol-lookup", response_model=SymbolLookupResponse)
def symbol_lookup(
    q: str = Query(..., min_length=1, max_length=32),
    currency: str = Query("CAD", min_length=3, max_length=3),
):
    """Which listing a typed symbol means (``XEQT`` -> ``XEQT.TO``), with its delayed price."""
    result = lookup_listing(q, currency)
    quote = result.quote
    if quote is None:
        return SymbolLookupResponse(query=q.strip().upper(), found=False, reason=result.reason)
    return SymbolLookupResponse(
        query=q.strip().upper(),
        found=True,
        listing=result.resolved_symbol,
        name=quote.name,
        exchange=quote.exchange,
        currency=quote.currency,
        price=quote.price,
        source=quote.source,
        session=quote.session,
    )


@router.get("/fx-rate", response_model=FxRateResponse)
def get_boc_fx_rate(pair: str = "USDCAD"):
    """Returns official Bank of Canada USD/CAD daily exchange rate."""
    rate = fetch_boc_usdcad_rate()
    return FxRateResponse(pair=pair, rate=rate, source="Bank of Canada", as_of_date=date.today().isoformat())
