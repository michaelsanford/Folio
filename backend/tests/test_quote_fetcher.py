from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account, AccountType
from app.models.investment import Security, Holding, Lot
import app.services.investments.quote_fetcher as qf


def test_automated_quote_fetching(client: TestClient, db_session: Session, monkeypatch):
    # Setup investment account and security (e.g. XEQT.TO)
    acc = Account(name="TFSA Trading", type=AccountType.TFSA, currency="CAD", current_balance_cents=0)
    db_session.add(acc)
    db_session.flush()

    sec = Security(symbol="XEQT.TO", name="iShares Core Equity ETF Portfolio", currency="CAD")
    db_session.add(sec)
    db_session.flush()

    holding = Holding(account_id=acc.id, security_id=sec.id)
    db_session.add(holding)
    db_session.flush()

    lot = Lot(holding_id=holding.id, trade_date=datetime.now().date(), quantity=100, cost_basis_cents=280000)
    db_session.add(lot)
    db_session.commit()

    # Mock external network calls
    def mock_boc_rate(*args, **kwargs):
        return 1.3850

    def mock_yahoo(symbol, *args, **kwargs):
        if symbol == "XEQT.TO":
            return qf.Quote(symbol=symbol, price=32.50, source="YAHOO", currency="CAD"), None
        return None, "not found"

    import app.api.investments as inv_api
    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", mock_boc_rate)
    monkeypatch.setattr(inv_api, "fetch_boc_usdcad_rate", mock_boc_rate)
    monkeypatch.setattr(qf, "fetch_yahoo_quote", mock_yahoo)
    monkeypatch.setattr(qf, "fetch_tmx_quote", lambda *a, **k: (None, "not found"))

    # 1. Test FX rate endpoint
    fx_resp = client.get("/api/investments/fx-rate")
    assert fx_resp.status_code == 200
    assert fx_resp.json()["pair"] == "USDCAD"
    assert fx_resp.json()["rate"] == 1.3850

    # 2. Test Automated Quote update
    resp = client.post("/api/investments/quotes/fetch-automated", json=["XEQT.TO"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated_count"] == 1
    assert data["quotes"][0]["symbol"] == "XEQT.TO"
    assert data["quotes"][0]["price"] == 32.50

    # 3. Check account revaluation
    acc_check = client.get(f"/api/accounts/{acc.id}")
    assert acc_check.status_code == 200
    # 100 shares * $32.50 = $3,250.00
    assert acc_check.json()["current_balance"] == 3250.0
from datetime import datetime



def test_an_empty_symbol_list_refreshes_everything(client: TestClient, db_session: Session, monkeypatch):
    """The app sent {"symbols": []}, which used to refresh nothing at all."""
    acc = Account(name="TFSA", type=AccountType.TFSA, currency="CAD")
    db_session.add(acc)
    db_session.flush()
    sec = Security(symbol="XEQT.TO", currency="CAD")
    db_session.add(sec)
    db_session.flush()
    db_session.add(Holding(account_id=acc.id, security_id=sec.id))
    db_session.commit()

    monkeypatch.setattr(qf, "fetch_boc_usdcad_rate", lambda *a, **k: None)
    monkeypatch.setattr(qf, "fetch_tmx_quote", lambda *a, **k: (None, "not found"))
    monkeypatch.setattr(
        qf, "fetch_yahoo_quote",
        lambda s, *a, **k: (qf.Quote(symbol=s, price=43.17, source="YAHOO"), None),
    )
    data = client.post("/api/investments/quotes/fetch-automated", json={"symbols": []}).json()
    assert data["updated_count"] == 1
