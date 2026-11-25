"""Trading hours, so quotes are fetched only while they can change.

Regular sessions on the TSX, TSX-V and US exchanges run 9:30-16:00 local time
on weekdays. US listings also trade pre-market (4:00-9:30) and after hours
(16:00-20:00). Exchange holidays are not modelled: a holiday fetch returns the
previous close, and the "already have the latest close" rule stops it repeating.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services.investments.symbols import is_canadian_listing

REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
PRE_OPEN = time(4, 0)
POST_CLOSE = time(20, 0)

# Delayed quotes lag the exchange by about 15 minutes.
CLOSE_SETTLE = timedelta(minutes=20)

TORONTO = "America/Toronto"
NEW_YORK = "America/New_York"


def default_timezone(symbol: str) -> str:
    return TORONTO if is_canadian_listing(symbol) else NEW_YORK


def has_extended_hours(symbol: str) -> bool:
    """Canadian listings have no pre or post-market session."""
    return not is_canadian_listing(symbol)


def _zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz or NEW_YORK)
    except Exception:
        return ZoneInfo(NEW_YORK)


def session_at(now: datetime, tz: str | None, extended: bool) -> str:
    """``PRE``, ``REGULAR``, ``POST`` or ``CLOSED`` at ``now`` (aware) on that exchange."""
    local = now.astimezone(_zone(tz))
    if local.weekday() >= 5:
        return "CLOSED"
    t = local.time()
    if REGULAR_OPEN <= t < REGULAR_CLOSE:
        return "REGULAR"
    if extended and PRE_OPEN <= t < REGULAR_OPEN:
        return "PRE"
    if extended and REGULAR_CLOSE <= t < POST_CLOSE:
        return "POST"
    return "CLOSED"


def last_session_end(now: datetime, tz: str | None, extended: bool) -> datetime:
    """When trading last stopped at or before ``now`` (aware, UTC)."""
    zone = _zone(tz)
    local = now.astimezone(zone)
    end_time = POST_CLOSE if extended else REGULAR_CLOSE
    day: date = local.date()
    while True:
        if day.weekday() < 5:
            end = datetime.combine(day, end_time, tzinfo=zone)
            if end <= local:
                return end.astimezone(timezone.utc)
        day -= timedelta(days=1)


def trading_date(moment: datetime | None, tz: str | None, fallback: date) -> date:
    """The exchange's calendar date for a market timestamp."""
    if moment is None:
        return fallback
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(_zone(tz)).date()


def should_fetch(
    now: datetime,
    tz: str | None,
    extended: bool,
    last_fetched_at: datetime | None,
) -> bool:
    """True while the market trades, or once after it closes to record the close.

    Outside trading hours a listing is fetched only if Folio has not fetched it
    since trading last stopped (or never has). This keys on when Folio fetched,
    not on the last trade's time: a thinly traded listing's last trade can be
    hours before the close and would otherwise be refetched all night.
    """
    if session_at(now, tz, extended) != "CLOSED":
        return True
    # Delayed feeds catch up for a while after the bell: until then the close
    # is not final, so keep fetching (the 10-minute refresh floor still applies).
    settled = last_session_end(now, tz, extended) + CLOSE_SETTLE
    if now < settled:
        return True
    if last_fetched_at is None:
        return True
    if last_fetched_at.tzinfo is None:
        last_fetched_at = last_fetched_at.replace(tzinfo=timezone.utc)
    return last_fetched_at < settled
