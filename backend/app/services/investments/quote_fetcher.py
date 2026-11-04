import logging
from datetime import date
import httpx
from sqlalchemy.orm import Session
from app.core.money import to_cents, from_cents
from app.models.account import Account, AccountType
from app.models.investment import Holding, PriceQuote, Security
from app.services.investments.performance import holding_valuation
from app.services.snapshots.balance_history import record_snapshot

logger = logging.getLogger("folio.quote_fetcher")

BOC_VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d"
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

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


def revalue_accounts(db: Session, as_of: date | None = None) -> tuple[int, list[str]]:
    """Revalues all investment accounts from their holdings' market value and records snapshots."""
    accounts = db.query(Account).filter(Account.type.in_(INVESTMENT_ACCOUNT_TYPES)).all()
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
    return revalued, sorted(set(unpriced))


def fetch_boc_usdcad_rate(timeout: float = 8.0) -> float | None:
    """Fetches the official Bank of Canada daily USD/CAD exchange rate."""
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(BOC_VALET_URL, headers=REQUEST_HEADERS)
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


def fetch_single_quote(symbol: str, timeout: float = 8.0) -> tuple[float | None, str | None]:
    """
    Fetches the latest market price for a symbol via public market endpoint.
    Returns (price, currency). Supports TSX (.TO), TSX-V (.V), US tickers, and Crypto.
    """
    clean_sym = symbol.strip().upper()
    url = YAHOO_CHART_URL.format(symbol=clean_sym)
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=REQUEST_HEADERS)
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


def update_quotes_for_securities(
    db: Session,
    symbols: list[str] | None = None,
    as_of: date | None = None,
) -> dict:
    """
    Automated quote update: fetches quotes for all active or specified securities,
    records PriceQuote entries in exact cents, and triggers portfolio revaluation.
    """
    as_of_date = as_of or date.today()
    if symbols is None:
        securities = db.query(Security).all()
    else:
        clean_symbols = [s.strip().upper() for s in symbols if s.strip()]
        securities = db.query(Security).filter(Security.symbol.in_(clean_symbols)).all()

    updated: list[dict] = []
    failed: list[str] = []

    # Also fetch Bank of Canada FX rate for reference
    fx_rate = fetch_boc_usdcad_rate()

    for sec in securities:
        price, cur = fetch_single_quote(sec.symbol)
        if price is None or price <= 0:
            failed.append(sec.symbol)
            continue

        price_cents = to_cents(price)
        quote = (
            db.query(PriceQuote)
            .filter(PriceQuote.security_id == sec.id, PriceQuote.as_of_date == as_of_date)
            .first()
        )
        if quote:
            quote.price_cents = price_cents
        else:
            quote = PriceQuote(security_id=sec.id, as_of_date=as_of_date, price_cents=price_cents)
            db.add(quote)

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
    }
