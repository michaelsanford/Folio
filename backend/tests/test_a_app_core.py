"""App core: config, origin gate, health, logging, rate-limit keys, JWKS, guards, bootstrap."""
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.exceptions import PyJWKClientConnectionError

from app.core import security
from app.core.config import MASTER_HASH_FILENAME, Settings, settings
from app.core.logging import JsonFormatter, log_event, request_id_from_headers
from app.core.rate_limit import SlidingWindowLimiter, client_key
from app.core.database import get_db
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
def restore_settings():
    saved = {
        name: getattr(settings, name)
        for name in (
            "ENVIRONMENT",
            "FOLIO_ORIGIN_VERIFY_SECRET",
            "FOLIO_MASTER_PASSWORD",
            "FOLIO_MASTER_PASSWORD_HASH",
            "COGNITO_USER_POOL_ID",
            "COGNITO_CLIENT_ID",
            "SQLITE_DB_PATH",
        )
    }
    security._jwk_client = None
    security._jwk_client_url = None
    yield
    for name, value in saved.items():
        setattr(settings, name, value)
    security._jwk_client = None
    security._jwk_client_url = None


# ---------------------------------------------------------------------- config

@pytest.mark.parametrize("env", ["prod", "production"])
def test_docs_are_hidden_in_production(env):
    script = (
        "from app.main import app; "
        "print(app.docs_url, app.redoc_url, app.openapi_url)"
    )
    environ = {**os.environ, "FOLIO_ENV": env, "FOLIO_SKIP_STARTUP_TASKS": "1"}
    environ.pop("FOLIO_CORS_ORIGINS", None)
    out = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_DIR,
        env=environ,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "None None None"


def test_docs_are_hidden_on_every_lambda_stack():
    """A qa / staging stack on AWS gets the production guards too."""
    script = (
        "from app.core.config import settings, validate_production_settings; "
        "from app.main import app; "
        "print(settings.is_production, app.docs_url, app.redoc_url, app.openapi_url)"
    )
    environ = {
        **os.environ,
        "AWS_LAMBDA_FUNCTION_NAME": "folio-qa",
        "FOLIO_ENV": "qa",
        "FOLIO_SKIP_STARTUP_TASKS": "1",
    }
    for key in ("FOLIO_CORS_ORIGINS", "S3_BUCKET_NAME", "FOLIO_SESSION_SECRET_ARN", "FOLIO_ORIGIN_SECRET_ARN"):
        environ.pop(key, None)
    out = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND_DIR,
        env=environ,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "True None None None"


def test_lambda_is_production_whatever_folio_env_says(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio-qa")
    monkeypatch.delenv("FOLIO_CORS_ORIGINS", raising=False)
    qa = Settings(ENVIRONMENT="qa")
    assert qa.is_production is True
    assert qa.CORS_ORIGINS == []

    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME")
    assert Settings(ENVIRONMENT="qa").is_production is False
    assert Settings(ENVIRONMENT="prod").is_production is True


def test_setup_is_forbidden_on_a_lambda_qa_stack(unauthenticated_client, restore_settings, monkeypatch):
    settings.ENVIRONMENT = "qa"
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio-qa")
    resp = unauthenticated_client.post("/api/auth/setup", json={"password": "CorrectHorseBattery1!"})
    assert resp.status_code == 403
    assert "disabled in production" in resp.json()["detail"]


def test_maintenance_guard_applies_on_a_lambda_qa_stack(client, restore_settings, monkeypatch):
    settings.ENVIRONMENT = "qa"
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio-qa")
    assert client.post("/api/maintenance/seed-demo-data").status_code == 403


def test_docs_are_served_in_development():
    assert app.docs_url == "/api/docs"


def test_cors_is_empty_in_production_without_explicit_origins(monkeypatch):
    monkeypatch.delenv("FOLIO_CORS_ORIGINS", raising=False)
    assert Settings(ENVIRONMENT="prod").CORS_ORIGINS == []
    assert "http://localhost:5173" in Settings(ENVIRONMENT="development").CORS_ORIGINS

    monkeypatch.setenv("FOLIO_CORS_ORIGINS", "https://folio.example.com")
    assert Settings(ENVIRONMENT="prod").CORS_ORIGINS == ["https://folio.example.com"]


@pytest.mark.parametrize("raw, expected", [("", 25), ("5", 5), ("junk", 25), ("0", 25)])
def test_max_upload_mb(monkeypatch, raw, expected):
    from app.core.config import _max_upload_mb

    monkeypatch.setenv("FOLIO_MAX_UPLOAD_MB", raw)
    assert _max_upload_mb() == expected


def test_secrets_are_loaded_from_secrets_manager_arns():
    session_arn = "arn:aws:secretsmanager:ca-central-1:123456789012:secret:folio-session-AbCdEf"
    origin_arn = "arn:aws:secretsmanager:ca-central-1:123456789012:secret:folio-origin-GhIjKl"
    values = {session_arn: "session-key-from-sm", origin_arn: "origin-key-from-sm"}

    fake = MagicMock()
    fake.get_secret_value.side_effect = lambda SecretId: {"SecretString": values[SecretId]}
    with patch("boto3.client", return_value=fake) as boto_client:
        loaded = Settings(FOLIO_SESSION_SECRET_ARN=session_arn, FOLIO_ORIGIN_SECRET_ARN=origin_arn)

    assert loaded.SECRET_KEY == "session-key-from-sm"
    assert loaded.FOLIO_ORIGIN_VERIFY_SECRET == "origin-key-from-sm"
    assert boto_client.call_args.args[0] == "secretsmanager"
    assert boto_client.call_args.kwargs["region_name"] == "ca-central-1"


def test_secret_fetch_failure_is_fatal():
    fake = MagicMock()
    fake.get_secret_value.side_effect = RuntimeError("AccessDenied")
    with patch("boto3.client", return_value=fake), pytest.raises(Exception):
        Settings(FOLIO_SESSION_SECRET_ARN="arn:aws:secretsmanager:ca-central-1:1:secret:x")


# ----------------------------------------------------------------- origin gate

def test_origin_gate_covers_every_path(restore_settings):
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "edge-secret"
    remote = TestClient(app, client=("203.0.113.9", 40000))

    for path in ("/api/health", "/api/auth/status", "/", "/assets/app.js"):
        assert remote.get(path).status_code == 403, path

    resp = remote.get("/api/auth/status", headers={"X-Folio-Origin-Verify": "edge-secret"})
    assert resp.status_code == 200


@pytest.mark.parametrize("host", ["127.0.0.1", "::1"])
def test_local_health_probe_is_exempt(restore_settings, unauthenticated_client, host):
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "edge-secret"
    local = TestClient(app, client=(host, 40000))
    assert local.get("/api/health").status_code == 200
    # Only the health probe: other paths from loopback still need the header.
    assert local.get("/api/auth/status").status_code == 403


def test_proxied_lambda_invocation_of_health_still_needs_the_header(restore_settings, unauthenticated_client):
    """Lambda Web Adapter forwards Function URL calls over loopback too, but
    adds x-amzn-request-context; such a request is a direct hit, not the probe."""
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "edge-secret"
    local = TestClient(app, client=("127.0.0.1", 40000))
    context = json.dumps({"requestId": "abc"})
    assert local.get("/api/health", headers={"x-amzn-request-context": context}).status_code == 403


def test_non_loopback_health_needs_the_header(restore_settings, unauthenticated_client):
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "edge-secret"
    remote = TestClient(app, client=("10.0.0.5", 40000))
    assert remote.get("/api/health").status_code == 403
    assert remote.get("/api/health", headers={"X-Folio-Origin-Verify": "edge-secret"}).status_code == 200


# ---------------------------------------------------------------------- health

def test_health_runs_a_database_query_and_omits_auth_mode(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "healthy"
    assert "auth_mode" not in body


def test_health_reports_503_when_the_database_fails():
    broken = MagicMock()
    broken.execute.side_effect = RuntimeError("disk I/O error")

    def override():
        yield broken

    app.dependency_overrides[get_db] = override
    try:
        resp = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 503
    broken.execute.assert_called_once()
    assert "SELECT 1" in str(broken.execute.call_args.args[0])


# --------------------------------------------------------------------- logging

def test_request_id_comes_from_the_lambda_request_context():
    headers = {"x-amzn-request-context": json.dumps({"requestId": "req-123"})}
    assert request_id_from_headers(headers) == "req-123"
    assert request_id_from_headers({"x-amzn-trace-id": "Root=1-abc"}) == "Root=1-abc"
    assert len(request_id_from_headers({})) == 32


def test_response_carries_the_request_id(client):
    headers = {"x-amzn-request-context": json.dumps({"requestId": "req-456"})}
    assert client.get("/api/health", headers=headers).headers["x-request-id"] == "req-456"


def test_json_formatter_includes_event_and_fields():
    record_logger = logging.getLogger("folio.test")
    captured = []

    class Capture(logging.Handler):
        def emit(self, record):
            captured.append(JsonFormatter().format(record))

    handler = Capture()
    record_logger.addHandler(handler)
    try:
        log_event(record_logger, logging.ERROR, "s3_sync_failed", "boom", bucket="b")
    finally:
        record_logger.removeHandler(handler)
    payload = json.loads(captured[0])
    assert payload["event"] == "s3_sync_failed"
    assert payload["bucket"] == "b"
    assert payload["level"] == "ERROR"
    assert payload["message"] == "boom"


def test_unhandled_errors_return_generic_500_and_log_http_5xx(db_session, caplog):
    @app.get("/api/_test_explode")
    def _explode():
        raise ValueError("secret internal detail")

    app.router.routes.insert(0, app.router.routes.pop())
    try:
        with caplog.at_level(logging.ERROR):
            resp = TestClient(app, raise_server_exceptions=False).get("/api/_test_explode")
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", "") != "/api/_test_explode"]

    assert resp.status_code == 500
    assert resp.json() == {"detail": "Internal server error"}
    assert "secret internal detail" not in resp.text
    events = [r for r in caplog.records if getattr(r, "event", None) == "http_5xx"]
    assert len(events) == 1
    assert events[0].exc_info is not None


# ------------------------------------------------------------------ rate limit

def _request(host="198.51.100.7", headers=None):
    return SimpleNamespace(client=SimpleNamespace(host=host), headers=headers or {})


def test_client_key_uses_socket_peer_and_ignores_x_forwarded_for(restore_settings):
    settings.FOLIO_ORIGIN_VERIFY_SECRET = ""
    req = _request(headers={"X-Forwarded-For": "1.2.3.4", "CloudFront-Viewer-Address": "5.6.7.8:443"})
    assert client_key(req) == "198.51.100.7"


def test_client_key_uses_cloudfront_viewer_address_behind_the_edge(restore_settings):
    settings.FOLIO_ORIGIN_VERIFY_SECRET = "edge-secret"
    assert client_key(_request(headers={"CloudFront-Viewer-Address": "203.0.113.5:51234"})) == "203.0.113.5"
    assert client_key(_request(headers={"CloudFront-Viewer-Address": "2001:db8::1:51234"})) == "2001:db8::1"
    assert client_key(_request(headers={"X-Forwarded-For": "9.9.9.9"})) == "198.51.100.7"


def test_limiter_check_does_not_create_entries():
    limiter = SlidingWindowLimiter(max_attempts=3, window_seconds=60)
    for i in range(100):
        limiter.check(f"10.0.0.{i}")
    assert len(limiter) == 0


def test_limiter_evicts_keys_once_their_window_expires(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr("app.core.rate_limit.time.monotonic", lambda: now[0])
    limiter = SlidingWindowLimiter(max_attempts=3, window_seconds=60)
    limiter.record_failure("a")
    limiter.record_failure("b")
    assert len(limiter) == 2

    now[0] += 61
    assert limiter.check("a") == (True, 0)
    assert len(limiter) == 1, "an emptied deque must be evicted"
    limiter.record_failure("b")
    assert len(limiter) == 1


# ------------------------------------------------------------------------ JWKS

def test_jwks_client_has_a_short_timeout(restore_settings):
    settings.COGNITO_USER_POOL_ID = "ca-central-1_TestPool1"
    settings.COGNITO_CLIENT_ID = "client_test_123"
    assert security.get_jwk_client().timeout == security.JWKS_TIMEOUT_SECONDS == 5


def test_jwks_outage_returns_503_not_401(restore_settings, unauthenticated_client):
    settings.COGNITO_USER_POOL_ID = "ca-central-1_TestPool1"
    settings.COGNITO_CLIENT_ID = "client_test_123"
    settings.COGNITO_REGION = "ca-central-1"

    fake_jwk = MagicMock()
    fake_jwk.get_signing_key_from_jwt.side_effect = PyJWKClientConnectionError("timed out")
    security._jwk_client = fake_jwk
    security._jwk_client_url = settings.cognito_jwks_url

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        {"sub": "u", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        key,
        algorithm="RS256",
        headers={"kid": "k1"},
    )
    resp = unauthenticated_client.get("/api/accounts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After")


def test_require_auth_is_synchronous():
    import inspect

    assert not inspect.iscoroutinefunction(security.require_auth)


# ------------------------------------------------------------- maintenance/setup

@pytest.mark.parametrize("path", ["/api/maintenance/seed-demo-data", "/api/maintenance/backfill-snapshots"])
def test_destructive_maintenance_is_forbidden_in_production(client, restore_settings, path):
    settings.ENVIRONMENT = "prod"
    resp = client.post(path)
    assert resp.status_code == 403


def test_detect_transfers_stays_available_in_production(client, restore_settings):
    settings.ENVIRONMENT = "prod"
    assert client.post("/api/maintenance/detect-transfers").status_code == 200


def test_setup_persists_the_hash_so_restarts_stay_configured(unauthenticated_client, restore_settings, tmp_path):
    settings.ENVIRONMENT = "development"
    settings.FOLIO_MASTER_PASSWORD = ""
    settings.FOLIO_MASTER_PASSWORD_HASH = ""
    settings.COGNITO_USER_POOL_ID = ""
    settings.COGNITO_CLIENT_ID = ""
    settings.SQLITE_DB_PATH = tmp_path / "folio.db"

    resp = unauthenticated_client.post("/api/auth/setup", json={"password": "CorrectHorse42!"})
    assert resp.status_code == 200, resp.text

    hash_file = tmp_path / MASTER_HASH_FILENAME
    stored = hash_file.read_text(encoding="utf-8")
    assert stored.startswith("$2") and stored == settings.FOLIO_MASTER_PASSWORD_HASH

    # A "restart": fresh settings with no hash in the environment pick it up.
    restarted = Settings(SQLITE_DB_PATH=tmp_path / "folio.db", FOLIO_MASTER_PASSWORD_HASH="", FOLIO_MASTER_PASSWORD="")
    assert restarted.FOLIO_MASTER_PASSWORD_HASH == stored

    # Setup cannot be re-run, even if this process forgot the hash.
    settings.FOLIO_MASTER_PASSWORD_HASH = ""
    again = unauthenticated_client.post("/api/auth/setup", json={"password": "AnotherPass42!"})
    assert again.status_code == 400
    assert hash_file.read_text(encoding="utf-8") == stored


# ------------------------------------------------------------------- bootstrap

def test_bootstrap_matches_the_four_initial_requests(client):
    client.post("/api/household/members", json={"name": "Alex", "role": "Self"})
    client.post("/api/accounts", json={"name": "Chequing", "type": "checking", "current_balance": 100.0})

    boot = client.get("/api/bootstrap")
    assert boot.status_code == 200, boot.text
    body = boot.json()
    assert set(body) == {"accounts", "categories", "analytics", "household_members", "limits", "me", "people"}
    assert body["me"] == client.get("/api/people/me").json()
    assert body["accounts"] == client.get("/api/accounts").json()
    assert body["categories"] == client.get("/api/categories").json()
    assert body["household_members"] == client.get("/api/household/members").json()
    assert body["analytics"].keys() == client.get("/api/analytics/dashboard").json().keys()
    assert body["limits"] == {"max_upload_mb": settings.MAX_UPLOAD_MB}


def test_bootstrap_requires_auth(unauthenticated_client):
    assert unauthenticated_client.get("/api/bootstrap").status_code == 401


# --------------------------------------------------------------------- seeding

def test_seeding_check_tracks_missing_defaults(db_session):
    from app.api.rules import seed_default_rules
    from app.main import seeding_needed

    # conftest seeds categories but not rules.
    assert seeding_needed(db_session) is True
    seed_default_rules(db_session)
    assert seeding_needed(db_session) is False
