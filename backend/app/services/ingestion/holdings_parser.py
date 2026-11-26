"""Broker holdings exports: what an investment account holds on one day.

A holdings export is a snapshot rather than a statement: no dated rows, but
each position's quantity, book cost and last price, plus the account's cash.
RBC Direct Investing's export, for example, wraps a few CSV sections in a
title line, an ``Account:`` line and pages of disclaimers::

    "Holdings Export as of Nov 26, 2026 4:03:51 PM ET"
    Account: 12345678 - TFSA
    ,Trailing 12 Mo Return,...,Combined Total in CAD,Combined Total in USD
    Currency,Cash,Investments,Total,Exchange Rate to CAD
    ,Product,Symbol,Name,Quantity,Last Price,Currency,Change $,...

Sections are found by their header rows, so extra or reordered columns and
the surrounding text do not matter.
"""
import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from app.models.investment import AssetClass
from app.schemas.ingestion import ParsedRowError
from app.services.ingestion.preview_common import row_error

_TITLE_RE = re.compile(r"holdings\s+export\s+as\s+of\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})", re.IGNORECASE)
_ACCOUNT_RE = re.compile(r"^\s*account\s*:\s*([^-]+?)\s*(?:-\s*(.+?))?\s*$", re.IGNORECASE)
_REQUIRED_POSITION_COLUMNS = ("symbol", "quantity", "total book cost", "total market value")


@dataclass
class CashBalance:
    currency: str
    amount: Decimal
    rate_to_cad: Decimal


@dataclass
class ParsedPosition:
    row_number: int
    symbol: str
    name: str | None
    asset_class: AssetClass
    currency: str
    quantity: Decimal
    book_cost: Decimal
    market_value: Decimal
    last_price: Decimal | None
    previous_close: Decimal | None


@dataclass
class ParsedHoldingsFile:
    as_of_date: date | None = None
    account_number: str | None = None
    account_label: str | None = None
    combined_total_cad: Decimal | None = None
    cash: list[CashBalance] = field(default_factory=list)
    positions: list[ParsedPosition] = field(default_factory=list)
    row_errors: list[ParsedRowError] = field(default_factory=list)

    def rate_to_cad(self, currency: str) -> Decimal | None:
        currency = currency.upper()
        if currency == "CAD":
            return Decimal(1)
        for c in self.cash:
            if c.currency == currency and c.rate_to_cad:
                return c.rate_to_cad
        return None

    def cash_in(self, currency: str) -> Decimal:
        """All cash in the file, converted into ``currency`` at the file's own rates."""
        target_rate = self.rate_to_cad(currency) or Decimal(1)
        total = Decimal(0)
        for c in self.cash:
            rate = Decimal(1) if c.currency == currency.upper() else (c.rate_to_cad or Decimal(1)) / target_rate
            total += c.amount * rate
        return total.quantize(Decimal("0.01"))


def _norm(cell: str | None) -> str:
    return (cell or "").strip().strip('"').strip().lower()


def _decimal(raw: str | None) -> Decimal | None:
    """``"1,234.50"``, ``"-9.5%"``, ``"$12"`` -> Decimal; blank or unreadable -> None."""
    if raw is None:
        return None
    cleaned = re.sub(r"[\s$,%\"]", "", raw)
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    if not cleaned or cleaned in {"-", "N/A", "n/a"}:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _asset_class(product: str | None) -> AssetClass:
    p = _norm(product)
    if "etf" in p or "etn" in p:
        return AssetClass.ETF
    if "mutual" in p or "fund" in p:
        return AssetClass.MUTUAL_FUND
    if any(k in p for k in ("bond", "gic", "fixed", "debenture", "strip", "t-bill", "treasury")):
        return AssetClass.FIXED_INCOME
    if "crypto" in p:
        return AssetClass.CRYPTO
    if "share" in p or "stock" in p or "equit" in p:
        return AssetClass.EQUITY
    return AssetClass.OTHER


def _rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def _is_position_header(cells: list[str]) -> bool:
    names = {_norm(c) for c in cells}
    return all(col in names for col in _REQUIRED_POSITION_COLUMNS)


def looks_like_holdings_export(text: str) -> bool:
    """True for a holdings snapshot rather than a list of transactions."""
    head = text[:4000]
    if not _TITLE_RE.search(head) and "holdings" not in head.lower():
        return False
    return any(_is_position_header(r) for r in _rows(text))


def _parse_title_date(text: str) -> date | None:
    m = _TITLE_RE.search(text[:4000])
    if not m:
        return None
    raw = m.group(1).replace(".", "")
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_holdings_export(text: str) -> ParsedHoldingsFile:
    parsed = ParsedHoldingsFile(as_of_date=_parse_title_date(text))
    rows = _rows(text)

    i = 0
    while i < len(rows):
        cells = rows[i]
        first = _norm(cells[0]) if cells else ""

        if first.startswith("account") and parsed.account_number is None:
            m = _ACCOUNT_RE.match(cells[0] if len(cells) == 1 else ",".join(cells))
            if m:
                parsed.account_number = m.group(1).strip()
                parsed.account_label = (m.group(2) or "").strip() or None

        names = [_norm(c) for c in cells]

        if "combined total in cad" in names and i + 1 < len(rows):
            values = rows[i + 1]
            idx = names.index("combined total in cad")
            if idx < len(values):
                parsed.combined_total_cad = _decimal(values[idx])
            i += 2
            continue

        if names[:2] == ["currency", "cash"]:
            rate_idx = next((k for k, n in enumerate(names) if n.startswith("exchange rate")), None)
            i += 1
            while i < len(rows) and rows[i] and any(c.strip() for c in rows[i]):
                r = rows[i]
                currency = r[0].strip().upper()
                amount = _decimal(r[1]) if len(r) > 1 else None
                rate = _decimal(r[rate_idx]) if rate_idx is not None and rate_idx < len(r) else None
                if re.fullmatch(r"[A-Z]{3}", currency) and amount is not None:
                    parsed.cash.append(CashBalance(currency, amount, rate or Decimal(1)))
                i += 1
            continue

        if _is_position_header(cells):
            col = {n: k for k, n in enumerate(names) if n}
            i += 1
            while i < len(rows) and rows[i] and any(c.strip() for c in rows[i]):
                _parse_position(parsed, rows[i], col, i + 1)
                i += 1
            continue

        i += 1

    return parsed


def _cell(row: list[str], col: dict[str, int], name: str) -> str | None:
    k = col.get(name)
    return row[k] if k is not None and k < len(row) else None


def _parse_position(parsed: ParsedHoldingsFile, row: list[str], col: dict[str, int], row_number: int) -> None:
    symbol = (_cell(row, col, "symbol") or "").strip().upper()
    if not symbol:
        return
    quantity = _decimal(_cell(row, col, "quantity"))
    if quantity is None or quantity <= 0:
        parsed.row_errors.append(
            row_error(row_number, "quantity", _cell(row, col, "quantity"), f"{symbol}: the quantity could not be read")
        )
        return
    market_value = _decimal(_cell(row, col, "total market value"))
    last_price = _decimal(_cell(row, col, "last price"))
    if market_value is None and last_price is not None:
        market_value = (last_price * quantity).quantize(Decimal("0.01"))
    if market_value is None:
        parsed.row_errors.append(
            row_error(row_number, "total market value", _cell(row, col, "total market value"),
                      f"{symbol}: the market value could not be read")
        )
        return
    # A book cost the broker cannot determine is blank; RBC itself falls back
    # to market value in that case, and so does the import.
    book_cost = _decimal(_cell(row, col, "total book cost"))
    if book_cost is None:
        book_cost = market_value
    change = _decimal(_cell(row, col, "change $"))
    previous_close = last_price - change if last_price is not None and change is not None else None
    currency = (_cell(row, col, "currency") or "CAD").strip().upper() or "CAD"
    name = (_cell(row, col, "name") or "").strip() or None

    parsed.positions.append(
        ParsedPosition(
            row_number=row_number,
            symbol=symbol,
            name=name[:200] if name else None,
            asset_class=_asset_class(_cell(row, col, "product")),
            currency=currency if re.fullmatch(r"[A-Z]{3}", currency) else "CAD",
            quantity=quantity,
            book_cost=book_cost,
            market_value=market_value,
            last_price=last_price,
            previous_close=previous_close if previous_close is not None and previous_close > 0 else None,
        )
    )
