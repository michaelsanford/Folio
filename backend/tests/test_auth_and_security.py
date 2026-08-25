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
    original_pool_id = settings.COGNITO_USER_POOL_ID
    original_client_id = settings.COGNITO_CLIENT_ID
    original_origin_secret = settings.FOLIO_ORIGIN_VERIFY_SECRET
    
    settings.FOLIO_MASTER_PASSWORD = ""
    settings.FOLIO_MASTER_PASSWORD_HASH = ""
    settings.COGNITO_USER_POOL_ID = ""
    settings.COGNITO_CLIENT_ID = ""
    settings.FOLIO_ORIGIN_VERIFY_SECRET = ""
    
    yield
    
    settings.FOLIO_MASTER_PASSWORD = original_pass
    settings.FOLIO_MASTER_PASSWORD_HASH = original_hash
    settings.COGNITO_USER_POOL_ID = original_pool_id
    settings.COGNITO_CLIENT_ID = original_client_id
    settings.FOLIO_ORIGIN_VERIFY_SECRET = original_origin_secret


def test_auth_status_when_no_password_configured_is_fail_closed():
    client = TestClient(app)
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    data = response.json()
    # Strictly fail-closed: never report authenticated when unconfigured
    assert data["authenticated"] is False
    assert data["auth_required"] is True
    assert data["auth_mode"] == "unconfigured"


def test_protected_routes_fail_closed_when_unconfigured():
    client = TestClient(app)
    response = client.get("/api/accounts")
    assert response.status_code == 401
    assert "no authentication mechanism configured" in response.json()["detail"]


def test_login_and_protected_routes_with_master_password():
    client = TestClient(app)
    test_password = "SecretPassword123!"
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password(test_password)
    
    # 1. Check status (should require auth and identify master_password mode)
    status_resp = client.get("/api/auth/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["authenticated"] is False
    assert status_resp.json()["auth_required"] is True
    assert status_resp.json()["auth_mode"] == "master_password"

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


def test_origin_header_verification():
    client = TestClient(app)
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "super-secret-origin-token"
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password("VaultPass123!")

    # 1. Request without origin header -> 403 Forbidden
    resp_no_header = client.get("/api/accounts")
    assert resp_no_header.status_code == 403
    assert "forbidden" in resp_no_header.json()["detail"].lower()

    # 2. Request with invalid origin header -> 403 Forbidden
    resp_bad_header = client.get("/api/accounts", headers={"X-Folio-Origin-Verify": "wrong-token"})
    assert resp_bad_header.status_code == 403

    # 3. Request with valid origin header -> Passes origin check (fails on auth token -> 401)
    resp_valid_origin = client.get("/api/accounts", headers={"X-Folio-Origin-Verify": "super-secret-origin-token"})
    assert resp_valid_origin.status_code == 401


def test_cognito_config_endpoint():
    client = TestClient(app)
    settings.COGNITO_USER_POOL_ID = "ca-central-1_test123"
    settings.COGNITO_CLIENT_ID = "client_abc456"
    settings.COGNITO_REGION = "ca-central-1"

    response = client.get("/api/auth/config/cognito")
    assert response.status_code == 200
    data = response.json()
    assert data["enabled"] is True
    assert data["user_pool_id"] == "ca-central-1_test123"
    assert data["client_id"] == "client_abc456"


def test_security_headers():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Content-Security-Policy") is not None
    assert "default-src 'self'" in response.headers.get("Content-Security-Policy")
    assert response.headers.get("Permissions-Policy") is not None



def test_spa_path_traversal_defense():
    client = TestClient(app)
    # Attempt path traversal against arbitrary backend file
    response = client.get("/../../app/core/config.py")
    # Response should serve index.html (or 404), never the Python source code
    assert response.status_code in (200, 404)
    assert "class Settings" not in response.text

