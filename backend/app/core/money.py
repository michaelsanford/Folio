"""Money as integer minor units.

Every amount used to be a SQLAlchemy ``Float``. Balances are derived by summing
transaction rows, so binary floating-point error accumulated silently across
reconciliation, budget actuals, and amortization -- the one place a finance app
cannot afford it. Amounts are now stored as integer cents and converted to
``Decimal`` dollars at the API boundary, so the wire format and the frontend
contract are unchanged.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

CENTS_PER_UNIT = 100
_QUANT = Decimal("0.01")

# Integer minor units. Named for intent at call sites and in model definitions.
Cents = Annotated[int, "integer minor currency units"]


def to_cents(value: Decimal | float | int | str | None) -> int:
    """Convert a dollar amount to integer cents, half-up at the half-cent.

    ``float`` input is routed through ``str`` so that a value like 19.47, which
    has no exact binary representation, quantizes from its decimal literal rather
    than from 19.469999999999998863.
    """
    if value is None:
        return 0
    if isinstance(value, int) and not isinstance(value, bool):
        return value * CENTS_PER_UNIT
    if isinstance(value, Decimal):
        dec = value
    else:
        dec = Decimal(str(value))
    return int((dec * CENTS_PER_UNIT).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def from_cents(cents: int | None) -> Decimal:
    """Convert integer cents back to a two-place Decimal dollar amount."""
    if cents is None:
        return Decimal("0.00")
    return (Decimal(cents) / CENTS_PER_UNIT).quantize(_QUANT)


def to_cents_optional(value: Decimal | float | int | str | None) -> int | None:
    """Like :func:`to_cents` but preserves None, for nullable columns."""
    return None if value is None else to_cents(value)


def from_cents_optional(cents: int | None) -> Decimal | None:
    """Like :func:`from_cents` but preserves None, for nullable columns."""
    return None if cents is None else from_cents(cents)


def format_cents(cents: int | None, symbol: str = "$") -> str:
    """Human-readable rendering, for log and error messages."""
    return f"{symbol}{from_cents(cents):,.2f}"
