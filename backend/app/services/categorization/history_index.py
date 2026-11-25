"""In-memory index of the user's categorized transaction history.

The historical matchers used to run several full-table scans of
``transactions JOIN transaction_splits`` (with ``lower()`` and ``LIKE '%tok%'``
predicates that no index can serve) for every transaction being classified.
On a 50k-transaction vault that was 0.8-2.0 s per row, so a 300-row preview
took minutes.

``HistoryIndex`` aggregates that history into groups -- (normalized payee, raw
payee, account, category) -> split count -- and answers every lookup from
memory. Groups are loaded in one of two ways, with identical answers:

* **full**: one ``GROUP BY`` over the whole table (``load_all``).
* **lazy** (default): one ``SELECT DISTINCT normalized_payee, raw_payee`` gives
  the payee "universe"; the lookup predicates are evaluated in memory against
  it, and only groups for payees that can match are fetched (in one query for
  a whole batch via :meth:`prefetch`). A novel payee matches nothing and costs
  no further query.

A group's membership in any lookup depends only on its payee strings, so both
modes see exactly the groups the legacy SQL would have counted.

The in-memory comparisons fold case with Python's Unicode-aware
``str.lower()``/``str.upper()``, matching the database's ``lower()``/``upper()``.
"""
from __future__ import annotations

import re
from datetime import datetime
from dataclasses import dataclass, field
from typing import Callable, Generic, Iterable, TypeVar

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.transaction import Transaction, TransactionSplit
from app.services.categorization.normalizer import normalize_payee

# Insertion order (creation time); used only to iterate groups in the order the
# legacy row-by-row scan would have met them.
_TXN_ORDER = Transaction.created_at

TOKEN_RE = re.compile(r"[\wÀ-ſ]+")


# When a batch's candidate payees exceed this many raw-payee strings, one full
# GROUP BY is cheaper than fetching them in IN-list chunks.
FULL_LOAD_CANDIDATES = 2000
_IN_CHUNK = 500

T = TypeVar("T")


def db_lower(value: str) -> str:
    """The database's lower(): Unicode-aware, like Python's."""
    return value.lower()


def db_upper(value: str) -> str:
    """The database's upper(): Unicode-aware, like Python's."""
    return value.upper()


def _like_matcher(pattern: str) -> Callable[[str], bool]:
    """Compile a LIKE pattern (no ESCAPE clause) for already-lowered values.

    Both sides are folded with :func:`db_lower`, matching the SQL side, which
    compares ``lower(column) LIKE lower(pattern)``. ``prefix%`` and ``%token%`` (the only shapes
    the matchers build) use plain string operations unless they contain a
    wildcard character; anything else falls back to a regex.
    """
    lowered = db_lower(pattern)
    core = lowered.strip("%")
    if "%" not in core and "_" not in core:
        if lowered == f"%{core}%":
            return lambda value: core in value
        if lowered == f"{core}%":
            return lambda value: value.startswith(core)
    parts = []
    for ch in lowered:
        if ch == "%":
            parts.append(".*")
        elif ch == "_":
            parts.append(".")
        else:
            parts.append(re.escape(ch))
    rx = re.compile("".join(parts), re.DOTALL)
    return lambda value: rx.fullmatch(value) is not None


@dataclass(frozen=True)
class PayeeLookupSpec:
    """Everything the payee matchers derive from one (raw, normalized) input."""

    raw_payee: str
    normalized_payee: str | None
    cleaned_raw: str
    norm: str
    search_tokens: tuple[str, ...]
    prefix: str | None
    like_patterns: tuple[str, ...]
    fallback_raw_upper: str | None
    fallback_norm_upper: str | None

    @property
    def key(self) -> tuple[str, str | None]:
        return (self.raw_payee, self.normalized_payee)


def payee_lookup_spec(raw_payee: str, normalized_payee: str | None) -> PayeeLookupSpec | None:
    """Derive the lookup keys exactly as the historical matchers always have."""
    if not raw_payee or not raw_payee.strip():
        return None
    cleaned_raw = raw_payee.strip()
    norm = (normalized_payee or normalize_payee(cleaned_raw)).strip()
    if not norm or norm.lower() == "unknown":
        norm = cleaned_raw

    norm_tokens = [t for t in TOKEN_RE.findall(norm.lower()) if len(t) >= 4]
    raw_tokens = [t for t in TOKEN_RE.findall(cleaned_raw.lower()) if len(t) >= 4]
    search_tokens = tuple(dict.fromkeys(norm_tokens + raw_tokens))
    prefix = norm[:4].lower() if len(norm) >= 4 else (cleaned_raw[:4].lower() if len(cleaned_raw) >= 4 else None)

    patterns: list[str] = []
    if prefix:
        patterns.append(f"{prefix}%")
    for tok in search_tokens:
        patterns.append(f"%{tok}%")

    return PayeeLookupSpec(
        raw_payee=raw_payee,
        normalized_payee=normalized_payee,
        cleaned_raw=cleaned_raw,
        norm=norm,
        search_tokens=search_tokens,
        prefix=prefix,
        like_patterns=tuple(patterns),
        fallback_raw_upper=raw_payee.upper().strip() if raw_payee else None,
        fallback_norm_upper=normalized_payee.upper().strip() if normalized_payee else None,
    )


class _PayeeMaps(Generic[T]):
    """Items keyed by their payee strings, with the folds the matchers compare on."""

    def __init__(self) -> None:
        self.np_exact: dict[str, list[T]] = {}
        self.raw_exact: dict[str, list[T]] = {}
        self.np_lower: dict[str, list[T]] = {}
        self.raw_lower: dict[str, list[T]] = {}
        self.np_upper: dict[str, list[T]] = {}
        self.raw_upper: dict[str, list[T]] = {}

    def add(self, normalized_payee: str | None, raw_payee: str | None, item: T) -> None:
        if normalized_payee is not None:
            self.np_exact.setdefault(normalized_payee, []).append(item)
            self.np_lower.setdefault(db_lower(normalized_payee), []).append(item)
            self.np_upper.setdefault(db_upper(normalized_payee), []).append(item)
        if raw_payee is not None:
            self.raw_exact.setdefault(raw_payee, []).append(item)
            self.raw_lower.setdefault(db_lower(raw_payee), []).append(item)
            self.raw_upper.setdefault(db_upper(raw_payee), []).append(item)

    def exact(self, spec: PayeeLookupSpec) -> list[T]:
        """``lower(np) = :norm_lower OR lower(raw) = :raw_lower OR np = :norm OR raw = :raw``."""
        return (
            self.np_lower.get(spec.norm.lower(), [])
            + self.raw_lower.get(spec.cleaned_raw.lower(), [])
            + self.np_exact.get(spec.norm, [])
            + self.raw_exact.get(spec.cleaned_raw, [])
        )

    def like(self, spec: PayeeLookupSpec) -> list[T]:
        """``lower(np) LIKE p OR lower(raw) LIKE p`` for any prefix/token pattern ``p``."""
        if not spec.like_patterns:
            return []
        matchers = [_like_matcher(p) for p in spec.like_patterns]
        found: list[T] = []
        for table in (self.np_lower, self.raw_lower):
            for lowered, items in table.items():
                if any(m(lowered) for m in matchers):
                    found.extend(items)
        return found

    def upper_raw(self, spec: PayeeLookupSpec) -> list[T]:
        return self.raw_upper.get(spec.fallback_raw_upper, []) if spec.fallback_raw_upper else []

    def upper_norm(self, spec: PayeeLookupSpec) -> list[T]:
        return self.np_upper.get(spec.fallback_norm_upper, []) if spec.fallback_norm_upper else []

    def candidates(self, spec: PayeeLookupSpec) -> list[T]:
        return self.exact(spec) + self.like(spec) + self.upper_raw(spec) + self.upper_norm(spec)


@dataclass
class HistoryGroup:
    """Count of categorized splits sharing payee strings, account and category."""

    normalized_payee: str | None
    raw_payee: str | None
    account_id: str
    category_id: str
    category_exists: bool
    category_name: str | None
    category_color: str | None
    count: int
    order: datetime  # earliest transaction creation: stable, insertion-ordered iteration


@dataclass
class NoteGroup:
    notes: str
    account_id: str
    category_id: str
    count: int
    order: datetime


@dataclass
class HistoryIndex:
    """Categorized history aggregated once per request and queried in memory."""

    db: Session
    full: bool = False
    _groups: dict[tuple, HistoryGroup] = field(default_factory=dict)
    _maps: _PayeeMaps = field(default_factory=_PayeeMaps)
    _universe: _PayeeMaps | None = None
    _loaded_raws: set = field(default_factory=set)
    _covered: set = field(default_factory=set)
    _notes_full: bool = False
    _notes_groups: dict[tuple, NoteGroup] = field(default_factory=dict)
    _notes_covered: set = field(default_factory=set)
    queries: int = 0

    # ------------------------------------------------------------------ loading

    @classmethod
    def build(cls, db: Session, *, full: bool = False) -> "HistoryIndex":
        index = cls(db=db)
        if full:
            index.load_all()
        return index

    def _group_query(self):
        return (
            self.db.query(
                Transaction.normalized_payee,
                Transaction.raw_payee,
                Transaction.account_id,
                TransactionSplit.category_id,
                Category.id.label("cat_pk"),
                Category.name.label("category_name"),
                Category.color.label("category_color"),
                func.count(TransactionSplit.id).label("cnt"),
                func.min(_TXN_ORDER).label("first_seen"),
            )
            .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
            .outerjoin(Category, TransactionSplit.category_id == Category.id)
            .filter(TransactionSplit.category_id.isnot(None))
        )

    @staticmethod
    def _grouped(query):
        return query.group_by(
            Transaction.normalized_payee,
            Transaction.raw_payee,
            Transaction.account_id,
            TransactionSplit.category_id,
            Category.id,
            Category.name,
            Category.color,
        )

    def _merge_group_rows(self, rows) -> None:
        for r in rows:
            key = (r.normalized_payee, r.raw_payee, r.account_id, r.category_id)
            if key in self._groups:
                continue
            group = HistoryGroup(
                normalized_payee=r.normalized_payee,
                raw_payee=r.raw_payee,
                account_id=r.account_id,
                category_id=r.category_id,
                category_exists=r.cat_pk is not None,
                category_name=r.category_name,
                category_color=r.category_color,
                count=int(r.cnt),
                order=r.first_seen or datetime.min,
            )
            self._groups[key] = group
            self._maps.add(group.normalized_payee, group.raw_payee, group)

    def load_all(self) -> None:
        """Aggregate every categorized split in one GROUP BY."""
        if self.full:
            return
        self._merge_group_rows(self._grouped(self._group_query()).all())
        self.queries += 1
        self.full = True

    def _load_universe(self) -> _PayeeMaps:
        if self._universe is None:
            universe: _PayeeMaps = _PayeeMaps()
            rows = self.db.query(Transaction.normalized_payee, Transaction.raw_payee).distinct().all()
            self.queries += 1
            for np_val, raw_val in rows:
                universe.add(np_val, raw_val, raw_val)
            self._universe = universe
        return self._universe

    def _fetch_raws(self, raws: Iterable[str]) -> None:
        pending = [r for r in dict.fromkeys(raws) if r is not None and r not in self._loaded_raws]
        if not pending:
            return
        if len(pending) > FULL_LOAD_CANDIDATES:
            self.load_all()
            return
        for i in range(0, len(pending), _IN_CHUNK):
            chunk = pending[i : i + _IN_CHUNK]
            # Every group of a payee shares its raw payee, so loading by raw
            # payee always brings a payee's groups in complete.
            rows = self._grouped(self._group_query().filter(Transaction.raw_payee.in_(chunk))).all()
            self.queries += 1
            self._merge_group_rows(rows)
            self._loaded_raws.update(chunk)

    def ensure_payee(self, spec: PayeeLookupSpec) -> None:
        """Make sure every group ``spec``'s lookups can match is loaded."""
        self.prefetch([spec])

    def prefetch(self, specs: Iterable[PayeeLookupSpec | None]) -> None:
        """Load the groups a batch of lookups can match, in as few queries as possible."""
        if self.full:
            return
        todo = [s for s in specs if s is not None and s.key not in self._covered]
        if not todo:
            return
        universe = self._load_universe()
        raws: list[str] = []
        for spec in todo:
            raws.extend(universe.candidates(spec))
        self._fetch_raws(raws)
        self._covered.update(s.key for s in todo)

    def _notes_query(self):
        return (
            self.db.query(
                Transaction.notes,
                Transaction.account_id,
                TransactionSplit.category_id,
                func.count(TransactionSplit.id).label("cnt"),
                func.min(_TXN_ORDER).label("first_seen"),
            )
            .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
            .filter(
                TransactionSplit.category_id.isnot(None),
                Transaction.notes.isnot(None),
            )
        )

    def _merge_note_rows(self, rows) -> None:
        for r in rows:
            key = (r.notes, r.account_id, r.category_id)
            if key in self._notes_groups:
                continue
            self._notes_groups[key] = NoteGroup(
                notes=r.notes,
                account_id=r.account_id,
                category_id=r.category_id,
                count=int(r.cnt),
                order=r.first_seen or datetime.min,
            )

    def load_all_notes(self) -> None:
        if self._notes_full:
            return
        rows = self._notes_query().group_by(
            Transaction.notes, Transaction.account_id, TransactionSplit.category_id
        ).all()
        self.queries += 1
        self._merge_note_rows(rows)
        self._notes_full = True

    def ensure_notes(self, anchor: str) -> None:
        anchor_lower = anchor.lower()
        if self._notes_full or anchor_lower in self._notes_covered:
            return
        if self.full or len(self._notes_covered) >= 3:
            # Batches: one aggregate over every note beats repeated LIKE scans.
            self.load_all_notes()
            return
        rows = (
            self._notes_query()
            .filter(func.lower(Transaction.notes).like(f"%{anchor_lower}%"))
            .group_by(Transaction.notes, Transaction.account_id, TransactionSplit.category_id)
            .all()
        )
        self.queries += 1
        self._merge_note_rows(rows)
        self._notes_covered.add(anchor_lower)

    # ------------------------------------------------------------------ lookups

    @staticmethod
    def _dedupe_sorted(groups: Iterable[HistoryGroup]) -> list[HistoryGroup]:
        seen: dict[int, HistoryGroup] = {}
        for g in groups:
            seen.setdefault(id(g), g)
        return sorted(seen.values(), key=lambda g: g.order)

    def exact_groups(self, spec: PayeeLookupSpec) -> list[HistoryGroup]:
        """Groups whose payee equals the lookup, as the exact-match SQL defined it,
        restricted (like the original inner join) to categories that still exist."""
        self.ensure_payee(spec)
        return [g for g in self._dedupe_sorted(self._maps.exact(spec)) if g.category_exists]

    def like_groups(self, spec: PayeeLookupSpec) -> list[HistoryGroup]:
        """Groups whose lower(np) or lower(raw) matches any prefix/token LIKE pattern."""
        self.ensure_payee(spec)
        return [g for g in self._dedupe_sorted(self._maps.like(spec)) if g.category_exists]

    def upper_raw_groups(self, spec: PayeeLookupSpec) -> list[HistoryGroup]:
        """``upper(raw) = :raw_upper`` (no category join, as in the legacy fallback)."""
        self.ensure_payee(spec)
        return self._dedupe_sorted(self._maps.upper_raw(spec))

    def upper_norm_groups(self, spec: PayeeLookupSpec) -> list[HistoryGroup]:
        """``upper(np) = :norm_upper`` (no category join, as in the legacy fallback)."""
        self.ensure_payee(spec)
        return self._dedupe_sorted(self._maps.upper_norm(spec))

    def note_groups(self, anchor: str) -> list[NoteGroup]:
        """Note groups where ``lower(notes) LIKE '%anchor%'``."""
        self.ensure_notes(anchor)
        match = _like_matcher(f"%{anchor.lower()}%")
        return sorted(
            (g for g in self._notes_groups.values() if match(db_lower(g.notes))),
            key=lambda g: g.order,
        )
