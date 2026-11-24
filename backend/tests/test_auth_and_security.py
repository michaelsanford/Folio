import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import jwt
import pytest
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core import security
from app.core.config import settings
from app.core.rate_limit import login_limiter
from app.core.security import (
    COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    create_access_token,
    decode_access_token,
    decode_cognito_token,
    hash_password,
)
from app.main import app


@pytest.fixture(autouse=True)
def reset_auth_settings():
    """Ensure clean auth settings before and after each test."""
    original_pass = settings.FOLIO_MASTER_PASSWORD
    original_hash = settings.FOLIO_MASTER_PASSWORD_HASH
    original_pool_id = settings.COGNITO_USER_POOL_ID
    original_client_id = settings.COGNITO_CLIENT_ID
    original_region = settings.COGNITO_REGION
    original_origin_secret = settings.FOLIO_ORIGIN_VERIFY_SECRET

    settings.FOLIO_MASTER_PASSWORD = ""
    settings.FOLIO_MASTER_PASSWORD_HASH = ""
    settings.COGNITO_USER_POOL_ID = ""
    settings.COGNITO_CLIENT_ID = ""
    settings.COGNITO_REGION = "ca-central-1"
    settings.FOLIO_ORIGIN_VERIFY_SECRET = ""
    security._jwk_client = None
    security._jwk_client_url = None
    login_limiter.clear()

    yield

    settings.FOLIO_MASTER_PASSWORD = original_pass
    settings.FOLIO_MASTER_PASSWORD_HASH = original_hash
    settings.COGNITO_USER_POOL_ID = original_pool_id
    settings.COGNITO_CLIENT_ID = original_client_id
    settings.COGNITO_REGION = original_region
    settings.FOLIO_ORIGIN_VERIFY_SECRET = original_origin_secret
    security._jwk_client = None
    security._jwk_client_url = None
    login_limiter.clear()


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


def test_login_and_protected_routes_with_master_password(unauthenticated_client):
    # Real auth dependency, isolated database -- this test reaches a protected
    # route that actually queries, so it must not run against the developer DB.
    client = unauthenticated_client
    test_password = f"SecretPass-{secrets.token_urlsafe(16)}"
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
    wrong_password = f"Wrong-{secrets.token_urlsafe(16)}"
    bad_login = client.post("/api/auth/login", json={"password": wrong_password})
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
    origin_token = secrets.token_hex(16)
    vault_password = f"Vault-{secrets.token_urlsafe(16)}"
    settings.FOLIO_ORIGIN_VERIFY_SECRET = origin_token
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password(vault_password)

    # 1. Request without origin header -> 403 Forbidden
    resp_no_header = client.get("/api/accounts")
    assert resp_no_header.status_code == 403
    assert "forbidden" in resp_no_header.json()["detail"].lower()

    # 2. Request with invalid origin header -> 403 Forbidden
    resp_bad_header = client.get("/api/accounts", headers={"X-Folio-Origin-Verify": "wrong-token"})
    assert resp_bad_header.status_code == 403

    # 3. Request with valid origin header -> Passes origin check (fails on auth token -> 401)
    resp_valid_origin = client.get("/api/accounts", headers={"X-Folio-Origin-Verify": origin_token})
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


def test_security_headers(unauthenticated_client):
    # /api/health now queries the database, so use the isolated test DB.
    response = unauthenticated_client.get("/api/health")
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



def _cognito_client_error(code: str, message: str) -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": message}},
        "CognitoIdentityProviderOperation",
    )


def _enable_test_cognito():
    settings.COGNITO_USER_POOL_ID = "ca-central-1_TestPool1"
    settings.COGNITO_CLIENT_ID = "client_test_123"
    settings.COGNITO_REGION = "ca-central-1"


def test_hs256_token_rejected_when_cognito_enabled(unauthenticated_client):
    _enable_test_cognito()
    local_token = create_access_token({"sub": "owner"})

    assert decode_access_token(local_token) is None
    resp = unauthenticated_client.get(
        "/api/accounts",
        headers={"Authorization": f"Bearer {local_token}"},
    )
    assert resp.status_code == 401


def test_master_password_login_rejected_when_cognito_enabled(unauthenticated_client):
    _enable_test_cognito()
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password("SomeStrongPassword123!")

    resp = unauthenticated_client.post("/api/auth/login", json={"password": "SomeStrongPassword123!"})
    assert resp.status_code == 400
    assert "Cognito" in resp.json()["detail"]


def test_cognito_token_validation_claims(monkeypatch):
    _enable_test_cognito()
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    fake_jwk = MagicMock()
    fake_jwk.get_signing_key_from_jwt.return_value = SimpleNamespace(key=public_key)
    monkeypatch.setattr("app.core.security.get_jwk_client", lambda: fake_jwk)

    exp = datetime.now(timezone.utc) + timedelta(hours=1)
    iss = settings.cognito_issuer

    valid_access = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "access", "client_id": "client_test_123"},
        private_key,
        algorithm="RS256",
    )
    valid_id = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "id", "aud": "client_test_123"},
        private_key,
        algorithm="RS256",
    )
    wrong_access = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "access", "client_id": "other_client"},
        private_key,
        algorithm="RS256",
    )
    missing_client_access = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "access"},
        private_key,
        algorithm="RS256",
    )
    wrong_id = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "id", "aud": "other_client"},
        private_key,
        algorithm="RS256",
    )
    bad_use = jwt.encode(
        {"sub": "u-1", "iss": iss, "exp": exp, "token_use": "refresh", "client_id": "client_test_123"},
        private_key,
        algorithm="RS256",
    )

    assert decode_cognito_token(valid_access)["sub"] == "u-1"
    assert decode_cognito_token(valid_id)["sub"] == "u-1"
    assert decode_cognito_token(wrong_access) is None
    assert decode_cognito_token(missing_client_access) is None
    assert decode_cognito_token(wrong_id) is None
    assert decode_cognito_token(bad_use) is None


def test_cognito_invited_onboarding_and_mfa_flow(unauthenticated_client, monkeypatch):
    _enable_test_cognito()
    mock_client = MagicMock()
    monkeypatch.setattr("app.core.cognito.get_cognito_client", lambda: mock_client)

    mock_client.initiate_auth.return_value = {
        "ChallengeName": "NEW_PASSWORD_REQUIRED",
        "Session": "sess-1",
    }
    mock_client.respond_to_auth_challenge.side_effect = [
        {"ChallengeName": "MFA_SETUP", "Session": "sess-2"},
        {
            "AuthenticationResult": {
                "AccessToken": "access-jwt-token",
                "RefreshToken": "refresh-jwt-token",
                "ExpiresIn": 3600,
            }
        },
    ]
    mock_client.associate_software_token.return_value = {
        "SecretCode": "JBSWY3DPEHPK3PXP",
        "Session": "sess-3",
    }
    mock_client.verify_software_token.return_value = {
        "Status": "SUCCESS",
        "Session": "sess-4",
    }

    # 1. Login with temporary password -> NEW_PASSWORD_REQUIRED
    resp1 = unauthenticated_client.post(
        "/api/auth/cognito/login",
        json={"email": "Owner@Example.com", "password": "TempPass123!"},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["status"] == "challenge"
    assert data1["challenge"] == "NEW_PASSWORD_REQUIRED"
    assert data1["session"] == "sess-1"
    assert data1["username"] == "owner@example.com"

    # 2. Submit permanent passphrase -> MFA_SETUP with QR & secret
    resp2 = unauthenticated_client.post(
        "/api/auth/cognito/challenge",
        json={
            "challenge": "NEW_PASSWORD_REQUIRED",
            "username": "owner@example.com",
            "session": "sess-1",
            "new_password": "very long unique household passphrase",
        },
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "challenge"
    assert data2["challenge"] == "MFA_SETUP"
    assert data2["session"] == "sess-3"
    assert data2["totp_secret"] == "JBSWY3DPEHPK3PXP"
    assert "otpauth://totp/Folio:owner%40example.com" in data2["otpauth_uri"]
    assert data2["qr_data_uri"].startswith("data:image/svg+xml")

    # 3. Verify 6-digit TOTP setup code -> authenticated with HttpOnly cookies
    resp3 = unauthenticated_client.post(
        "/api/auth/cognito/challenge",
        json={
            "challenge": "MFA_SETUP",
            "username": "owner@example.com",
            "session": "sess-3",
            "totp_code": "123 456",
        },
        headers={"X-Forwarded-Proto": "https"},
    )
    assert resp3.status_code == 200
    data3 = resp3.json()
    assert data3["status"] == "authenticated"
    assert "access_token" not in resp3.text
    assert "refresh_token" not in resp3.text

    mock_client.verify_software_token.assert_called_once_with(
        Session="sess-3",
        UserCode="123456",
        FriendlyDeviceName="Folio Authenticator",
    )
    set_cookies = resp3.headers.get_list("set-cookie")
    assert any(COOKIE_NAME in c and "HttpOnly" in c and "Secure" in c for c in set_cookies)
    assert any(REFRESH_COOKIE_NAME in c and "HttpOnly" in c and "Secure" in c for c in set_cookies)


def test_cognito_returning_mfa_and_error_handling(unauthenticated_client, monkeypatch):
    _enable_test_cognito()
    mock_client = MagicMock()
    monkeypatch.setattr("app.core.cognito.get_cognito_client", lambda: mock_client)

    # Returning user -> SOFTWARE_TOKEN_MFA
    mock_client.initiate_auth.return_value = {
        "ChallengeName": "SOFTWARE_TOKEN_MFA",
        "Session": "mfa-sess",
    }
    resp = unauthenticated_client.post(
        "/api/auth/cognito/login",
        json={"email": "owner@example.com", "password": "long-valid-passphrase-here"},
    )
    assert resp.status_code == 200
    assert resp.json()["challenge"] == "SOFTWARE_TOKEN_MFA"

    # Invalid TOTP code -> 400
    mock_client.respond_to_auth_challenge.side_effect = _cognito_client_error(
        "CodeMismatchException", "Invalid code"
    )
    bad_mfa = unauthenticated_client.post(
        "/api/auth/cognito/challenge",
        json={
            "challenge": "SOFTWARE_TOKEN_MFA",
            "username": "owner@example.com",
            "session": "mfa-sess",
            "totp_code": "000000",
        },
    )
    assert bad_mfa.status_code == 400

    # No user enumeration on wrong user vs wrong password
    login_limiter.clear()
    mock_client.initiate_auth.side_effect = _cognito_client_error("UserNotFoundException", "User does not exist")
    r_not_found = unauthenticated_client.post(
        "/api/auth/cognito/login",
        json={"email": "missing@example.com", "password": "wrong"},
    )
    mock_client.initiate_auth.side_effect = _cognito_client_error("NotAuthorizedException", "Incorrect username or password")
    r_bad_pass = unauthenticated_client.post(
        "/api/auth/cognito/login",
        json={"email": "owner@example.com", "password": "wrong"},
    )
    assert r_not_found.status_code == 401
    assert r_bad_pass.status_code == 401
    assert r_not_found.json()["detail"] == r_bad_pass.json()["detail"]

    # Repeated 401 failures trigger 429 rate limiting
    statuses = [
        unauthenticated_client.post(
            "/api/auth/cognito/login",
            json={"email": "owner@example.com", "password": "wrong"},
        ).status_code
        for _ in range(10)
    ]
    assert 429 in statuses


def test_cognito_refresh_status_and_logout(unauthenticated_client, monkeypatch):
    _enable_test_cognito()
    mock_client = MagicMock()
    monkeypatch.setattr("app.core.cognito.get_cognito_client", lambda: mock_client)

    # 1. Valid refresh cookie transparently restores session on GET /api/auth/status
    mock_client.initiate_auth.return_value = {
        "AuthenticationResult": {
            "AccessToken": "fresh-access-jwt",
            "ExpiresIn": 3600,
        }
    }
    unauthenticated_client.cookies.set(REFRESH_COOKIE_NAME, "valid-refresh-tok")
    status_resp = unauthenticated_client.get("/api/auth/status")
    assert status_resp.status_code == 200
    assert status_resp.json()["authenticated"] is True
    assert any(COOKIE_NAME in c for c in status_resp.headers.get_list("set-cookie"))

    # 2. POST /api/auth/cognito/refresh works directly
    refresh_ok = unauthenticated_client.post("/api/auth/cognito/refresh")
    assert refresh_ok.status_code == 200
    assert refresh_ok.json()["authenticated"] is True

    # 3. Invalid refresh token clears stale cookies and returns 401
    mock_client.initiate_auth.side_effect = _cognito_client_error("NotAuthorizedException", "Refresh Token has expired")
    refresh_fail = unauthenticated_client.post("/api/auth/cognito/refresh")
    assert refresh_fail.status_code == 401
    assert any(REFRESH_COOKIE_NAME in c for c in refresh_fail.headers.get_list("set-cookie"))

    # 4. Logout calls global_sign_out when access token is present and clears cookies
    mock_client.global_sign_out.reset_mock()
    unauthenticated_client.cookies.set(COOKIE_NAME, "active-access-jwt")
    unauthenticated_client.cookies.set(REFRESH_COOKIE_NAME, "valid-refresh-tok")
    logout_resp = unauthenticated_client.post("/api/auth/logout")
    assert logout_resp.status_code == 200
    mock_client.global_sign_out.assert_called_once_with(AccessToken="active-access-jwt")
    logout_cookies = logout_resp.headers.get_list("set-cookie")
    assert any(COOKIE_NAME in c and "Max-Age=0" in c for c in logout_cookies)
    assert any(REFRESH_COOKIE_NAME in c and "Max-Age=0" in c for c in logout_cookies)
