"""Account balance history.

The dashboard used to build its "6-month net worth progression" by appending the
*current* net worth six times, producing a flat line presented as a trend. These
helpers record and reconstruct genuine daily balances instead.
"""
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.money import from_cents
from app.models.account import Account
from app.models.snapshot import AccountBalanceSnapshot
from app.models.transaction import Transaction


def record_snapshot(db: Session, account_id: str, balance_cents: int, as_of: date | None = None) -> None:
    """Upsert today's balance (in exact cents) for an account. Caller owns the commit."""
    as_of = as_of or datetime.now().date()
    existing = (
        db.query(AccountBalanceSnapshot)
        .filter(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.as_of_date == as_of,
        )
        .first()
    )
    if existing:
        existing.balance_cents = balance_cents
    else:
        db.add(AccountBalanceSnapshot(account_id=account_id, as_of_date=as_of, balance_cents=balance_cents))


def backfill_account_history(db: Session, account: Account, months: int = 24) -> int:
    """Reconstruct month-end balances by replaying transactions backwards.

    Starting from the account's current balance, subtract each month's net
    activity to recover what the balance was at the end of the preceding month.
    Returns the number of snapshots written.
    """
    today = datetime.now().date()
    balance_cents = account.current_balance_cents or 0
    written = 0

    # Month-end boundaries, most recent first.
    cursor = today
    for _ in range(months):
        record_snapshot(db, account.id, balance_cents, cursor)
        written += 1

        period_start = (datetime.combine(cursor, datetime.min.time()) - relativedelta(months=1)).date()
        # Both snapshots sit at end-of-day, so the window must be half-open on the
        # same instant -- otherwise a transaction dated on a boundary is counted in
        # two consecutive periods and the reconstructed history runs away negative.
        net_cents = (
            db.query(func.sum(Transaction.amount_cents))
            .filter(
                Transaction.account_id == account.id,
                Transaction.transaction_date > datetime.combine(period_start, datetime.max.time()),
                Transaction.transaction_date <= datetime.combine(cursor, datetime.max.time()),
            )
            .scalar()
        ) or 0

        balance_cents -= net_cents
        cursor = period_start

    return written


def backfill_all(db: Session, months: int = 24) -> int:
    total = 0
    for account in db.query(Account).all():
        total += backfill_account_history(db, account, months)
    db.commit()
    return total


def net_worth_series(
    db: Session,
    asset_types: set,
    liability_types: set,
    months: int = 12,
) -> list[tuple[str, float, float, float]]:
    """Build (label, assets, liabilities, net_worth) points from recorded snapshots.

    For each month the most recent snapshot at or before month end is used, so a
    month with no activity carries the last known balance forward rather than
    dropping to zero.
    """
    accounts = db.query(Account).filter(Account.is_active.is_(True)).all()
    if not accounts:
        return []

    now = datetime.now()
    points: list[tuple[str, float, float, float]] = []

    for i in range(months - 1, -1, -1):
        month_ref = now - relativedelta(months=i)
        # Last day of that month.
        first_of_next = (datetime(month_ref.year, month_ref.month, 1) + relativedelta(months=1)).date()
        month_end = first_of_next - timedelta(days=1)

        assets_cents = 0
        liabilities_cents = 0
        for account in accounts:
            snap = (
                db.query(AccountBalanceSnapshot)
                .filter(
                    AccountBalanceSnapshot.account_id == account.id,
                    AccountBalanceSnapshot.as_of_date <= month_end,
                )
                .order_by(AccountBalanceSnapshot.as_of_date.desc())
                .first()
            )
            if snap is None:
                continue
            if account.type in asset_types:
                assets_cents += snap.balance_cents
            elif account.type in liability_types:
                liabilities_cents += abs(snap.balance_cents)

        points.append((
            month_ref.strftime("%b %Y"),
            float(from_cents(assets_cents)),
            float(from_cents(liabilities_cents)),
            float(from_cents(assets_cents - liabilities_cents)),
        ))

    return points
