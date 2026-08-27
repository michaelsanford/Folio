"""Investment valuation and return calculation.

Two different returns are reported because they answer two different questions:

* **Money-weighted (XIRR)** -- what did *this investor* earn, given when they put
  money in? Deposit timing changes it, which is the point.
* **Time-weighted (TWR)** -- how did the *investments* perform, independent of
  deposit timing? This is the number comparable to a benchmark.

Reporting only one of them is how personal-finance tools mislead people: a large
contribution just before a rally flatters MWR while TWR is unchanged.
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

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


def holding_valuation(db: Session, holding: Holding, as_of: date | None = None) -> dict:
    """Market value, cost basis, and unrealized gain for one position."""
    quantity = open_quantity(holding)
    cost_cents = open_cost_basis_cents(holding)
    price_cents, price_date = latest_price_cents(db, holding.security_id, as_of)

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
    holdings = db.query(Holding).filter(Holding.account_id == account_id).all()
    return sum(holding_valuation(db, h, as_of)["market_value_cents"] for h in holdings)


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

    holdings = db.query(Holding).filter(Holding.account_id == account_id).all()
    valuations = [holding_valuation(db, h, end) for h in holdings]

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
