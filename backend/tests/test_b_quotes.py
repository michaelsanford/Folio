"""Quote refresh: parallel fetches, an overall deadline, skip already-quoted, batched valuation."""
import threading
import time
from datetime import date

from app.models.account import Account, AccountType
from app.models.investment import Holding, Lot, PriceQuote, Security
import app.services.investments.quote_fetcher as qf
from tests.b_query_counter import count_queries


def _portfolio(db, symbols):
    acc = Account(name="TFSA", type=AccountType.TFSA, currency="CAD")
    db.add(acc)
    db.flush()
    secs = []
    for sym in symbols:
        sec = Security(symbol=sym, name=sym, currency="CAD")
        db.add(sec)
        db.flush()
        holding = Holding(account_id=acc.id, security_id=sec.id)
        db.add(holding)
        db.flush()
        db.add(Lot(holding_id=holding.id, trade_date=date(2025, 1, 2), quantity=10, cost_basis_cents=10000))
        secs.append(sec)
    db.commit()
    return acc, secs


def test_quotes_fetch_in_parallel(db_session, monkeypatch):
    _portfolio(db_session, [f"S{i}" for i in range(8)])
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
        return 12.5, "CAD"

    monkeypatch.setattr(qf, "fetch_single_quote", slow_quote)
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: 1.37)

    started = time.monotonic()
    result = qf.update_quotes_for_securities(db_session)
    elapsed = time.monotonic() - started

    assert result["updated_count"] == 8
    assert result["usdcad_fx_rate"] == 1.37
    assert peak[0] > 1
    assert elapsed < 1.2, "8 x 0.2 s fetches must overlap, not run back to back"


def test_deadline_cuts_off_slow_symbols(db_session, monkeypatch):
    _portfolio(db_session, ["FAST", "SLOW"])
    release = threading.Event()

    def quote(symbol, *a, **k):
        if symbol == "SLOW":
            release.wait(5)
            return 99.0, "CAD"
        return 10.0, "CAD"

    monkeypatch.setattr(qf, "fetch_single_quote", quote)
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: None)
    try:
        started = time.monotonic()
        result = qf.update_quotes_for_securities(db_session, deadline_seconds=0.5)
        elapsed = time.monotonic() - started
    finally:
        release.set()

    assert elapsed < 2.0
    assert result["timed_out"] is True
    assert result["updated_count"] == 1
    assert result["failed_symbols"] == ["SLOW"]


def test_symbols_quoted_today_are_skipped(db_session, monkeypatch):
    _, secs = _portfolio(db_session, ["HAVE", "NEED"])
    db_session.add(PriceQuote(security_id=secs[0].id, as_of_date=date.today(), price_cents=5000))
    db_session.commit()
    fetched = []

    def quote(symbol, *a, **k):
        fetched.append(symbol)
        return 20.0, "CAD"

    monkeypatch.setattr(qf, "fetch_single_quote", quote)
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: None)
    result = qf.update_quotes_for_securities(db_session)
    assert fetched == ["NEED"]
    assert result["skipped_symbols"] == ["HAVE"]
    assert result["updated_count"] == 1


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
