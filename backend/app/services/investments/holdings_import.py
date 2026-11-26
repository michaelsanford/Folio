"""Bring an investment account in line with a broker holdings export.

The export is a snapshot, so the import sets each position to what the file
says rather than adding to it:

- a position that already matches (same quantity and book cost) is left alone,
  so its lots keep their real trade dates;
- any other position gets one lot dated the export day, at the file's book cost;
- the file's last prices are recorded for that day (a fetched or hand-typed
  price for the day is kept), and later refreshes take over;
- the account's uninvested cash becomes a par-valued cash position;
- positions the file does not mention are removed only when the person ticks them.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

from sqlalchemy.orm import Session

from app.core.money import from_cents, to_cents
from app.models.account import Account
from app.models.investment import AssetClass, Holding, Lot, PriceQuote, QuoteSource
from app.schemas.ingestion import (
    HoldingsCashLine,
    HoldingsCommitPosition,
    HoldingsComparison,
    HoldingsMissingPosition,
    HoldingsPositionPreview,
)
from app.services.ingestion.holdings_parser import ParsedHoldingsFile
from app.services.investments.performance import (
    load_holdings,
    open_cost_basis_cents,
    open_quantity,
    value_holdings,
)
from app.services.investments.securities import (
    find_security,
    get_or_create_cash_security,
    get_or_create_security,
)

_CENT = Decimal("0.01")


def positions_from_file(parsed: ParsedHoldingsFile) -> list[HoldingsCommitPosition]:
    return [
        HoldingsCommitPosition(
            symbol=p.symbol,
            name=p.name,
            asset_class=p.asset_class,
            currency=p.currency,
            quantity=p.quantity,
            book_cost=p.book_cost,
            last_price=p.last_price,
            previous_close=p.previous_close,
            market_value=p.market_value,
        )
        for p in parsed.positions
    ]


def cash_from_file(parsed: ParsedHoldingsFile) -> list[HoldingsCashLine]:
    return [
        HoldingsCashLine(currency=c.currency, amount=float(c.amount), rate_to_cad=float(c.rate_to_cad))
        for c in parsed.cash
    ]


def _convert_cash(cash: Iterable[HoldingsCashLine], currency: str) -> tuple[list[HoldingsCashLine], Decimal]:
    """Each cash line in ``currency``, at the file's own exchange rates."""
    lines = list(cash)
    currency = currency.upper()
    target = Decimal(1) if currency == "CAD" else next(
        (Decimal(str(c.rate_to_cad)) for c in lines if c.currency.upper() == currency and c.rate_to_cad), Decimal(1)
    )
    out: list[HoldingsCashLine] = []
    total = Decimal(0)
    for c in lines:
        rate = Decimal(1) if c.currency.upper() == currency else Decimal(str(c.rate_to_cad or 1)) / target
        converted = (Decimal(str(c.amount)) * rate).quantize(_CENT)
        total += converted
        out.append(
            HoldingsCashLine(
                currency=c.currency.upper(),
                amount=c.amount,
                rate_to_cad=c.rate_to_cad,
                rate_to_account=float(rate),
                amount_in_account_currency=float(converted),
            )
        )
    return out, total


def _value_cents(position: HoldingsCommitPosition) -> int:
    """What Folio will value the position at: quantity times the price to the cent."""
    if position.last_price is None:
        return to_cents(position.book_cost)
    return int((Decimal(to_cents(position.last_price)) * position.quantity).to_integral_value())


@dataclass
class _Current:
    holding: Holding
    quantity: Decimal
    cost_cents: int


def _current_holdings(db: Session, account: Account | None) -> dict[str, _Current]:
    if account is None or not account.id:
        return {}
    return {
        h.security_id: _Current(h, open_quantity(h), open_cost_basis_cents(h))
        for h in load_holdings(db, [account.id])
    }


def _matches(current: _Current | None, quantity: Decimal, book_cost: Decimal) -> bool:
    return current is not None and current.quantity == quantity and current.cost_cents == to_cents(book_cost)


def compare_holdings(
    db: Session,
    account: Account | None,
    currency: str,
    positions: list[HoldingsCommitPosition],
    cash: Iterable[HoldingsCashLine],
    file_total: float | None,
) -> HoldingsComparison:
    """Line the file's positions up with what ``account`` holds now (None: a new account)."""
    current = _current_holdings(db, account)
    cash_lines, cash_total = _convert_cash(cash, currency)

    matched: set[str] = set()
    previews: list[HoldingsPositionPreview] = []
    total_cents = to_cents(cash_total)
    for p in positions:
        security = find_security(db, p.symbol, p.currency) if current else None
        existing = current.get(security.id) if security is not None else None
        if existing is not None:
            matched.add(security.id)
        status = "NEW" if existing is None else ("UNCHANGED" if _matches(existing, p.quantity, p.book_cost) else "CHANGED")
        value_cents = _value_cents(p)
        total_cents += value_cents
        previews.append(
            HoldingsPositionPreview(
                symbol=p.symbol,
                name=p.name,
                asset_class=p.asset_class,
                currency=p.currency,
                quantity=p.quantity,
                book_cost=float(p.book_cost),
                market_value=float(p.market_value if p.market_value is not None else from_cents(value_cents)),
                last_price=float(p.last_price) if p.last_price is not None else None,
                previous_close=float(p.previous_close) if p.previous_close is not None else None,
                status=status,
                current_quantity=existing.quantity if existing is not None and status == "CHANGED" else None,
                current_book_cost=(
                    float(from_cents(existing.cost_cents)) if existing is not None and status == "CHANGED" else None
                ),
            )
        )

    leftovers = [
        c.holding for sid, c in current.items()
        if sid not in matched and c.holding.security is not None and c.holding.security.asset_class != AssetClass.CASH
    ]
    missing = [
        HoldingsMissingPosition(
            holding_id=v["holding_id"],
            symbol=v["symbol"],
            name=v["name"],
            quantity=v["quantity"],
            market_value=float(from_cents(v["market_value_cents"])),
        )
        for v in value_holdings(db, leftovers)
    ]

    return HoldingsComparison(
        account_id=account.id if account is not None else None,
        account_currency=currency.upper(),
        positions=previews,
        cash=cash_lines,
        cash_total=float(cash_total),
        missing=missing,
        import_total=float(from_cents(total_cents)),
        file_total=file_total,
    )


@dataclass
class HoldingsImportResult:
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    removed: int = 0
    cash_total: Decimal = Decimal(0)


def _replace_lots(holding: Holding, as_of: date, quantity: Decimal, cost_cents: int) -> None:
    holding.lots.clear()  # delete-orphan removes the old lots
    holding.lots.append(Lot(trade_date=as_of, quantity=quantity, cost_basis_cents=cost_cents, fee_cents=0))


def _record_import_price(db: Session, security_id: str, as_of: date, position: HoldingsCommitPosition) -> None:
    """The file's last price for the day, unless a typed or fetched price is already there."""
    if position.last_price is None:
        return
    quote = (
        db.query(PriceQuote)
        .filter(PriceQuote.security_id == security_id, PriceQuote.as_of_date == as_of)
        .first()
    )
    if quote is not None and quote.source != QuoteSource.IMPORT.value:
        return
    if quote is None:
        quote = PriceQuote(security_id=security_id, as_of_date=as_of)
        db.add(quote)
    quote.price_cents = to_cents(position.last_price)
    quote.source = QuoteSource.IMPORT.value
    quote.session = None
    quote.quoted_at = None
    quote.fetched_at = None
    quote.previous_close_cents = to_cents(position.previous_close) if position.previous_close else None


def apply_holdings(
    db: Session,
    account: Account,
    as_of: date,
    positions: list[HoldingsCommitPosition],
    cash_total: Decimal,
    remove_holding_ids: Iterable[str],
) -> HoldingsImportResult:
    """Write the snapshot into ``account``. The caller commits."""
    result = HoldingsImportResult(cash_total=cash_total.quantize(_CENT))
    current = _current_holdings(db, account)

    # The same security listed twice (two rows for one fund) is one position.
    merged: dict[str, tuple[HoldingsCommitPosition, Decimal, Decimal]] = {}
    for p in positions:
        security = get_or_create_security(db, p.symbol, p.name, p.asset_class, currency=p.currency)
        if security.id in merged:
            first, qty, cost = merged[security.id]
            merged[security.id] = (first, qty + p.quantity, cost + p.book_cost)
        else:
            merged[security.id] = (p, p.quantity, p.book_cost)

    for security_id, (p, quantity, book_cost) in merged.items():
        existing = current.get(security_id)
        if existing is None:
            holding = Holding(account_id=account.id, security_id=security_id)
            db.add(holding)
            _replace_lots(holding, as_of, quantity, to_cents(book_cost))
            result.added += 1
        elif _matches(existing, quantity, book_cost):
            result.unchanged += 1
        else:
            _replace_lots(existing.holding, as_of, quantity, to_cents(book_cost))
            result.updated += 1
        _record_import_price(db, security_id, as_of, p)

    cash_security = get_or_create_cash_security(db, account.currency or "CAD")
    cash_holding = current.get(cash_security.id)
    if result.cash_total > 0:
        if cash_holding is None:
            holding = Holding(account_id=account.id, security_id=cash_security.id)
            db.add(holding)
            _replace_lots(holding, as_of, result.cash_total, to_cents(result.cash_total))
        elif not _matches(cash_holding, result.cash_total, result.cash_total):
            _replace_lots(cash_holding.holding, as_of, result.cash_total, to_cents(result.cash_total))
    elif cash_holding is not None:
        db.delete(cash_holding.holding)

    ids = {i for i in remove_holding_ids if i}
    if ids:
        for c in current.values():
            if c.holding.id in ids and c.holding.security_id not in merged:
                db.delete(c.holding)
                result.removed += 1

    db.flush()
    return result
