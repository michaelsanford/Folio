"""Which exchange listing a typed symbol means.

People type ``XEQT``; the quote sources need ``XEQT.TO`` (Yahoo) or ``XEQT``
on the TSX (TMX). An unsuffixed symbol means a US listing to Yahoo, so a
Canadian ETF typed without its suffix used to match nothing.
"""

# Exchange suffixes Yahoo uses for Canadian listings.
CANADIAN_SUFFIXES = ("TO", "V", "NE", "CN")
_KNOWN_SUFFIXES = set(CANADIAN_SUFFIXES) | {"L", "AX", "PA", "DE", "HK", "T", "SW", "AS", "MI", "MC"}


def exchange_suffix(symbol: str) -> str | None:
    """``TO`` for ``XEQT.TO``; None for a bare or class-share symbol (``BRK.B``)."""
    if "." not in symbol:
        return None
    suffix = symbol.rsplit(".", 1)[1].upper()
    return suffix if suffix in _KNOWN_SUFFIXES else None


def is_canadian_listing(symbol: str) -> bool:
    return exchange_suffix(symbol) in CANADIAN_SUFFIXES


def quote_candidates(symbol: str, currency: str | None = "CAD") -> list[str]:
    """Listings to try, most likely first.

    An explicit exchange suffix is taken as given. A bare symbol held in CAD is
    most likely Canadian (TSX, then TSX Venture), then US; in any other currency
    US first. Class shares use Yahoo's dash (``RCI.B`` -> ``RCI-B``).
    """
    sym = symbol.strip().upper()
    if not sym:
        return []
    if exchange_suffix(sym):
        return [sym]
    yahoo = sym.replace(".", "-")
    if (currency or "CAD").upper() == "CAD":
        return [f"{yahoo}.TO", f"{yahoo}.V", yahoo]
    return [yahoo, f"{yahoo}.TO"]


def tmx_symbol(symbol: str) -> str:
    """TMX Money's form of a Yahoo TSX/TSX-V symbol: no suffix, class shares dotted."""
    sym = symbol.strip().upper()
    if is_canadian_listing(sym):
        sym = sym.rsplit(".", 1)[0]
    return sym.replace("-", ".")
