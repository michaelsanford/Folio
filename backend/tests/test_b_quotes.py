"""Quote refresh: parallel fetches, an overall deadline, skip rules, batched valuation."""
import threading
import time
from datetime import date, datetime, timedelta, timezone

from app.models.account import Account, AccountType
from app.models.investment import Holding, Lot, PriceQuote, Security
import app.services.investments.quote_fetcher as qf
from tests.b_query_counter import count_queries

# Tuesday 24 November 2026, 10:00 in Toronto: TSX and US markets open.
OPEN = datetime(2026, 11, 24, 15, 0, tzinfo=timezone.utc)


def _portfolio(db, symbols, currency="CAD"):
    acc = Account(name="TFSA", type=AccountType.TFSA, currency=currency)
    db.add(acc)
    db.flush()
    secs = []
    for sym in symbols:
        sec = Security(symbol=sym, name=sym, currency=currency)
        db.add(sec)
        db.flush()
        holding = Holding(account_id=acc.id, security_id=sec.id)
        db.add(holding)
        db.flush()
        db.add(Lot(holding_id=holding.id, trade_date=date(2025, 1, 2), quantity=10, cost_basis_cents=10000))
        secs.append(sec)
    db.commit()
    return acc, secs


def _quote(symbol, price, **kw):
    return qf.Quote(symbol=symbol, price=price, source="YAHOO", quoted_at=OPEN, timezone="America/Toronto", **kw)


def _no_network(monkeypatch, yahoo, tmx=None):
    monkeypatch.setattr(qf, "fetch_yahoo_quote", yahoo)
    monkeypatch.setattr(qf, "fetch_tmx_quote", tmx or (lambda s, *a, **k: (None, "not found")))
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: 1.37)


def test_quotes_fetch_in_parallel(db_session, monkeypatch):
    _portfolio(db_session, [f"S{i}.TO" for i in range(8)])
    active = [0]
    peak = [0]
    lock = threading.Lock()

    def slow_quote(symbol, *a, **k):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.2)
        with lock:
            active[0] -= 1
        return _quote(symbol, 12.5), None

    _no_network(monkeypatch, slow_quote)
    started = time.monotonic()
    result = qf.update_quotes_for_securities(db_session, now=OPEN)
    elapsed = time.monotonic() - started

    assert result["updated_count"] == 8
    assert result["usdcad_fx_rate"] == 1.37
    assert peak[0] > 1
    assert elapsed < 1.2, "8 x 0.2 s fetches must overlap, not run back to back"


def test_deadline_cuts_off_slow_symbols(db_session, monkeypatch):
    _portfolio(db_session, ["FAST.TO", "SLOW.TO"])
    release = threading.Event()

    def quote(symbol, *a, **k):
        if symbol == "SLOW.TO":
            release.wait(5)
        return _quote(symbol, 10.0), None

    _no_network(monkeypatch, quote)
    try:
        started = time.monotonic()
        result = qf.update_quotes_for_securities(db_session, deadline_seconds=0.5, now=OPEN)
        elapsed = time.monotonic() - started
    finally:
        release.set()

    assert elapsed < 2.0
    assert result["timed_out"] is True
    assert result["updated_count"] == 1
    assert result["failed_symbols"] == ["SLOW.TO"]
    assert result["failures"] == [{"symbol": "SLOW.TO", "reason": "timed out"}]


def test_a_price_typed_in_today_is_never_refetched(db_session, monkeypatch):
    _, secs = _portfolio(db_session, ["HAVE.TO", "NEED.TO"])
    db_session.add(PriceQuote(security_id=secs[0].id, as_of_date=date(2026, 11, 24), price_cents=5000))
    db_session.commit()
    fetched = []

    def quote(symbol, *a, **k):
        fetched.append(symbol)
        return _quote(symbol, 20.0), None

    _no_network(monkeypatch, quote)
    result = qf.update_quotes_for_securities(db_session, now=OPEN)
    assert fetched == ["NEED.TO"]
    assert result["skipped_manual"] == ["HAVE.TO"]
    assert result["updated_count"] == 1


def test_bare_symbol_resolves_to_its_canadian_listing_once(db_session, monkeypatch):
    _, (sec,) = _portfolio(db_session, ["XEQT"])
    asked = []

    def quote(symbol, *a, **k):
        asked.append(symbol)
        return (_quote(symbol, 43.17, previous_close=43.58), None) if symbol == "XEQT.TO" else (None, "not found")

    _no_network(monkeypatch, quote)
    result = qf.update_quotes_for_securities(db_session, now=OPEN)
    assert asked == ["XEQT.TO"]
    assert result["quotes"][0]["listing"] == "XEQT.TO"
    db_session.refresh(sec)
    assert sec.quote_symbol == "XEQT.TO"
    row = db_session.query(PriceQuote).filter_by(security_id=sec.id).one()
    assert (row.price_cents, row.previous_close_cents, row.source) == (4317, 4358, "YAHOO")

    # Next refresh goes straight to the resolved listing.
    asked.clear()
    qf.update_quotes_for_securities(db_session, now=OPEN + timedelta(minutes=15))
    assert asked == ["XEQT.TO"]


def test_tmx_fills_in_when_yahoo_fails(db_session, monkeypatch):
    _, (sec,) = _portfolio(db_session, ["XEQT.TO"])

    def tmx(symbol, *a, **k):
        return qf.Quote(symbol=symbol, price=43.10, source="TMX", quoted_at=OPEN, timezone="America/Toronto"), None

    _no_network(monkeypatch, lambda s, *a, **k: (None, "Yahoo: HTTP 429"), tmx)
    result = qf.update_quotes_for_securities(db_session, now=OPEN)
    assert result["quotes"][0]["source"] == "TMX"
    assert db_session.query(PriceQuote).filter_by(security_id=sec.id).one().source == "TMX"


def test_us_listings_never_ask_tmx(db_session, monkeypatch):
    _portfolio(db_session, ["AAPL"], currency="USD")
    tmx_calls = []
    _no_network(
        monkeypatch,
        lambda s, *a, **k: (None, "Yahoo: HTTP 429"),
        lambda s, *a, **k: tmx_calls.append(s) or (None, "not found"),
    )
    result = qf.update_quotes_for_securities(db_session, now=OPEN)
    # AAPL.TO is tried as a candidate (USD lists US first, then TSX), and only
    # that Canadian candidate may fall back to TMX.
    assert tmx_calls == ["AAPL.TO"]
    assert result["failed_symbols"] == ["AAPL"]
    assert "HTTP 429" in result["failures"][0]["reason"]


def test_refresh_floor_and_same_day_update(db_session, monkeypatch):
    _, (sec,) = _portfolio(db_session, ["XEQT.TO"])
    price = [43.00]
    _no_network(monkeypatch, lambda s, *a, **k: (_quote(s, price[0]), None))

    qf.update_quotes_for_securities(db_session, now=OPEN)
    price[0] = 43.50
    soon = qf.update_quotes_for_securities(db_session, now=OPEN + timedelta(minutes=5))
    assert soon["skipped_recent"] == ["XEQT.TO"]

    later = qf.update_quotes_for_securities(db_session, now=OPEN + timedelta(minutes=11))
    assert later["updated_count"] == 1
    rows = db_session.query(PriceQuote).filter_by(security_id=sec.id).all()
    assert len(rows) == 1 and rows[0].price_cents == 4350, "the day's automated price is updated in place"


def test_closed_market_fetches_the_close_once(db_session, monkeypatch):
    _portfolio(db_session, ["XEQT.TO"])
    calls = []
    _no_network(monkeypatch, lambda s, *a, **k: calls.append(s) or (_quote(s, 43.0), None))

    evening = datetime(2026, 11, 24, 23, 0, tzinfo=timezone.utc)  # 18:00 Toronto
    first = qf.update_quotes_for_securities(db_session, now=evening)
    second = qf.update_quotes_for_securities(db_session, now=evening + timedelta(hours=2))
    assert first["updated_count"] == 1
    assert second["skipped_closed"] == ["XEQT.TO"]
    assert len(calls) == 1

    # Saturday: Friday's close isn't recorded yet, so one fetch, then nothing.
    saturday = datetime(2026, 11, 28, 15, 0, tzinfo=timezone.utc)
    assert qf.update_quotes_for_securities(db_session, now=saturday)["updated_count"] == 1
    later = qf.update_quotes_for_securities(db_session, now=saturday + timedelta(hours=3))
    assert later["skipped_closed"] == ["XEQT.TO"]
    assert len(calls) == 2


def test_revalue_uses_batched_price_lookups(db_session):
    acc, secs = _portfolio(db_session, [f"P{i}" for i in range(15)])
    for i, sec in enumerate(secs):
        db_session.add(PriceQuote(security_id=sec.id, as_of_date=date(2026, 1, 2), price_cents=1000 + i))
        db_session.add(PriceQuote(security_id=sec.id, as_of_date=date(2026, 2, 2), price_cents=2000 + i))
    db_session.commit()

    with count_queries(db_session) as statements:
        revalued, unpriced = qf.revalue_accounts(db_session, as_of=date(2026, 1, 31))
    assert revalued == 1 and unpriced == []
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    assert len(selects) <= 8, len(selects)
    db_session.expire_all()
    # Prices at or before Jan 31: the January quotes. 10 units each.
    expected = sum(10 * (1000 + i) for i in range(15))
    assert db_session.get(Account, acc.id).current_balance_cents == expected
