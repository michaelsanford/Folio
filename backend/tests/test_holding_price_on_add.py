"""A price chosen in the Add holding form is saved with the holding."""
from datetime import date

from app.models.account import Account, AccountType
from app.models.investment import PriceQuote, Security


def _account(db):
    acc = Account(name="TFSA", type=AccountType.TFSA, currency="CAD")
    db.add(acc)
    db.commit()
    return acc


def _add(client, account_id, **extra):
    payload = {
        "account_id": account_id,
        "symbol": "VFV.TO",
        "name": "Vanguard S&P 500 Index ETF",
        "asset_class": "ETF",
        "lots": [{"trade_date": "2026-01-05", "quantity": "10", "cost_basis": "1400"}],
        **extra,
    }
    return client.post("/api/investments/holdings", json=payload)


def test_looked_up_price_values_the_holding_at_once(client, db_session):
    acc = _account(db_session)
    resp = _add(client, acc.id, price="160.25", price_source="YAHOO", price_session="REGULAR")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_priced"] is True
    assert body["market_value"] == 1602.5
    assert body["price_source"] == "YAHOO"
    quote = db_session.query(PriceQuote).one()
    assert quote.fetched_at is not None


def test_typed_price_is_manual(client, db_session):
    acc = _account(db_session)
    body = _add(client, acc.id, price="158", price_source="MANUAL").json()
    assert body["price_source"] == "MANUAL"
    assert body["price"] == 158.0


def test_no_price_leaves_the_holding_unpriced(client, db_session):
    acc = _account(db_session)
    body = _add(client, acc.id).json()
    assert body["is_priced"] is False
    assert db_session.query(PriceQuote).count() == 0


def test_looked_up_price_never_replaces_a_typed_one(client, db_session):
    acc = _account(db_session)
    sec = Security(symbol="VFV.TO", name="VFV", currency="CAD")
    db_session.add(sec)
    db_session.flush()
    db_session.add(PriceQuote(security_id=sec.id, as_of_date=date.today(), price_cents=15000, source="MANUAL"))
    db_session.commit()

    body = _add(client, acc.id, price="160.25", price_source="YAHOO").json()
    assert (body["price_source"], body["price"]) == ("MANUAL", 150.0)
