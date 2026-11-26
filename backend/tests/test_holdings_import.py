"""Broker holdings exports: detection, parsing, preview and the snapshot import."""
import io
from datetime import date
from decimal import Decimal

from app.models.account import Account, AccountType
from app.models.investment import AssetClass, Holding, Lot, PriceQuote, Security
from app.services.ingestion.holdings_parser import looks_like_holdings_export, parse_holdings_export
from app.services.investments.performance import load_holdings, value_holdings
import app.services.investments.quote_fetcher as qf

# The RBC Direct Investing layout, with made-up numbers.
EXPORT = '''"Holdings Export as of Nov 26, 2026 4:03:51 PM ET"

Account: 55501234 - TFSA

"Balances as of Nov 25, 2026"

,Trailing 12 Mo Return,Unrealized Gain/Loss in CAD,Unrealized Gain/Loss in CAD (%),Combined Book Cost in CAD,Combined Book Cost in USD,Combined Total in CAD,Combined Total in USD
,"5.00%","10.00","1.00","1000.00","700.00","{total}","800.00"

Currency,Cash,Investments,Total,Exchange Rate to CAD
CAD,"{cad_cash}","1000.00","1100.00",1
USD,"10.00","0.00","10.00",1.40

,Product,Symbol,Name,Quantity,Last Price,Currency,Change $,Change %,Total Book Cost,Total Market Value,Unrealized Gain/Loss $,Unrealized Gain/Loss %,Average Cost,Annual Dividend Amount $,Dividend Ex Date,Load Type,RSP Eligibility,Automatic Investment Plan,DRIP Eligibility,Coupon Rate,Maturity Date,Expiration Date,Open Interest
{rows}

Important Information
"Some quotes or market data may be delayed."
"RBC Direct Investing does not provide investment advice or recommendations."
'''

ROWS = [
    'CAD Holdings,"ETFs and ETNs",XEQT,ISHARES CORE EQUITY ETF PORTFOLIO UNITS,"{xeqt}","40.00",CAD,"0.50","1.2%","{xeqt_cost}","{xeqt_value}","0","0%","36.00",,,"","","","Yes",,,,',
    'CAD Holdings,"Common Shares",ABC,ABC MINING CORP COM,"100","2.50",CAD,"-0.10","-3.8%","300.00","250.00","-50.00","-16.6%","3.00",,,"","","","",,,,',
    'CAD Holdings,"Trust Units",PHYS,SPROTT PHYSICAL GOLD TR UNIT,"10","30.00",CAD,"0.30","1%","290.00","300.00","10.00","3.4%","29.00",,,"","","","",,,,',
]


def make_export(xeqt=10, xeqt_cost="360.00", cad_cash="100.00", rows=None):
    value = Decimal(xeqt) * Decimal("40.00")
    body = "\n".join(rows if rows is not None else ROWS).format(
        xeqt=xeqt, xeqt_cost=xeqt_cost, xeqt_value=f"{value:.2f}"
    )
    total = value + Decimal("250.00") + Decimal("300.00") + Decimal(cad_cash) + Decimal("14.00")
    return EXPORT.format(rows=body, cad_cash=cad_cash, total=f"{total:.2f}")


def upload(client, text, name="Holdings 55501234 November 26, 2026.csv", account_id=None):
    data = {"account_id": account_id} if account_id else {}
    return client.post(
        "/api/ingestion/upload-preview",
        data=data,
        files={"file": (name, io.BytesIO(text.encode("utf-8")), "text/csv")},
    )


def commit_payload(preview, **overrides):
    h = preview["holdings"]
    acc = h["account"]
    payload = {
        "statement_file_id": preview["file_id"],
        "account": {
            "source_account_key": acc["source_account_key"],
            "existing_account_id": acc["matched_account_id"],
            "name": acc["suggested_name"],
            "type": acc["suggested_type"],
            "institution": acc["institution"],
            "account_number_mask": acc["account_number_mask"],
            "currency": acc["currency"],
        },
        "as_of_date": h["as_of_date"],
        "positions": [
            {k: p[k] for k in ("symbol", "name", "asset_class", "currency", "quantity", "book_cost",
                               "last_price", "previous_close", "market_value")}
            for p in h["positions"]
        ],
        "cash_total": h["cash_total"],
        "remove_holding_ids": [],
    }
    payload.update(overrides)
    return payload


# ------------------------------------------------------------------ parsing

def test_detects_holdings_export_but_not_a_transactions_csv():
    assert looks_like_holdings_export(make_export())
    transactions = (
        "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$\n"
        "Chequing,00000-1234567,11/20/2026,,GROCERY STORE,,-45.20,\n"
    )
    assert not looks_like_holdings_export(transactions)


def test_parses_account_cash_positions_and_totals():
    parsed = parse_holdings_export(make_export())
    assert parsed.as_of_date == date(2026, 11, 26)
    assert parsed.account_number == "55501234"
    assert parsed.account_label == "TFSA"
    assert [(c.currency, c.amount, c.rate_to_cad) for c in parsed.cash] == [
        ("CAD", Decimal("100.00"), Decimal("1")),
        ("USD", Decimal("10.00"), Decimal("1.40")),
    ]
    assert parsed.cash_in("CAD") == Decimal("114.00")
    by_symbol = {p.symbol: p for p in parsed.positions}
    assert by_symbol["XEQT"].asset_class == AssetClass.ETF
    assert by_symbol["ABC"].asset_class == AssetClass.EQUITY
    assert by_symbol["PHYS"].asset_class == AssetClass.OTHER
    assert by_symbol["XEQT"].quantity == Decimal("10")
    assert by_symbol["XEQT"].previous_close == Decimal("39.50")
    assert parsed.combined_total_cad == Decimal("1064.00")
    assert parsed.row_errors == []


def test_unreadable_quantity_is_reported_not_guessed():
    rows = ROWS[:1] + ['CAD Holdings,"Common Shares",BAD,BAD CO,"n/a","1.00",CAD,"0","0%","1","1","0","0%","1",,,,,,,,,,']
    parsed = parse_holdings_export(make_export(rows=rows))
    assert [p.symbol for p in parsed.positions] == ["XEQT"]
    assert parsed.row_errors[0].field == "quantity"


# ------------------------------------------------------------------ preview + commit

def test_preview_proposes_a_new_registered_account(client, db_session):
    resp = upload(client, make_export())
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    assert preview["kind"] == "HOLDINGS"
    h = preview["holdings"]
    assert h["account"]["suggested_type"] == "TFSA"
    assert h["account"]["account_number_mask"] == "*1234"
    assert h["account"]["matched_account_id"] is None
    assert "RBC" in h["account"]["suggested_name"]
    assert [p["status"] for p in h["positions"]] == ["NEW", "NEW", "NEW"]
    assert h["cash_total"] == 114.0
    assert h["file_total"] == 1064.0
    assert h["import_total"] == 1064.0


def test_commit_creates_account_holdings_prices_and_cash(client, db_session):
    preview = upload(client, make_export()).json()
    resp = client.post("/api/ingestion/holdings/commit", json=commit_payload(preview))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] is True
    assert body["added_count"] == 3
    assert body["new_account_balance"] == 1064.0

    account = db_session.query(Account).filter(Account.id == body["account_id"]).one()
    assert account.type == AccountType.TFSA
    assert account.current_balance_cents == 106400

    xeqt = db_session.query(Security).filter(Security.symbol == "XEQT").one()
    quote = db_session.query(PriceQuote).filter(PriceQuote.security_id == xeqt.id).one()
    assert (quote.source, quote.price_cents, quote.previous_close_cents) == ("IMPORT", 4000, 3950)
    assert quote.as_of_date == date(2026, 11, 26)

    cash = db_session.query(Security).filter(Security.symbol == "$CAD").one()
    assert cash.asset_class == AssetClass.CASH
    values = {v["symbol"]: v for v in value_holdings(db_session, load_holdings(db_session, [account.id]))}
    assert values["$CAD"]["market_value_cents"] == 11400
    assert values["$CAD"]["is_priced"]


def test_reimport_is_unchanged_and_keeps_lot_dates(client, db_session):
    first = upload(client, make_export()).json()
    account_id = client.post("/api/ingestion/holdings/commit", json=commit_payload(first)).json()["account_id"]
    lot = db_session.query(Lot).first()
    lot.trade_date = date(2020, 1, 2)
    db_session.commit()

    again = upload(client, make_export()).json()
    h = again["holdings"]
    assert h["account"]["matched_account_id"] == account_id
    assert {p["status"] for p in h["positions"]} == {"UNCHANGED"}
    assert h["missing"] == []

    body = client.post("/api/ingestion/holdings/commit", json=commit_payload(again)).json()
    assert (body["added_count"], body["updated_count"], body["unchanged_count"]) == (0, 0, 3)
    db_session.expire_all()
    assert db_session.query(Lot).filter(Lot.trade_date == date(2020, 1, 2)).count() == 1


def test_changed_position_replaces_lots_and_missing_ones_stay_unless_ticked(client, db_session):
    first = upload(client, make_export()).json()
    client.post("/api/ingestion/holdings/commit", json=commit_payload(first))

    # XEQT grew and ABC was sold.
    later = make_export(xeqt=12, xeqt_cost="440.00", rows=[ROWS[0], ROWS[2]])
    preview = upload(client, later).json()
    h = preview["holdings"]
    xeqt = next(p for p in h["positions"] if p["symbol"] == "XEQT")
    assert xeqt["status"] == "CHANGED"
    assert Decimal(str(xeqt["current_quantity"])) == 10
    assert [m["symbol"] for m in h["missing"]] == ["ABC"]

    body = client.post("/api/ingestion/holdings/commit", json=commit_payload(preview)).json()
    assert (body["updated_count"], body["removed_count"]) == (1, 0)
    db_session.expire_all()
    symbols = {h.security.symbol for h in load_holdings(db_session, [body["account_id"]])}
    assert "ABC" in symbols, "a position missing from the file stays unless ticked"
    xeqt_holding = next(h for h in load_holdings(db_session, [body["account_id"]]) if h.security.symbol == "XEQT")
    assert [(lot.quantity, lot.cost_basis_cents) for lot in xeqt_holding.lots] == [(Decimal("12"), 44000)]

    preview = upload(client, later).json()
    abc_id = preview["holdings"]["missing"][0]["holding_id"]
    body = client.post(
        "/api/ingestion/holdings/commit", json=commit_payload(preview, remove_holding_ids=[abc_id])
    ).json()
    assert body["removed_count"] == 1
    db_session.expire_all()
    assert "ABC" not in {h.security.symbol for h in load_holdings(db_session, [body["account_id"]])}


def test_compare_against_another_account(client, db_session):
    other = Account(name="Old TFSA", type=AccountType.TFSA, currency="CAD")
    db_session.add(other)
    db_session.flush()
    sec = Security(symbol="ABC", name="ABC", currency="CAD")
    db_session.add(sec)
    db_session.flush()
    holding = Holding(account_id=other.id, security_id=sec.id)
    db_session.add(holding)
    db_session.flush()
    db_session.add(Lot(holding_id=holding.id, trade_date=date(2024, 1, 1), quantity=100, cost_basis_cents=30000))
    db_session.commit()

    preview = upload(client, make_export()).json()
    payload = commit_payload(preview)
    resp = client.post(
        "/api/ingestion/holdings/compare",
        json={"account_id": other.id, "positions": payload["positions"],
              "cash": preview["holdings"]["cash"], "file_total": preview["holdings"]["file_total"]},
    )
    assert resp.status_code == 200, resp.text
    statuses = {p["symbol"]: p["status"] for p in resp.json()["positions"]}
    assert statuses == {"XEQT": "NEW", "ABC": "UNCHANGED", "PHYS": "NEW"}


def test_holdings_cannot_go_into_a_bank_account(client, db_session, sample_checking_account):
    preview = upload(client, make_export()).json()
    payload = commit_payload(preview)
    payload["account"]["existing_account_id"] = sample_checking_account.id
    resp = client.post("/api/ingestion/holdings/commit", json=payload)
    assert resp.status_code == 400
    assert upload(client, make_export(), account_id=sample_checking_account.id).status_code == 400


def test_a_hand_typed_price_for_the_day_is_kept(client, db_session):
    sec = Security(symbol="XEQT", name="XEQT", currency="CAD")
    db_session.add(sec)
    db_session.flush()
    db_session.add(PriceQuote(security_id=sec.id, as_of_date=date(2026, 11, 26), price_cents=4123, source="MANUAL"))
    db_session.commit()

    preview = upload(client, make_export()).json()
    assert client.post("/api/ingestion/holdings/commit", json=commit_payload(preview)).status_code == 200
    db_session.expire_all()
    quote = db_session.query(PriceQuote).filter(PriceQuote.security_id == sec.id).one()
    assert (quote.source, quote.price_cents) == ("MANUAL", 4123)


def test_quote_refresh_skips_cash(client, db_session, monkeypatch):
    preview = upload(client, make_export(rows=[])).json()
    client.post("/api/ingestion/holdings/commit", json=commit_payload(preview))
    asked: list[str] = []

    def fake(symbol, *a, **k):
        asked.append(symbol)
        return None, "not found"

    monkeypatch.setattr(qf, "fetch_yahoo_quote", fake)
    monkeypatch.setattr(qf, "fetch_tmx_quote", fake)
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: None)
    qf.update_quotes_for_securities(db_session)
    assert not any("CAD" in s for s in asked)
