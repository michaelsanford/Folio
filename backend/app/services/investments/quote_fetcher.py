"""Delayed market quotes from keyless public sources, and portfolio revaluation.

Sources, tried per security in order:

* **Yahoo Finance** chart endpoint (unofficial; TSX, TSX-V, US, crypto), with
  pre- and post-market prices for US listings.
* **TMX Money** quote endpoint (unofficial; the TSX operator's own data, about
  15 minutes delayed), for TSX and TSX-V listings when Yahoo does not answer.

Neither is an official API, so every failure is logged with the provider, the
symbol and the reason, and reported back per symbol. Quotes are fetched only
while a listing trades (see ``market_hours``), never more than once per
``REFRESH_FLOOR``, and a price typed in by hand is never overwritten.
"""
import logging
import math
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.core.money import from_cents, to_cents
from app.models.account import Account, AccountType
from app.models.investment import AssetClass, PriceQuote, QuoteSource, Security
from app.services.investments.market_hours import (
    default_timezone,
    has_extended_hours,
    should_fetch,
    trading_date,
)
from app.services.investments.performance import load_holdings, value_holdings
from app.services.investments.symbols import is_canadian_listing, quote_candidates, tmx_symbol
from app.services.snapshots.balance_history import record_snapshot

logger = logging.getLogger("folio.quote_fetcher")

BOC_VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1"
YAHOO_CHART_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=5m&range=1d&includePrePost=true"
)
TMX_GRAPHQL_URL = "https://app-money.tmx.com/graphql"
# Yahoo refuses requests without a browser User-Agent.
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
TMX_HEADERS = {
    "User-Agent": "Folio/1.0",
    "Accept": "application/json",
    "Referer": "https://money.tmx.com/",
    "Origin": "https://money.tmx.com",
}
TMX_QUERY = """query getQuoteBySymbol($symbol: String, $locale: String) {
  getQuoteBySymbol(symbol: $symbol, locale: $locale) {
    symbol name price prevClose exShortName datetime
  }
}"""

# The whole refresh must finish well inside the request budget. Quotes still
# outstanding at the deadline are reported as failed instead of holding the
# request open.
QUOTE_DEADLINE_SECONDS = 20.0
PER_REQUEST_TIMEOUT_SECONDS = 8.0
MAX_QUOTE_WORKERS = 8
# Repeated refreshes inside this window reuse the last fetch.
REFRESH_FLOOR = timedelta(minutes=10)

INVESTMENT_ACCOUNT_TYPES = {
    AccountType.INVESTMENT,
    AccountType.TFSA,
    AccountType.RRSP,
    AccountType.FHSA,
    AccountType.RESP,
    AccountType.RDSP,
    AccountType.RRIF,
    AccountType.LIRA,
    AccountType.LIF,
    AccountType.IPP,
    AccountType.NON_REGISTERED,
    AccountType.CRYPTO,
}

_client_lock = threading.Lock()
_http_client: httpx.Client | None = None


def get_http_client() -> httpx.Client:
    """One pooled HTTP client for the process (connection reuse; thread-safe)."""
    global _http_client
    if _http_client is None:
        with _client_lock:
            if _http_client is None:
                _http_client = httpx.Client(
                    headers=REQUEST_HEADERS,
                    timeout=PER_REQUEST_TIMEOUT_SECONDS,
                    limits=httpx.Limits(max_connections=MAX_QUOTE_WORKERS * 2),
                    follow_redirects=True,
                )
    return _http_client


def revalue_accounts(db: Session, as_of: date | None = None) -> tuple[int, list[str]]:
    """Revalues all investment accounts from their holdings' market value and records snapshots."""
    accounts = db.query(Account).filter(Account.type.in_(INVESTMENT_ACCOUNT_TYPES)).all()
    unpriced: list[str] = []
    revalued = 0
    if not accounts:
        db.commit()
        return 0, []

    # All holdings (with lots and securities) and all latest prices in a fixed
    # number of queries, instead of a holdings query per account plus a price
    # query per holding.
    holdings = load_holdings(db, [a.id for a in accounts])
    valuations = value_holdings(db, holdings, as_of)
    by_account: dict[str, list[dict]] = {}
    for holding, valuation in zip(holdings, valuations):
        by_account.setdefault(holding.account_id, []).append(valuation)

    for account in accounts:
        account_valuations = by_account.get(account.id)
        if not account_valuations:
            continue
        total = 0
        for valuation in account_valuations:
            total += valuation["market_value_cents"]
            if not valuation["is_priced"]:
                unpriced.append(valuation["symbol"])
        account.current_balance_cents = total
        record_snapshot(db, account.id, total, as_of)
        revalued += 1

    db.commit()
    return revalued, sorted(set(unpriced))


def fetch_boc_usdcad_rate(timeout: float = PER_REQUEST_TIMEOUT_SECONDS, client: httpx.Client | None = None) -> float | None:
    """Fetches the official Bank of Canada daily USD/CAD exchange rate."""
    try:
        resp = (client or get_http_client()).get(BOC_VALET_URL, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            observations = data.get("observations", [])
            if observations:
                latest = observations[-1]
                rate_str = latest.get("FXUSDCAD", {}).get("v")
                if rate_str:
                    return float(rate_str)
        else:
            logger.warning("Bank of Canada FX request returned HTTP %s", resp.status_code)
    except Exception as e:
        logger.warning(f"Could not fetch Bank of Canada FXUSDCAD rate: {e}")
    return None


# --------------------------------------------------------------------- providers

@dataclass
class Quote:
    """One delayed price from a provider."""

    symbol: str
    price: float
    source: str
    currency: str | None = None
    session: str = "REGULAR"
    quoted_at: datetime | None = None
    previous_close: float | None = None
    name: str | None = None
    exchange: str | None = None
    timezone: str | None = None


@dataclass
class QuoteResult:
    """What fetching one security produced: a quote, or why there is none."""

    quote: Quote | None = None
    # The listing that answered (``XEQT.TO`` for a typed ``XEQT``).
    resolved_symbol: str | None = None
    reasons: list[str] = field(default_factory=list)

    @property
    def reason(self) -> str:
        return "; ".join(self.reasons) or "no answer"


def _valid_price(value) -> float | None:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) and price > 0 else None


def _epoch(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def parse_yahoo_chart(symbol: str, data: dict) -> tuple[Quote | None, str | None]:
    """A Yahoo chart response -> Quote, marking pre/post-market prices as such."""
    chart = (data or {}).get("chart") or {}
    results = chart.get("result") or []
    if not results:
        error = chart.get("error") or {}
        return None, error.get("description") or "no data"
    result = results[0]
    meta = result.get("meta") or {}
    regular = _valid_price(meta.get("regularMarketPrice"))
    if regular is None:
        return None, "no price"

    quote = Quote(
        symbol=meta.get("symbol") or symbol,
        price=regular,
        source=QuoteSource.YAHOO.value,
        currency=meta.get("currency"),
        quoted_at=_epoch(meta.get("regularMarketTime")),
        previous_close=_valid_price(meta.get("chartPreviousClose") or meta.get("previousClose")),
        name=meta.get("longName") or meta.get("shortName"),
        exchange=meta.get("exchangeName"),
        timezone=meta.get("exchangeTimezoneName"),
    )

    if meta.get("hasPrePostMarketData"):
        # The latest candle tells whether trading is now outside the regular session.
        stamps = result.get("timestamp") or []
        closes = (((result.get("indicators") or {}).get("quote") or [{}])[0].get("close")) or []
        last = next(
            ((ts, c) for ts, c in zip(reversed(stamps), reversed(closes)) if _valid_price(c) is not None),
            None,
        )
        periods = meta.get("currentTradingPeriod") or {}
        if last is not None:
            ts, close = last
            for name, session in (("pre", "PRE"), ("post", "POST")):
                window = periods.get(name) or {}
                start, end = window.get("start"), window.get("end")
                if start is not None and end is not None and start <= ts < end:
                    quote.session = session
                    # Change is measured against the regular session's last price.
                    quote.previous_close = regular
                    quote.price = float(close)
                    quote.quoted_at = _epoch(ts)
                    break
    return quote, None


def fetch_yahoo_quote(
    symbol: str,
    timeout: float = PER_REQUEST_TIMEOUT_SECONDS,
    client: httpx.Client | None = None,
) -> tuple[Quote | None, str | None]:
    """Yahoo Finance delayed quote, or (None, reason)."""
    try:
        resp = (client or get_http_client()).get(YAHOO_CHART_URL.format(symbol=symbol), timeout=timeout)
    except Exception as e:
        logger.warning("Yahoo quote for %s failed: %s", symbol, e)
        return None, f"Yahoo: {type(e).__name__}"
    if resp.status_code == 404:
        return None, "not found"
    if resp.status_code != 200:
        logger.warning("Yahoo quote for %s returned HTTP %s", symbol, resp.status_code)
        return None, f"Yahoo: HTTP {resp.status_code}"
    try:
        quote, reason = parse_yahoo_chart(symbol, resp.json())
    except Exception as e:
        logger.warning("Yahoo quote for %s could not be read: %s", symbol, e)
        return None, "Yahoo: unreadable response"
    if quote is None:
        logger.info("Yahoo had no quote for %s: %s", symbol, reason)
    return quote, reason


def parse_tmx_quote(symbol: str, data: dict) -> tuple[Quote | None, str | None]:
    """A TMX Money ``getQuoteBySymbol`` response -> Quote."""
    node = ((data or {}).get("data") or {}).get("getQuoteBySymbol")
    if not node:
        errors = (data or {}).get("errors") or []
        return None, "not found" if any(str(e.get("code")) == "404" for e in errors) else "no data"
    price = _valid_price(node.get("price"))
    if price is None:
        return None, "no price"
    quoted_at = None
    if node.get("datetime"):
        try:
            quoted_at = datetime.fromisoformat(node["datetime"]).astimezone(timezone.utc)
        except ValueError:
            quoted_at = None
    return Quote(
        symbol=symbol,
        price=price,
        source=QuoteSource.TMX.value,
        currency="CAD",
        quoted_at=quoted_at,
        previous_close=_valid_price(node.get("prevClose")),
        name=node.get("name"),
        exchange=node.get("exShortName"),
        timezone="America/Toronto",
    ), None


def fetch_tmx_quote(
    symbol: str,
    timeout: float = PER_REQUEST_TIMEOUT_SECONDS,
    client: httpx.Client | None = None,
) -> tuple[Quote | None, str | None]:
    """TMX Money delayed quote for a TSX/TSX-V listing, or (None, reason)."""
    body = {
        "operationName": "getQuoteBySymbol",
        "variables": {"symbol": tmx_symbol(symbol), "locale": "en"},
        "query": TMX_QUERY,
    }
    try:
        resp = (client or get_http_client()).post(TMX_GRAPHQL_URL, json=body, headers=TMX_HEADERS, timeout=timeout)
    except Exception as e:
        logger.warning("TMX quote for %s failed: %s", symbol, e)
        return None, f"TMX: {type(e).__name__}"
    if resp.status_code != 200:
        logger.warning("TMX quote for %s returned HTTP %s", symbol, resp.status_code)
        return None, f"TMX: HTTP {resp.status_code}"
    try:
        return parse_tmx_quote(symbol, resp.json())
    except Exception as e:
        logger.warning("TMX quote for %s could not be read: %s", symbol, e)
        return None, "TMX: unreadable response"


def fetch_security_quote(
    candidates: list[str],
    timeout: float = PER_REQUEST_TIMEOUT_SECONDS,
    client: httpx.Client | None = None,
) -> QuoteResult:
    """Try each candidate listing on Yahoo, then TMX for Canadian ones."""
    result = QuoteResult()
    for symbol in candidates:
        # Module-level lookups at call time, so tests can patch the providers.
        quote, reason = fetch_yahoo_quote(symbol, timeout, client)
        if quote is not None:
            return QuoteResult(quote=quote, resolved_symbol=symbol)
        result.reasons.append(f"{symbol}: {reason}")
    for symbol in candidates:
        if not is_canadian_listing(symbol):
            continue
        quote, reason = fetch_tmx_quote(symbol, timeout, client)
        if quote is not None:
            return QuoteResult(quote=quote, resolved_symbol=symbol)
        result.reasons.append(f"{symbol} (TMX): {reason}")
    logger.warning("No quote for %s: %s", candidates[0] if candidates else "?", result.reason)
    return result


def fetch_quotes_concurrently(
    requests: dict[str, list[str]],
    deadline_seconds: float = QUOTE_DEADLINE_SECONDS,
    include_fx: bool = True,
) -> tuple[dict[str, QuoteResult], float | None, bool]:
    """Fetch quotes (and the BoC FX rate) in parallel under one overall deadline.

    ``requests`` maps a caller's key (a security id) to the listings to try.
    Returns ``(results_by_key, fx_rate, timed_out)``; keys still pending at the
    deadline are absent.
    """
    started = time.monotonic()
    per_call = min(PER_REQUEST_TIMEOUT_SECONDS, deadline_seconds)
    client = get_http_client()
    results: dict[str, QuoteResult] = {}
    fx_rate: float | None = None
    timed_out = False

    work = len(requests) + (1 if include_fx else 0)
    if work == 0:
        return results, fx_rate, False

    pool = ThreadPoolExecutor(max_workers=min(MAX_QUOTE_WORKERS, work), thread_name_prefix="quotes")
    try:
        futures = {
            pool.submit(fetch_security_quote, candidates, per_call, client): key
            for key, candidates in requests.items()
        }
        fx_future = pool.submit(fetch_boc_usdcad_rate, per_call, client) if include_fx else None
        pending = set(futures) | ({fx_future} if fx_future else set())
        while pending:
            remaining = deadline_seconds - (time.monotonic() - started)
            if remaining <= 0:
                timed_out = True
                break
            done, pending = wait(pending, timeout=remaining, return_when=FIRST_COMPLETED)
            for fut in done:
                try:
                    value = fut.result()
                except Exception as e:  # providers already swallow errors; belt and braces
                    logger.warning("Quote fetch failed: %s", e)
                    value = None
                if fut is fx_future:
                    fx_rate = value
                else:
                    results[futures[fut]] = value if isinstance(value, QuoteResult) else QuoteResult(
                        reasons=["unexpected error"]
                    )
        if pending:
            timed_out = True
            for fut in pending:
                fut.cancel()
    finally:
        # Never wait on stragglers: their HTTP timeout bounds them anyway.
        pool.shutdown(wait=False, cancel_futures=True)

    if timed_out:
        logger.warning(
            "Quote refresh hit its %.0f s deadline; %d of %d securities unanswered",
            deadline_seconds,
            len(requests) - len(results),
            len(requests),
        )
    return results, fx_rate, timed_out


# ----------------------------------------------------------------------- refresh

def _latest_quotes(db: Session, security_ids: list[str]) -> dict[str, PriceQuote]:
    """The most recent PriceQuote row per security, in one query."""
    if not security_ids:
        return {}
    latest = (
        db.query(PriceQuote.security_id.label("security_id"), func.max(PriceQuote.as_of_date).label("d"))
        .filter(PriceQuote.security_id.in_(security_ids))
        .group_by(PriceQuote.security_id)
        .subquery()
    )
    rows = (
        db.query(PriceQuote)
        .join(latest, and_(PriceQuote.security_id == latest.c.security_id, PriceQuote.as_of_date == latest.c.d))
        .all()
    )
    return {r.security_id: r for r in rows}


def _aware(moment: datetime | None) -> datetime | None:
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def update_quotes_for_securities(
    db: Session,
    symbols: list[str] | None = None,
    as_of: date | None = None,
    deadline_seconds: float = QUOTE_DEADLINE_SECONDS,
    now: datetime | None = None,
) -> dict:
    """Fetch delayed quotes for held securities, record them, and revalue accounts.

    A security is skipped when its market is closed and its close is already
    recorded, when it was fetched within ``REFRESH_FLOOR``, or when today's
    price was typed in by hand. Every skip and failure is reported by symbol.
    """
    now = _aware(now) or datetime.now(timezone.utc)
    query = db.query(Security)
    if symbols is not None:
        clean = [s.strip().upper() for s in symbols if s.strip()]
        query = query.filter(Security.symbol.in_(clean) | Security.quote_symbol.in_(clean))
    securities = query.all()

    latest = _latest_quotes(db, [s.id for s in securities])

    to_fetch: dict[str, list[str]] = {}
    skipped_closed: list[str] = []
    skipped_recent: list[str] = []
    skipped_manual: list[str] = []
    for sec in securities:
        if sec.asset_class == AssetClass.CASH:
            continue  # valued at par, never quoted
        candidates = [sec.quote_symbol] if sec.quote_symbol else quote_candidates(sec.symbol, sec.currency)
        if not candidates:
            continue
        listing = candidates[0]
        tz = sec.exchange_timezone or default_timezone(listing)
        extended = has_extended_hours(listing)
        today_there = trading_date(now, tz, now.date())
        row = latest.get(sec.id)

        if row is not None and row.source == QuoteSource.MANUAL.value and row.as_of_date >= today_there:
            skipped_manual.append(sec.symbol)
            continue
        last_fetched = _aware(row.fetched_at) if row is not None and row.source != QuoteSource.MANUAL.value else None
        if last_fetched is not None and now - last_fetched < REFRESH_FLOOR:
            skipped_recent.append(sec.symbol)
            continue
        if not should_fetch(now, tz, extended, last_fetched):
            skipped_closed.append(sec.symbol)
            continue
        to_fetch[sec.id] = candidates

    results, fx_rate, timed_out = fetch_quotes_concurrently(to_fetch, deadline_seconds=deadline_seconds)

    by_id = {s.id: s for s in securities}
    updated: list[dict] = []
    failures: list[dict] = []
    for sec_id in to_fetch:
        sec = by_id[sec_id]
        result = results.get(sec_id)
        if result is None:
            failures.append({"symbol": sec.symbol, "reason": "timed out"})
            continue
        quote = result.quote
        if quote is None:
            failures.append({"symbol": sec.symbol, "reason": result.reason})
            continue

        # Remember the listing that answered, and its exchange.
        sec.quote_symbol = result.resolved_symbol
        sec.exchange_timezone = quote.timezone or sec.exchange_timezone or default_timezone(result.resolved_symbol)
        sec.exchange = quote.exchange or sec.exchange
        if not sec.name and quote.name:
            sec.name = quote.name

        quote_date = as_of or trading_date(quote.quoted_at, sec.exchange_timezone, now.date())
        row = (
            db.query(PriceQuote)
            .filter(PriceQuote.security_id == sec.id, PriceQuote.as_of_date == quote_date)
            .first()
        )
        if row is not None and row.source == QuoteSource.MANUAL.value:
            skipped_manual.append(sec.symbol)
            continue
        if row is None:
            row = PriceQuote(security_id=sec.id, as_of_date=quote_date)
            db.add(row)
        row.price_cents = to_cents(quote.price)
        row.source = quote.source
        row.session = quote.session
        row.quoted_at = quote.quoted_at
        row.fetched_at = now
        row.previous_close_cents = to_cents(quote.previous_close) if quote.previous_close else None

        updated.append({
            "symbol": sec.symbol,
            "listing": result.resolved_symbol,
            "price": float(from_cents(row.price_cents)),
            "currency": quote.currency or sec.currency or "CAD",
            "as_of_date": quote_date.isoformat(),
            "source": quote.source,
            "session": quote.session,
            "quoted_at": quote.quoted_at.isoformat() if quote.quoted_at else None,
            "previous_close": quote.previous_close,
        })

    db.commit()

    # Revalue all investment accounts to update balances and balance snapshots
    accounts_revalued, _ = revalue_accounts(db=db, as_of=as_of)

    skipped = sorted(set(skipped_closed + skipped_recent + skipped_manual))
    return {
        "updated_count": len(updated),
        "failed_count": len(failures),
        "quotes": updated,
        "failed_symbols": [f["symbol"] for f in failures],
        "failures": failures,
        "usdcad_fx_rate": fx_rate,
        "accounts_revalued": accounts_revalued,
        "skipped_count": len(skipped),
        "skipped_symbols": skipped,
        "skipped_closed": sorted(skipped_closed),
        "skipped_recent": sorted(skipped_recent),
        "skipped_manual": sorted(set(skipped_manual)),
        "timed_out": timed_out,
        "refreshed_at": now.isoformat(),
    }


def lookup_listing(
    query: str,
    currency: str | None = "CAD",
    timeout: float = PER_REQUEST_TIMEOUT_SECONDS,
) -> QuoteResult:
    """Resolve what a typed symbol means, for the Add holding preview."""
    candidates = quote_candidates(query, currency)
    if not candidates:
        return QuoteResult(reasons=["empty symbol"])
    return fetch_security_quote(candidates, timeout, get_http_client())
