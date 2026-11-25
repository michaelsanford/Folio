"""Investment valuation and return calculation.

Two different returns are reported because they answer two different questions:

* **Money-weighted (XIRR)** -- what did *this investor* earn, given when they put
  money in? Deposit timing changes it, which is the point.
* **Time-weighted (TWR)** -- how did the *investments* perform, independent of
  deposit timing? This is the number comparable to a benchmark.

Reporting only one of them is how personal-finance tools mislead people: a large
contribution just before a rally flatters MWR while TWR is unchanged.
"""
import math
from datetime import date, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, selectinload

from app.models.investment import (
    Holding,
    InvestmentActivity,
    InvestmentActivityType,
    PriceQuote,
)

DAYS_PER_YEAR = 365.0


# --------------------------------------------------------------------------
# Valuation
# --------------------------------------------------------------------------

def latest_price_cents(db: Session, security_id: str, as_of: date | None = None) -> tuple[int | None, date | None]:
    """Most recent manually entered price at or before ``as_of``.

    Returns the date too so callers can show how stale the valuation is -- a
    price with no "as of" stamp invites mistaking an old quote for a live one.
    """
    query = db.query(PriceQuote).filter(PriceQuote.security_id == security_id)
    if as_of is not None:
        query = query.filter(PriceQuote.as_of_date <= as_of)
    quote = query.order_by(PriceQuote.as_of_date.desc()).first()
    return (quote.price_cents, quote.as_of_date) if quote else (None, None)


_ID_CHUNK = 500


def latest_prices_cents(
    db: Session,
    security_ids: list[str],
    as_of: date | None = None,
) -> dict[str, tuple[int, date]]:
    """Latest price at or before ``as_of`` for many securities in one query.

    Returns ``{security_id: (price_cents, as_of_date)}``; unpriced securities
    are absent. Replaces one query per holding when valuing a portfolio.
    """
    ids = list(dict.fromkeys(i for i in security_ids if i))
    prices: dict[str, tuple[int, date]] = {}
    for i in range(0, len(ids), _ID_CHUNK):
        chunk = ids[i : i + _ID_CHUNK]
        latest = db.query(
            PriceQuote.security_id.label("security_id"),
            func.max(PriceQuote.as_of_date).label("as_of_date"),
        ).filter(PriceQuote.security_id.in_(chunk))
        if as_of is not None:
            latest = latest.filter(PriceQuote.as_of_date <= as_of)
        latest = latest.group_by(PriceQuote.security_id).subquery()
        rows = (
            db.query(PriceQuote.security_id, PriceQuote.price_cents, PriceQuote.as_of_date)
            .join(
                latest,
                and_(
                    PriceQuote.security_id == latest.c.security_id,
                    PriceQuote.as_of_date == latest.c.as_of_date,
                ),
            )
            .all()
        )
        for security_id, price_cents, quote_date in rows:
            prices[security_id] = (price_cents, quote_date)
    return prices


def load_holdings(db: Session, account_ids: list[str] | None = None) -> list[Holding]:
    """Holdings with their lots and security loaded up front (no lazy loads per row)."""
    query = db.query(Holding).options(selectinload(Holding.lots), selectinload(Holding.security))
    if account_ids is not None:
        query = query.filter(Holding.account_id.in_(account_ids))
    return query.all()


def value_holdings(db: Session, holdings: list[Holding], as_of: date | None = None) -> list[dict]:
    """Value many holdings with a single batched price lookup."""
    prices = latest_prices_cents(db, [h.security_id for h in holdings], as_of)
    return [
        holding_valuation(db, h, as_of, price=prices.get(h.security_id, (None, None)))
        for h in holdings
    ]


def open_quantity(holding: Holding) -> Decimal:
    """Units still held, i.e. purchased minus disposed, across all lots."""
    return sum(
        (Decimal(lot.quantity) - Decimal(lot.closed_quantity) for lot in holding.lots),
        Decimal(0),
    )


def open_cost_basis_cents(holding: Holding) -> int:
    """Cost of the units still held, pro-rated within each partially sold lot."""
    total = 0
    for lot in holding.lots:
        qty = Decimal(lot.quantity)
        if qty == 0:
            continue
        remaining = (qty - Decimal(lot.closed_quantity)) / qty
        total += int((Decimal(lot.cost_basis_cents + lot.fee_cents) * remaining).to_integral_value())
    return total


def holding_valuation(
    db: Session,
    holding: Holding,
    as_of: date | None = None,
    price: tuple[int | None, date | None] | None = None,
) -> dict:
    """Market value, cost basis, and unrealized gain for one position.

    Pass ``price`` (from :func:`latest_prices_cents`) when valuing many
    holdings, to avoid one price query per holding.
    """
    quantity = open_quantity(holding)
    cost_cents = open_cost_basis_cents(holding)
    if price is None:
        price_cents, price_date = latest_price_cents(db, holding.security_id, as_of)
    else:
        price_cents, price_date = price

    if price_cents is None:
        # No price entered yet: report cost rather than pretending the value is
        # zero, and flag it so the UI can say the valuation is unpriced.
        market_cents = cost_cents
        priced = False
    else:
        market_cents = int((Decimal(price_cents) * quantity).to_integral_value())
        priced = True

    return {
        "holding_id": holding.id,
        "security_id": holding.security_id,
        "symbol": holding.security.symbol if holding.security else "",
        "name": holding.security.name if holding.security else None,
        "asset_class": holding.security.asset_class.value if holding.security else "OTHER",
        "quantity": quantity,
        "cost_basis_cents": cost_cents,
        "market_value_cents": market_cents,
        "unrealized_gain_cents": market_cents - cost_cents,
        "unrealized_gain_pct": (
            round(float(market_cents - cost_cents) / cost_cents * 100.0, 2) if cost_cents else 0.0
        ),
        "price_cents": price_cents,
        "price_as_of": price_date,
        "is_priced": priced,
    }


def account_market_value_cents(db: Session, account_id: str, as_of: date | None = None) -> int:
    holdings = load_holdings(db, [account_id])
    return sum(v["market_value_cents"] for v in value_holdings(db, holdings, as_of))


# --------------------------------------------------------------------------
# Money-weighted return (XIRR)
# --------------------------------------------------------------------------

def _xnpv(rate: float, flows: list[tuple[date, float]]) -> float:
    t0 = flows[0][0]
    total = 0.0
    for when, amount in flows:
        years = (when - t0).days / DAYS_PER_YEAR
        total += amount / ((1.0 + rate) ** years)
    return total


def xirr(flows: list[tuple[date, float]], *, tolerance: float = 1e-7, max_iterations: int = 200) -> float | None:
    """Annualized money-weighted return.

    Bisection rather than Newton-Raphson: it cannot diverge, and for cash-flow
    series with sign changes (a withdrawal mid-period) Newton frequently does.
    Requires at least one inflow and one outflow, otherwise no rate exists.
    """
    if len(flows) < 2:
        return None

    flows = sorted(flows, key=lambda f: f[0])
    amounts = [a for _, a in flows]
    if not (any(a > 0 for a in amounts) and any(a < 0 for a in amounts)):
        return None

    low, high = -0.9999, 10.0
    f_low = _xnpv(low, flows)
    f_high = _xnpv(high, flows)

    # Expand the bracket if the root is not inside it.
    attempts = 0
    while f_low * f_high > 0 and attempts < 60:
        high *= 2.0
        f_high = _xnpv(high, flows)
        attempts += 1
    if f_low * f_high > 0:
        return None

    for _ in range(max_iterations):
        mid = (low + high) / 2.0
        f_mid = _xnpv(mid, flows)
        if abs(f_mid) < tolerance:
            return mid
        if f_low * f_mid < 0:
            high, f_high = mid, f_mid
        else:
            low, f_low = mid, f_mid

    return (low + high) / 2.0


# --------------------------------------------------------------------------
# Time-weighted return
# --------------------------------------------------------------------------

def time_weighted_return(
    db: Session,
    account_id: str,
    start: date,
    end: date,
) -> float | None:
    """Chain sub-period returns across every external cash flow.

    Each contribution or withdrawal ends a sub-period. Because each sub-period
    return is computed on the value *before* the flow, deposit timing cancels
    out -- which is exactly what distinguishes this from XIRR.
    """
    flows = (
        db.query(InvestmentActivity)
        .filter(
            InvestmentActivity.account_id == account_id,
            InvestmentActivity.trade_date > start,
            InvestmentActivity.trade_date <= end,
            InvestmentActivity.type.in_(
                [InvestmentActivityType.CONTRIBUTION, InvestmentActivityType.WITHDRAWAL]
            ),
        )
        .order_by(InvestmentActivity.trade_date.asc())
        .all()
    )

    start_value = account_market_value_cents(db, account_id, start)
    if start_value <= 0 and not flows:
        return None

    cumulative = 1.0
    period_start_value = start_value

    for flow in flows:
        # Value immediately before the flow settles.
        value_before = account_market_value_cents(db, account_id, flow.trade_date)
        if period_start_value > 0:
            cumulative *= value_before / period_start_value
        # The flow itself changes the base but is not a return.
        period_start_value = value_before + flow.amount_cents

    end_value = account_market_value_cents(db, account_id, end)
    if period_start_value > 0:
        cumulative *= end_value / period_start_value

    return cumulative - 1.0


# --------------------------------------------------------------------------
# Combined report
# --------------------------------------------------------------------------

PERIODS = {
    "1M": 30,
    "3M": 91,
    "YTD": None,   # resolved against 1 January
    "1Y": 365,
    "ALL": None,   # resolved against the earliest activity
}


def _period_start(db: Session, account_id: str, label: str, end: date) -> date:
    if label == "YTD":
        return date(end.year, 1, 1)
    if label == "ALL":
        first = (
            db.query(InvestmentActivity.trade_date)
            .filter(InvestmentActivity.account_id == account_id)
            .order_by(InvestmentActivity.trade_date.asc())
            .first()
        )
        return first[0] if first else end
    return end - timedelta(days=PERIODS[label])


def account_performance(db: Session, account_id: str, as_of: date | None = None) -> dict:
    """Valuation plus money-weighted and time-weighted returns per period."""
    end = as_of or date.today()

    holdings = load_holdings(db, [account_id])
    valuations = value_holdings(db, holdings, end)

    market_cents = sum(v["market_value_cents"] for v in valuations)
    cost_cents = sum(v["cost_basis_cents"] for v in valuations)

    activities = (
        db.query(InvestmentActivity)
        .filter(InvestmentActivity.account_id == account_id, InvestmentActivity.trade_date <= end)
        .order_by(InvestmentActivity.trade_date.asc())
        .all()
    )

    contributions_cents = sum(
        a.amount_cents for a in activities if a.type == InvestmentActivityType.CONTRIBUTION
    )
    withdrawals_cents = sum(
        -a.amount_cents for a in activities if a.type == InvestmentActivityType.WITHDRAWAL
    )
    net_invested_cents = contributions_cents - withdrawals_cents

    returns = {}
    for label in PERIODS:
        start = _period_start(db, account_id, label, end)

        # XIRR over external flows in the window, opened with the starting value
        # and closed with the ending value.
        opening = account_market_value_cents(db, account_id, start)
        window_flows: list[tuple[date, float]] = []
        if opening:
            window_flows.append((start, -opening / 100.0))
        for a in activities:
            if start < a.trade_date <= end and a.type.is_external_flow:
                window_flows.append((a.trade_date, -a.amount_cents / 100.0))
        if market_cents:
            window_flows.append((end, market_cents / 100.0))

        mwr = xirr(window_flows)
        twr = time_weighted_return(db, account_id, start, end)

        returns[label] = {
            "money_weighted": round(mwr * 100.0, 2) if mwr is not None else None,
            "time_weighted": round(twr * 100.0, 2) if twr is not None else None,
        }

    return {
        "account_id": account_id,
        "as_of": end,
        "market_value_cents": market_cents,
        "cost_basis_cents": cost_cents,
        "unrealized_gain_cents": market_cents - cost_cents,
        "contributions_cents": contributions_cents,
        "withdrawals_cents": withdrawals_cents,
        "net_invested_cents": net_invested_cents,
        # The question the net worth chart cannot answer on its own: how much of
        # the balance is money saved versus money earned.
        "market_growth_cents": market_cents - net_invested_cents,
        "holdings": valuations,
        "returns": returns,
        "unpriced_holdings": [v["symbol"] for v in valuations if not v["is_priced"]],
    }


# --------------------------------------------------------------------------
# Monthly return history (feeds the projection)
# --------------------------------------------------------------------------

MIN_MONTHS_FOR_STATS = 6


def _month_ends(first: date, last: date) -> list[date]:
    """Every month end from ``first``'s month up to ``last`` (``last`` itself closes the run)."""
    ends: list[date] = []
    cursor = date(first.year, first.month, 1)
    while True:
        next_first = date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
        month_end = next_first - timedelta(days=1)
        if month_end >= last:
            ends.append(last)
            return ends
        ends.append(month_end)
        cursor = next_first


def monthly_return_history(
    db: Session,
    account_id: str,
    end: date | None = None,
    max_months: int = 120,
) -> dict:
    """Month-end values and monthly returns of the account's *current* positions.

    Each month is valued with today's quantities at that month's last known
    prices, so contributions and withdrawals never show up as growth, and the
    volatility describes the portfolio the investor holds now. The summary
    statistics are drawn from monthly log returns; with fewer than
    ``MIN_MONTHS_FOR_STATS`` returns they are ``None``.
    """
    end = end or date.today()
    holdings = load_holdings(db, [account_id])
    security_ids = [h.security_id for h in holdings]

    first_price = None
    if security_ids:
        first_price = (
            db.query(func.min(PriceQuote.as_of_date))
            .filter(PriceQuote.security_id.in_(security_ids), PriceQuote.as_of_date <= end)
            .scalar()
        )

    points: list[dict] = []
    if first_price is not None:
        start = max(first_price, end - relativedelta(months=max_months))
        previous = None
        for month_end in _month_ends(start, end):
            value = sum(v["market_value_cents"] for v in value_holdings(db, holdings, month_end))
            ret = None
            if previous:
                ret = value / previous - 1.0
            points.append({"month": month_end, "value_cents": value, "return": ret})
            previous = value

    log_returns = [math.log1p(p["return"]) for p in points if p["return"] is not None and p["return"] > -1]

    mean = stdev = None
    if len(log_returns) >= MIN_MONTHS_FOR_STATS:
        mean = sum(log_returns) / len(log_returns)
        stdev = math.sqrt(sum((r - mean) ** 2 for r in log_returns) / (len(log_returns) - 1))

    # Recent saving habit: net external flows over the last year, per month.
    year_ago = end - timedelta(days=365)
    flows = (
        db.query(func.coalesce(func.sum(InvestmentActivity.amount_cents), 0))
        .filter(
            InvestmentActivity.account_id == account_id,
            InvestmentActivity.trade_date > year_ago,
            InvestmentActivity.trade_date <= end,
            InvestmentActivity.type.in_(
                [InvestmentActivityType.CONTRIBUTION, InvestmentActivityType.WITHDRAWAL]
            ),
        )
        .scalar()
    )

    return {
        "account_id": account_id,
        "as_of": end,
        "points": points,
        "months_of_history": len(log_returns),
        "mean_monthly_log_return": mean,
        "stdev_monthly_log_return": stdev,
        "annualized_return": math.expm1(12 * mean) if mean is not None else None,
        "annualized_volatility": stdev * math.sqrt(12) if stdev is not None else None,
        "average_monthly_contribution_cents": int(flows or 0) // 12,
    }
