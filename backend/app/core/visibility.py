"""Who may see which accounts: one filter applied to every ORM query.

Each account is owned by zero or more household members (``account_owners``)
and has a visibility (``AccountVisibility``):

- HOUSEHOLD (or NULL): everyone who can sign in sees it and its rows.
- TOTALS: others count it in household totals, but never see its name,
  details or transactions.
- PRIVATE: only its owners -- the sign-ins linked to one of its owner members
  -- know it exists.

``authorize`` (core/actor.py) records the signed-in person as the request's
*viewer*. A ``do_orm_execute`` listener then adds ``with_loader_criteria`` to
every ORM SELECT, restricting ``Account`` and every table that hangs off an
account (transactions and their splits, balance snapshots, holdings,
investment activity, statement files) to what the viewer may see. A hidden
account is therefore simply absent: lists leave it out and lookups by id are
404s, with no per-endpoint code. Writes go through rows loaded this way (or
through ids selected this way), so they cannot reach a hidden account either.

Two scopes:

- *detail* (default): HOUSEHOLD accounts and the viewer's own.
- *totals*: also others' TOTALS accounts. Only endpoints that return sums --
  never rows that identify an account or a transaction -- enter it, with
  ``totals_scope()``.

Code with no viewer (the CLI, migrations, startup seeding, tests calling
services directly) and the single-passphrase owner see everything. Work that
must be complete regardless of the viewer (building a closed-year archive,
the closed-period check) runs inside ``unrestricted()``.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import event, or_, select
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria

from app.models.account import Account, account_owners
from app.models.investment import Holding, InvestmentActivity
from app.models.snapshot import AccountBalanceSnapshot
from app.models.statement_file import StatementFile
from app.models.transaction import Transaction, TransactionSplit

DETAIL = "detail"
TOTALS = "totals"


@dataclass(frozen=True)
class Viewer:
    member_id: str | None
    unrestricted: bool = False


_viewer: ContextVar[Viewer | None] = ContextVar("folio_viewer", default=None)
_scope: ContextVar[str] = ContextVar("folio_visibility_scope", default=DETAIL)
_bypass: ContextVar[bool] = ContextVar("folio_visibility_bypass", default=False)

# Never matches a real member id: a viewer linked to no member owns nothing.
_NO_MEMBER = ""


def set_viewer(member_id: str | None, unrestricted: bool) -> None:
    _viewer.set(Viewer(member_id=member_id, unrestricted=unrestricted))


def clear_viewer() -> None:
    _viewer.set(None)


def current_viewer() -> Viewer | None:
    return _viewer.get()


def is_restricted() -> bool:
    viewer = _viewer.get()
    return viewer is not None and not viewer.unrestricted and not _bypass.get()


@contextmanager
def totals_scope() -> Iterator[None]:
    """Also count others' TOTALS accounts (sums only, never identifying rows)."""
    token = _scope.set(TOTALS)
    try:
        yield
    finally:
        _scope.reset(token)


@contextmanager
def detail_scope() -> Iterator[None]:
    """Back to detail inside a totals route (e.g. a response that names payees)."""
    token = _scope.set(DETAIL)
    try:
        yield
    finally:
        _scope.reset(token)


async def totals_view() -> None:
    """Router dependency for aggregate routes: count others' TOTALS accounts.

    ``async`` so the scope is set in the request's own context, which the
    endpoint (run in the threadpool) inherits.
    """
    _scope.set(TOTALS)


@contextmanager
def unrestricted() -> Iterator[None]:
    """See every account, whoever is signed in."""
    token = _bypass.set(True)
    try:
        yield
    finally:
        _bypass.reset(token)


def _criteria(member_id: str, totals: bool) -> list:
    """Loader criteria for the viewer.

    Lambdas, so aliased entities (the transfer matcher's self-join) are
    filtered too. ``member_id`` is their only closure value: SQLAlchemy turns
    it into a bound parameter, so the compiled SQL is cached once per shape.
    """
    if totals:
        account = lambda cls: or_(  # noqa: E731
            cls.visibility.is_(None),
            cls.visibility.in_(["HOUSEHOLD", "TOTALS"]),
            cls.id.in_(select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)),
        )
        child = lambda cls: cls.account_id.in_(  # noqa: E731
            select(Account.id).where(
                or_(
                    Account.visibility.is_(None),
                    Account.visibility.in_(["HOUSEHOLD", "TOTALS"]),
                    Account.id.in_(select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)),
                )
            )
        )
        statement = lambda cls: or_(  # noqa: E731
            cls.account_id.is_(None),
            cls.account_id.in_(
                select(Account.id).where(
                    or_(
                        Account.visibility.is_(None),
                        Account.visibility.in_(["HOUSEHOLD", "TOTALS"]),
                        Account.id.in_(
                            select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)
                        ),
                    )
                )
            ),
        )
        split = lambda cls: cls.transaction_id.in_(  # noqa: E731
            select(Transaction.id).where(
                Transaction.account_id.in_(
                    select(Account.id).where(
                        or_(
                            Account.visibility.is_(None),
                            Account.visibility.in_(["HOUSEHOLD", "TOTALS"]),
                            Account.id.in_(
                                select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)
                            ),
                        )
                    )
                )
            )
        )
    else:
        account = lambda cls: or_(  # noqa: E731
            cls.visibility.is_(None),
            cls.visibility == "HOUSEHOLD",
            cls.id.in_(select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)),
        )
        child = lambda cls: cls.account_id.in_(  # noqa: E731
            select(Account.id).where(
                or_(
                    Account.visibility.is_(None),
                    Account.visibility == "HOUSEHOLD",
                    Account.id.in_(select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)),
                )
            )
        )
        statement = lambda cls: or_(  # noqa: E731
            cls.account_id.is_(None),
            cls.account_id.in_(
                select(Account.id).where(
                    or_(
                        Account.visibility.is_(None),
                        Account.visibility == "HOUSEHOLD",
                        Account.id.in_(
                            select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)
                        ),
                    )
                )
            ),
        )
        split = lambda cls: cls.transaction_id.in_(  # noqa: E731
            select(Transaction.id).where(
                Transaction.account_id.in_(
                    select(Account.id).where(
                        or_(
                            Account.visibility.is_(None),
                            Account.visibility == "HOUSEHOLD",
                            Account.id.in_(
                                select(account_owners.c.account_id).where(account_owners.c.member_id == member_id)
                            ),
                        )
                    )
                )
            )
        )

    options = [with_loader_criteria(Account, account, include_aliases=True)]
    for model in (Transaction, AccountBalanceSnapshot, Holding, InvestmentActivity):
        options.append(with_loader_criteria(model, child, include_aliases=True))
    options.append(with_loader_criteria(StatementFile, statement, include_aliases=True))
    options.append(with_loader_criteria(TransactionSplit, split, include_aliases=True))
    return options


@event.listens_for(Session, "do_orm_execute")
def _restrict_to_visible_accounts(state: ORMExecuteState) -> None:
    if not state.is_select or not is_restricted():
        return
    viewer = _viewer.get()
    state.statement = state.statement.options(
        *_criteria(viewer.member_id or _NO_MEMBER, _scope.get() == TOTALS)
    )


def visible_account_ids(db: Session) -> set[str]:
    """Ids of the accounts the viewer sees in detail (everything when unrestricted)."""
    token = _scope.set(DETAIL)
    try:
        return set(db.scalars(select(Account.id)))
    finally:
        _scope.reset(token)


def can_see_all(db: Session, account_ids: set[str]) -> bool:
    return account_ids <= visible_account_ids(db)
