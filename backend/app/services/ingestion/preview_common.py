"""Helpers shared by the CSV, OFX and PDF statement parsers."""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime
from typing import Iterable

from sqlalchemy.orm import Session

from app.schemas.ingestion import ParsedRowError, ParsedTransactionItem
from app.services.categorization.normalizer import normalize_payee
from app.services.ingestion.deduplication import generate_transaction_hash


class HashSequencer:
    """Assigns dedup fingerprints with an occurrence ordinal.

    Two genuinely separate purchases with the same date, amount and payee in
    one statement (two coffees, two transit fares) used to share one
    fingerprint, so the second was silently dropped as a duplicate. The first
    occurrence keeps the exact historical fingerprint -- so previously imported
    rows still de-duplicate -- and later ones get ``|1``, ``|2``, ...
    """

    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def next_hash(self, scope: str, iso_date: str, amount: float, raw_payee: str) -> str:
        base = generate_transaction_hash(scope, iso_date, amount, raw_payee)
        ordinal = self._seen.get(base, 0)
        self._seen[base] = ordinal + 1
        if ordinal == 0:
            return base
        return generate_transaction_hash(scope, iso_date, amount, raw_payee, ordinal=ordinal)


def classify_preview_items(
    db: Session,
    items: list[ParsedTransactionItem],
    account_types: list[str | None],
) -> None:
    """Classify every preview row with one batched, side-effect-free pass.

    Replaces a per-row ``classify_transaction`` call, which re-loaded the rules,
    categories and history for every row and could commit Bedrock-learned rules
    from a mere preview. ``persist=False``: nothing is written.
    """
    if not items:
        return
    # Imported lazily: the engine imports app.api.rules, which must not load at
    # parser-import time.
    from app.services.categorization.engine import ClassificationEngine

    results = ClassificationEngine.classify_batch(
        db,
        [
            {
                "raw_payee": item.raw_payee,
                "amount": item.amount,
                "account_id": item.account_id,
                "account_type": acc_type,
                "notes": item.notes,
                "date": item.transaction_date,
            }
            for item, acc_type in zip(items, account_types)
        ],
        persist=False,
    )
    for item, res in zip(items, results):
        item.normalized_payee = res.normalized_payee or normalize_payee(item.raw_payee)
        if res.matched:
            item.suggested_category_id = res.category_id
            item.suggested_category_name = res.category_name
            item.suggested_category_color = res.category_color
            item.confidence_score = res.confidence
            item.classification_tier = res.tier.value
            item.classification_reason = res.reason
        else:
            item.confidence_score = 0.5


def row_error(row_number: int | None, field: str, value: object, message: str) -> ParsedRowError:
    return ParsedRowError(
        row_number=row_number,
        field=field,
        value=str(value)[:200] if value is not None else None,
        message=message,
    )


_YEAR_RE = re.compile(r"\b(1[89]|20|21)\d{2}\b")
_NUMERIC_DATE_RE = re.compile(r"^\s*\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}\b")


def has_explicit_year(raw: str) -> bool:
    """True when a date string carries its own year (``2026``, or a third numeric field)."""
    return bool(_YEAR_RE.search(raw) or _NUMERIC_DATE_RE.match(raw))


def infer_year(month: int, day: int, reference: date) -> date:
    """The most recent (month, day) on or before ``reference``.

    Statement lines usually omit the year. Anchoring on the statement's closing
    date handles December rows on a January statement; with no statement
    period, "nearest past date" beats silently assuming the current year (which
    produced future-dated rows for last December's purchases).
    """
    year = reference.year
    if (month, day) > (reference.month, reference.day):
        year -= 1
    # Feb 29 only exists in leap years: walk back to the nearest one.
    while month == 2 and day == 29 and not calendar.isleap(year):
        year -= 1
    return date(year, month, day)


def collect_full_dates(texts: Iterable[str]) -> list[date]:
    """Dates with an explicit year found in statement header text."""
    from dateutil import parser as date_parser

    found: list[date] = []
    patterns = (
        r"\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b",          # January 31, 2026
        r"\b\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}\b",          # 31 January 2026
        r"\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b",               # 2026-01-31
        r"\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b",               # 01/31/2026
    )
    for text in texts:
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                try:
                    dt = date_parser.parse(match.group(0), fuzzy=False)
                except (ValueError, OverflowError):
                    continue
                if 1900 <= dt.year <= 2100:
                    found.append(dt.date())
    return found


def parse_statement_date(raw: str, reference: date) -> datetime:
    """Parse a statement row date, inferring a missing year from ``reference``.

    Raises ``ValueError`` when the text is not a date at all.
    """
    from dateutil import parser as date_parser

    if has_explicit_year(raw):
        dt = date_parser.parse(raw)
        if not 1900 <= dt.year <= 2100:
            raise ValueError(f"year {dt.year} out of range")
        return dt
    # Leap-year default so "Feb 29" parses; the real year is inferred below.
    dt = date_parser.parse(raw, default=datetime(2000, 1, 1))
    inferred = infer_year(dt.month, dt.day, reference)
    return datetime(inferred.year, inferred.month, inferred.day, dt.hour, dt.minute, dt.second)
