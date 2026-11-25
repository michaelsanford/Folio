"""Symbol matching, trading hours, provider parsing, and quote provenance (no network)."""
import logging
import sqlite3
from datetime import date, datetime, timezone

import httpx
import pytest
from alembic import command

from app.core import migrations
from app.core.config import settings
from app.models.account import Account, AccountType
from app.models.investment import PriceQuote, Security
import app.services.investments.quote_fetcher as qf
from app.services.investments.market_hours import should_fetch, session_at
from app.services.investments.symbols import quote_candidates, tmx_symbol

# ---------------------------------------------------------------- symbols

@pytest.mark.parametrize(
    "typed,currency,expected",
    [
        ("XEQT", "CAD", ["XEQT.TO", "XEQT.V", "XEQT"]),
        ("xeqt.to", "CAD", ["XEQT.TO"]),
        ("ABC.V", "CAD", ["ABC.V"]),
        ("AAPL", "USD", ["AAPL", "AAPL.TO"]),
        ("RCI.B", "CAD", ["RCI-B.TO", "RCI-B.V", "RCI-B"]),
        ("BRK.B", "USD", ["BRK-B", "BRK-B.TO"]),
    ],
)
def test_quote_candidates(typed, currency, expected):
    assert quote_candidates(typed, currency) == expected


def test_tmx_symbols():
    assert tmx_symbol("XEQT.TO") == "XEQT"
    assert tmx_symbol("RCI-B.TO") == "RCI.B"
    assert tmx_symbol("ABC.V") == "ABC"


# ----------------------------------------------------------- trading hours

def _et(y, m, d, h, mi=0):
    from zoneinfo import ZoneInfo
    return datetime(y, m, d, h, mi, tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc)


def test_sessions():
    tsx = "America/Toronto"
    assert session_at(_et(2026, 11, 24, 10), tsx, extended=False) == "REGULAR"
    assert session_at(_et(2026, 11, 24, 7), tsx, extended=False) == "CLOSED"
    assert session_at(_et(2026, 11, 24, 7), "America/New_York", extended=True) == "PRE"
    assert session_at(_et(2026, 11, 24, 17), "America/New_York", extended=True) == "POST"
    assert session_at(_et(2026, 11, 28, 12), tsx, extended=False) == "CLOSED"  # Saturday


def test_closed_market_rules():
    tsx = "America/Toronto"
    evening = _et(2026, 11, 24, 18)
    assert should_fetch(evening, tsx, False, None) is True
    assert should_fetch(evening, tsx, False, _et(2026, 11, 24, 15, 50)) is True, "fetched before the close"
    assert should_fetch(evening, tsx, False, _et(2026, 11, 24, 17)) is False, "close already recorded"
    # Just after the bell the delayed close may still be settling.
    assert should_fetch(_et(2026, 11, 24, 16, 10), tsx, False, _et(2026, 11, 24, 16, 5)) is True


# ---------------------------------------------------------------- parsing

def _yahoo(meta, stamps=(), closes=()):
    return {"chart": {"result": [{"meta": meta, "timestamp": list(stamps),
                                  "indicators": {"quote": [{"close": list(closes)}]}}], "error": None}}


TSX_META = {
    "currency": "CAD", "symbol": "XEQT.TO", "exchangeName": "TOR", "exchangeTimezoneName": "America/Toronto",
    "regularMarketPrice": 43.17, "regularMarketTime": 1795553993, "chartPreviousClose": 43.58,
    "hasPrePostMarketData": False, "longName": "iShares Core Equity ETF Portfolio",
}
US_META = {
    "currency": "USD", "symbol": "AAPL", "exchangeName": "NMS", "exchangeTimezoneName": "America/New_York",
    "regularMarketPrice": 354.07, "regularMarketTime": 1795554001, "chartPreviousClose": 349.08,
    "hasPrePostMarketData": True, "longName": "Apple Inc.",
    "currentTradingPeriod": {
        "pre": {"start": 1795510800, "end": 1795530600},
        "regular": {"start": 1795530600, "end": 1795554000},
        "post": {"start": 1795554000, "end": 1795568400},
    },
}


def test_yahoo_regular_quote():
    q, reason = qf.parse_yahoo_chart("XEQT.TO", _yahoo(TSX_META))
    assert reason is None
    assert (q.price, q.previous_close, q.session, q.currency) == (43.17, 43.58, "REGULAR", "CAD")
    assert q.timezone == "America/Toronto" and q.name.startswith("iShares")


def test_yahoo_post_market_quote_is_marked():
    q, _ = qf.parse_yahoo_chart("AAPL", _yahoo(US_META, [1795553700, 1795568365], [354.0, 353.83]))
    assert q.session == "POST"
    assert q.price == pytest.approx(353.83)
    assert q.previous_close == pytest.approx(354.07), "post-market change is measured against the close"


def test_yahoo_pre_market_quote_is_marked():
    q, _ = qf.parse_yahoo_chart("AAPL", _yahoo(US_META, [1795520000], [356.10]))
    assert q.session == "PRE" and q.price == pytest.approx(356.10)


def test_yahoo_not_found():
    data = {"chart": {"result": None, "error": {"code": "Not Found", "description": "No data found"}}}
    assert qf.parse_yahoo_chart("XEQT", data) == (None, "No data found")


TMX_OK = {"data": {"getQuoteBySymbol": {
    "symbol": "XEQT", "name": "iShares Core Equity ETF Portfolio", "price": 43.17, "prevClose": 43.58,
    "exShortName": "TSX", "datetime": "2026-11-24T21:52:46-05:00",
}}}


def test_tmx_quote():
    q, reason = qf.parse_tmx_quote("XEQT.TO", TMX_OK)
    assert reason is None
    assert (q.price, q.previous_close, q.source, q.exchange) == (43.17, 43.58, "TMX", "TSX")
    assert q.quoted_at == datetime(2026, 11, 25, 2, 52, 46, tzinfo=timezone.utc)


@pytest.mark.parametrize("data,reason", [
    ({"errors": [{"code": "404"}], "data": {"getQuoteBySymbol": None}}, "not found"),
    ({"data": {"getQuoteBySymbol": None}}, "no data"),
    ({"data": {"getQuoteBySymbol": {"price": 0}}}, "no price"),
    ({"data": {"getQuoteBySymbol": {"price": None}}}, "no price"),
])
def test_tmx_failures(data, reason):
    assert qf.parse_tmx_quote("XEQT.TO", data) == (None, reason)


def test_http_errors_are_logged_and_reported(caplog):
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(429)))
    with caplog.at_level(logging.WARNING, logger="folio.quote_fetcher"):
        quote, reason = qf.fetch_yahoo_quote("XEQT.TO", client=client)
    assert quote is None and reason == "Yahoo: HTTP 429"
    assert "XEQT.TO" in caplog.text and "429" in caplog.text


# ------------------------------------------------------------- API rules

@pytest.fixture
def cad_account(db_session):
    acc = Account(name="TFSA", type=AccountType.TFSA, currency="CAD")
    db_session.add(acc)
    db_session.commit()
    return acc


def _hold(client, account, symbol):
    resp = client.post("/api/investments/holdings", json={
        "account_id": account.id, "symbol": symbol,
        "lots": [{"trade_date": "2026-01-02", "quantity": "1", "cost_basis": "10"}],
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_bare_symbol_reuses_the_listed_security(client, db_session, cad_account):
    first = _hold(client, cad_account, "XEQT.TO")
    second = _hold(client, cad_account, "XEQT")
    assert second["security_id"] == first["security_id"]
    assert second["holding_id"] == first["holding_id"]
    assert db_session.query(Security).count() == 1


def test_manual_price_replaces_a_fetched_one(client, db_session, cad_account):
    holding = _hold(client, cad_account, "XEQT.TO")
    db_session.add(PriceQuote(security_id=holding["security_id"], as_of_date=date(2026, 11, 24),
                              price_cents=4300, source="YAHOO", session="REGULAR", previous_close_cents=4358))
    db_session.commit()
    resp = client.post("/api/investments/prices", json={"symbol": "XEQT.TO", "as_of_date": "2026-11-24", "price": "44.00"})
    assert resp.json()["source"] == "MANUAL"
    db_session.expire_all()
    row = db_session.query(PriceQuote).one()
    assert (row.price_cents, row.source, row.previous_close_cents) == (4400, "MANUAL", None)


def test_valuation_reports_source_session_and_day_change(client, db_session, cad_account):
    holding = _hold(client, cad_account, "XEQT.TO")
    db_session.add(PriceQuote(security_id=holding["security_id"], as_of_date=date(2026, 11, 24),
                              price_cents=4317, source="YAHOO", session="REGULAR", previous_close_cents=4358,
                              quoted_at=datetime(2026, 11, 24, 21, 0, tzinfo=timezone.utc)))
    db_session.commit()
    h = client.get(f"/api/investments/performance?account_id={cad_account.id}").json()["holdings"][0]
    assert h["price_source"] == "YAHOO" and h["price_session"] == "REGULAR"
    assert h["previous_close"] == pytest.approx(43.58)
    assert h["day_change"] == pytest.approx(-0.41)
    assert h["day_change_pct"] == pytest.approx(-0.94)


def test_symbol_lookup(client, monkeypatch):
    def yahoo(symbol, *a, **k):
        if symbol == "XEQT.TO":
            return qf.Quote(symbol=symbol, price=43.17, source="YAHOO", name="iShares Core Equity ETF Portfolio",
                            exchange="TOR", currency="CAD"), None
        return None, "not found"

    monkeypatch.setattr(qf, "fetch_yahoo_quote", yahoo)
    monkeypatch.setattr(qf, "fetch_tmx_quote", lambda *a, **k: (None, "not found"))
    found = client.get("/api/investments/symbol-lookup?q=xeqt&currency=CAD").json()
    assert found["found"] is True and found["listing"] == "XEQT.TO" and found["price"] == 43.17
    missing = client.get("/api/investments/symbol-lookup?q=ZZZZ&currency=CAD").json()
    assert missing["found"] is False and "not found" in missing["reason"]


# ------------------------------------------------------------ migration 0009

@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "folio.db"
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", db_path)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    return db_path


def _fill(conn, table, values):
    cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
    for _, name, col_type, notnull, default, _pk in cols:
        if name in values or not notnull or default is not None:
            continue
        t = (col_type or "").upper()
        values[name] = 0 if any(k in t for k in ("INT", "BOOL", "NUMERIC", "FLOAT")) else (
            "2026-01-01 00:00:00" if "DATE" in t else "x")
    conn.execute(
        f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
        list(values.values()),
    )


def test_migration_0009_merges_bare_duplicates(temp_db):
    cfg = migrations._alembic_config()
    command.upgrade(cfg, "0008")
    conn = sqlite3.connect(str(temp_db))
    try:
        _fill(conn, "accounts", {"id": "acc", "name": "TFSA", "type": "TFSA", "current_balance_cents": 0})
        _fill(conn, "securities", {"id": "listed", "symbol": "XEQT.TO", "currency": "CAD", "asset_class": "ETF"})
        _fill(conn, "securities", {"id": "bare", "symbol": "XEQT", "currency": "CAD", "asset_class": "ETF"})
        _fill(conn, "securities", {"id": "other", "symbol": "VFV", "currency": "CAD", "asset_class": "ETF"})
        _fill(conn, "holdings", {"id": "h-listed", "account_id": "acc", "security_id": "listed"})
        _fill(conn, "holdings", {"id": "h-bare", "account_id": "acc", "security_id": "bare"})
        _fill(conn, "lots", {"id": "l1", "holding_id": "h-listed", "trade_date": "2026-01-02", "quantity": 100,
                             "cost_basis_cents": 500})
        _fill(conn, "lots", {"id": "l2", "holding_id": "h-bare", "trade_date": "2026-01-02", "quantity": 1,
                             "cost_basis_cents": 1000})
        _fill(conn, "price_quotes", {"id": "q1", "security_id": "bare", "as_of_date": "2026-11-20", "price_cents": 4200})
        conn.commit()
    finally:
        conn.close()

    command.upgrade(cfg, "0009")

    conn = sqlite3.connect(str(temp_db))
    try:
        securities = {r[0] for r in conn.execute("SELECT symbol FROM securities")}
        holdings = conn.execute("SELECT id, security_id FROM holdings").fetchall()
        lots = dict(conn.execute("SELECT id, holding_id FROM lots"))
        quotes = conn.execute("SELECT security_id, source FROM price_quotes").fetchall()
    finally:
        conn.close()

    assert securities == {"XEQT.TO", "VFV"}, "the bare XEQT merges; VFV has no listed twin"
    assert holdings == [("h-listed", "listed")]
    assert lots == {"l1": "h-listed", "l2": "h-listed"}
    assert quotes == [("listed", "MANUAL")]
