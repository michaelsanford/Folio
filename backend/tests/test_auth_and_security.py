import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.security import hash_password


@pytest.fixture(autouse=True)
def reset_auth_settings():
    """Ensure clean auth settings before and after each test."""
    original_pass = settings.FOLIO_MASTER_PASSWORD
    original_hash = settings.FOLIO_MASTER_PASSWORD_HASH
    settings.FOLIO_MASTER_PASSWORD = ""
    settings.FOLIO_MASTER_PASSWORD_HASH = ""
    yield
    settings.FOLIO_MASTER_PASSWORD = original_pass
    settings.FOLIO_MASTER_PASSWORD_HASH = original_hash


def test_auth_status_when_no_password_configured():
    client = TestClient(app)
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert data["authenticated"] is True
    assert data["auth_required"] is False


def test_login_and_protected_routes():
    client = TestClient(app)
    test_password = "SecretPassword123!"
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password(test_password)
    
    # 1. Check status (should require auth)
    status_resp = client.get("/api/auth/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["authenticated"] is False
    assert status_resp.json()["auth_required"] is True

    # 2. Attempt protected endpoint without auth -> 401
    unauth_resp = client.get("/api/accounts")
    assert unauth_resp.status_code == 401

    # 3. Attempt login with wrong password -> 401
    bad_login = client.post("/api/auth/login", json={"password": "WrongPassword"})
    assert bad_login.status_code == 401

    # 4. Login with correct password -> 200 + token
    good_login = client.post("/api/auth/login", json={"password": test_password})
    assert good_login.status_code == 200
    token = good_login.json()["access_token"]
    assert token is not None

    # 5. Access protected endpoint with Bearer token -> 200
    auth_resp = client.get("/api/accounts", headers={"Authorization": f"Bearer {token}"})
    assert auth_resp.status_code == 200


def test_security_headers():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
