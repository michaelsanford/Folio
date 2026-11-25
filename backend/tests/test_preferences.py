"""GET/PUT /me/preferences: per-user rows, validation, size limit, lenient reads."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, require_auth, user_key_from_claims
from app.main import app
from app.models.user_preference import UserPreference

URL = f"{settings.API_V1_STR}/me/preferences"

FR_CA = {
    "preset": "fr-CA",
    "negative_style": "minus",
    "group_separator": " ",
    "decimal_separator": ",",
    "symbol_position": "after",
    "symbol_space": True,
}


@pytest.fixture
def owner_client(db_session, monkeypatch):
    """Real require_auth with a master-passphrase session token."""
    monkeypatch.setattr(settings, "FOLIO_MASTER_PASSWORD", "")
    monkeypatch.setattr(settings, "FOLIO_MASTER_PASSWORD_HASH", "$2b$12$placeholderplaceholderplaceholderplaceholderplaceh")
    monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "")
    monkeypatch.setattr(settings, "COGNITO_CLIENT_ID", "")
    monkeypatch.setattr(settings, "FOLIO_ORIGIN_VERIFY_SECRET", "")

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    token = create_access_token({"sub": "owner"})
    with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c
    app.dependency_overrides.clear()


def _as_claims(claims: dict):
    app.dependency_overrides[require_auth] = lambda: claims


def test_nothing_saved_returns_empty_shape(client):
    resp = client.get(URL)
    assert resp.status_code == 200
    assert resp.json() == {"preferences": {}, "updated_at": None}


def test_owner_round_trip(owner_client, db_session):
    body = {"theme": "nord", "color_mode": "dark", "number_format": FR_CA}
    put = owner_client.put(URL, json=body)
    assert put.status_code == 200, put.text
    assert put.json()["preferences"] == body
    assert put.json()["updated_at"] is not None

    got = owner_client.get(URL).json()
    assert got["preferences"] == body
    assert got["preferences"]["number_format"]["group_separator"] == " "
    assert datetime.fromisoformat(got["updated_at"]).tzinfo is not None

    row = db_session.get(UserPreference, "owner")
    assert row is not None
    assert json.loads(row.data) == body

    # Full replacement: omitted fields are cleared.
    owner_client.put(URL, json={"sidebar_collapsed": True})
    assert owner_client.get(URL).json()["preferences"] == {"sidebar_collapsed": True}


def test_dashboard_hidden_accounts_round_trip(client):
    body = {"dashboard_hidden_account_ids": ["a1", "b2"]}
    assert client.put(URL, json=body).status_code == 200
    assert client.get(URL).json()["preferences"] == body


def test_dashboard_hidden_accounts_are_bounded(client):
    assert client.put(URL, json={"dashboard_hidden_account_ids": ["x"] * 101}).status_code == 422
    assert client.put(URL, json={"dashboard_hidden_account_ids": ["x" * 65]}).status_code == 422


def test_cognito_users_get_separate_rows(client, db_session):
    _as_claims({"sub": "11111111-aaaa", "token_use": "access", "client_id": "c"})
    assert client.put(URL, json={"theme": "dracula"}).status_code == 200
    _as_claims({"sub": "22222222-bbbb", "token_use": "id", "aud": "c"})
    assert client.get(URL).json() == {"preferences": {}, "updated_at": None}
    assert client.put(URL, json={"theme": "gruvbox"}).status_code == 200

    _as_claims({"sub": "11111111-aaaa", "token_use": "access", "client_id": "c"})
    assert client.get(URL).json()["preferences"] == {"theme": "dracula"}
    keys = {r.user_key for r in db_session.query(UserPreference).all()}
    assert keys == {"cognito:11111111-aaaa", "cognito:22222222-bbbb"}


def test_user_key_from_claims():
    assert user_key_from_claims({"sub": "owner", "iss": "folio-vault"}) == "owner"
    assert user_key_from_claims({"sub": "abc", "token_use": "access", "client_id": "c"}) == "cognito:abc"
    # A Cognito user whose sub happened to be "owner" still cannot read the owner's row.
    assert user_key_from_claims({"sub": "owner", "token_use": "access"}) == "cognito:owner"
    for bad in ({}, {"sub": ""}, {"sub": None}, {"sub": "x" * 200}):
        with pytest.raises(Exception) as exc:
            user_key_from_claims(bad)
        assert getattr(exc.value, "status_code", None) == 401


@pytest.mark.parametrize(
    "body",
    [
        {"unknown_key": 1},
        {"theme": "solarized"},
        {"color_mode": "sepia"},
        {"number_format": {**FR_CA, "extra": 1}},
        {"number_format": {"preset": "en-CA"}},
        {"number_format": {**FR_CA, "group_separator": " "}},  # ASCII space is not allowed
        ["not", "an", "object"],
    ],
)
def test_invalid_bodies_are_422(client, body):
    resp = client.put(URL, json=body)
    assert resp.status_code == 422, resp.text
    assert client.get(URL).json() == {"preferences": {}, "updated_at": None}


def test_malformed_json_is_422(client):
    resp = client.put(URL, content=b"{not json", headers={"Content-Type": "application/json"})
    assert resp.status_code == 422


def test_oversized_body_is_413(client):
    big = json.dumps({"theme": "nord", "pad": "x" * 5000})
    resp = client.put(URL, content=big, headers={"Content-Type": "application/json"})
    assert resp.status_code == 413

    # Without a usable Content-Length the streamed size is still checked.
    def chunks():
        yield big.encode()

    resp = client.put(URL, content=chunks(), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413


def test_obsolete_stored_field_is_dropped(client, db_session, caplog):
    db_session.add(UserPreference(
        user_key="test-owner",
        data=json.dumps({"theme": "retired-theme", "color_mode": "dark", "gone": 1}),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    ))
    db_session.commit()
    with caplog.at_level("WARNING", logger="folio.preferences"):
        resp = client.get(URL)
    assert resp.status_code == 200
    assert resp.json()["preferences"] == {"color_mode": "dark"}
    assert resp.json()["updated_at"].startswith("2026-01-01T00:00:00")
    assert any("theme" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("data", ["{corrupt", "[1, 2]", "null"])
def test_corrupt_stored_json_reads_as_empty(client, db_session, data):
    db_session.add(UserPreference(user_key="test-owner", data=data, updated_at=datetime.now(timezone.utc)))
    db_session.commit()
    resp = client.get(URL)
    assert resp.status_code == 200
    assert resp.json()["preferences"] == {}


def test_requires_auth(unauthenticated_client):
    assert unauthenticated_client.get(URL).status_code == 401
    assert unauthenticated_client.put(URL, json={"theme": "nord"}).status_code == 401
