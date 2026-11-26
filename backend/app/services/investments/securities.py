"""Finding the security a typed or imported symbol means."""
from sqlalchemy.orm import Session

from app.models.investment import AssetClass, Security
from app.services.investments.symbols import quote_candidates

# Uninvested cash in an account is held as a position in one of these, valued
# at par. The "$" prefix cannot be a ticker, so it never collides with a real
# listing such as the CASH.TO savings ETF.
CASH_SYMBOL_PREFIX = "$"


def cash_symbol(currency: str) -> str:
    return f"{CASH_SYMBOL_PREFIX}{currency.strip().upper()}"


def find_security(db: Session, symbol: str, currency: str | None = None) -> Security | None:
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


def get_or_create_security(
    db: Session,
    symbol: str,
    name: str | None = None,
    asset_class: AssetClass | None = None,
    currency: str | None = None,
) -> Security:
    symbol = symbol.strip().upper()
    security = find_security(db, symbol, currency)
    if security:
        if name and not security.name:
            security.name = name
        return security
    security = Security(symbol=symbol, name=name, currency=(currency or "CAD").upper())
    if asset_class is not None:
        security.asset_class = asset_class
    db.add(security)
    db.flush()
    return security


def get_or_create_cash_security(db: Session, currency: str) -> Security:
    """The par-valued cash security for one currency."""
    symbol = cash_symbol(currency)
    security = db.query(Security).filter(Security.symbol == symbol).first()
    if security is None:
        security = Security(
            symbol=symbol,
            name="Cash",
            currency=currency.strip().upper(),
            asset_class=AssetClass.CASH,
        )
        db.add(security)
        db.flush()
    return security
