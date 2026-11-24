import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import date

import httpx
from sqlalchemy.orm import Session

from app.core.money import from_cents, to_cents
from app.models.account import Account, AccountType
from app.models.investment import PriceQuote, Security
from app.services.investments.performance import load_holdings, value_holdings
from app.services.snapshots.balance_history import record_snapshot

logger = logging.getLogger("folio.quote_fetcher")

BOC_VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# The whole refresh must finish well inside the request budget. Quotes still
# outstanding at the deadline are reported as failed instead of holding the
# request open (sequential fetches at 8 s each used to stack up per symbol).
QUOTE_DEADLINE_SECONDS = 20.0
PER_REQUEST_TIMEOUT_SECONDS = 8.0
MAX_QUOTE_WORKERS = 8

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
    except Exception as e:
        logger.warning(f"Could not fetch Bank of Canada FXUSDCAD rate: {e}")
    return None


def fetch_single_quote(
    symbol: str,
    timeout: float = PER_REQUEST_TIMEOUT_SECONDS,
    client: httpx.Client | None = None,
) -> tuple[float | None, str | None]:
    """
    Fetches the latest market price for a symbol via public market endpoint.
    Returns (price, currency). Supports TSX (.TO), TSX-V (.V), US tickers, and Crypto.
    """
    clean_sym = symbol.strip().upper()
    url = YAHOO_CHART_URL.format(symbol=clean_sym)
    try:
        resp = (client or get_http_client()).get(url, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("chart", {}).get("result", [])
            if result:
                meta = result[0].get("meta", {})
                price = meta.get("regularMarketPrice")
                currency = meta.get("currency", "CAD")
                if price is not None:
                    return float(price), currency
    except Exception as e:
        logger.warning(f"Failed to fetch market quote for {symbol}: {e}")
    return None, None


def fetch_quotes_concurrently(
    symbols: list[str],
    deadline_seconds: float = QUOTE_DEADLINE_SECONDS,
    include_fx: bool = True,
) -> tuple[dict[str, tuple[float | None, str | None]], float | None, bool]:
    """Fetch quotes (and the BoC FX rate) in parallel under one overall deadline.

    Returns ``(quotes_by_symbol, fx_rate, timed_out)``. Symbols still pending at
    the deadline are absent from ``quotes_by_symbol``.
    """
    started = time.monotonic()
    per_call = min(PER_REQUEST_TIMEOUT_SECONDS, deadline_seconds)
    client = get_http_client()
    results: dict[str, tuple[float | None, str | None]] = {}
    fx_rate: float | None = None
    timed_out = False

    work = len(symbols) + (1 if include_fx else 0)
    if work == 0:
        return results, fx_rate, False

    pool = ThreadPoolExecutor(max_workers=min(MAX_QUOTE_WORKERS, work), thread_name_prefix="quotes")
    try:
        # Module-level lookups at call time, so tests can patch the fetchers.
        futures = {pool.submit(fetch_single_quote, sym, per_call, client): sym for sym in symbols}
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
                except Exception as e:  # fetchers already swallow errors; belt and braces
                    logger.warning("Quote fetch failed: %s", e)
                    value = None
                if fut is fx_future:
                    fx_rate = value
                else:
                    results[futures[fut]] = value if value is not None else (None, None)
        if pending:
            timed_out = True
            for fut in pending:
                fut.cancel()
    finally:
        # Never wait on stragglers: their HTTP timeout bounds them anyway.
        pool.shutdown(wait=False, cancel_futures=True)

    if timed_out:
        logger.warning(
            "Quote refresh hit its %.0f s deadline; %d of %d symbols unanswered",
            deadline_seconds,
            len(symbols) - len(results),
            len(symbols),
        )
    return results, fx_rate, timed_out


def update_quotes_for_securities(
    db: Session,
    symbols: list[str] | None = None,
    as_of: date | None = None,
    deadline_seconds: float = QUOTE_DEADLINE_SECONDS,
) -> dict:
    """
    Automated quote update: fetches quotes for all active or specified securities,
    records PriceQuote entries in exact cents, and triggers portfolio revaluation.

    Securities that already have a quote for the date are not fetched again.
    """
    as_of_date = as_of or date.today()
    if symbols is None:
        securities = db.query(Security).all()
    else:
        clean_symbols = [s.strip().upper() for s in symbols if s.strip()]
        securities = db.query(Security).filter(Security.symbol.in_(clean_symbols)).all()

    already_quoted = {
        row[0]
        for row in db.query(PriceQuote.security_id)
        .filter(
            PriceQuote.as_of_date == as_of_date,
            PriceQuote.security_id.in_([sec.id for sec in securities]),
        )
        .all()
    } if securities else set()

    to_fetch = [sec for sec in securities if sec.id not in already_quoted]
    skipped = sorted(sec.symbol for sec in securities if sec.id in already_quoted)

    quotes, fx_rate, timed_out = fetch_quotes_concurrently(
        [sec.symbol for sec in to_fetch], deadline_seconds=deadline_seconds
    )

    updated: list[dict] = []
    failed: list[str] = []
    for sec in to_fetch:
        price, cur = quotes.get(sec.symbol, (None, None))
        if price is None or price <= 0:
            failed.append(sec.symbol)
            continue

        price_cents = to_cents(price)
        db.add(PriceQuote(security_id=sec.id, as_of_date=as_of_date, price_cents=price_cents))
        updated.append({
            "symbol": sec.symbol,
            "price": float(from_cents(price_cents)),
            "currency": cur or sec.currency or "CAD",
            "as_of_date": as_of_date.isoformat(),
        })

    db.commit()

    # Revalue all investment accounts to update balances and balance snapshots
    accounts_revalued, _ = revalue_accounts(db=db, as_of=as_of_date)

    return {
        "updated_count": len(updated),
        "failed_count": len(failed),
        "quotes": updated,
        "failed_symbols": failed,
        "usdcad_fx_rate": fx_rate,
        "accounts_revalued": accounts_revalued,
        "skipped_count": len(skipped),
        "skipped_symbols": skipped,
        "timed_out": timed_out,
    }
