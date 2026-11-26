"""Security headers on every kind of response, and the JSON access log."""
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core import security_headers as sh
from app.core.config import settings
from app.core.logging import JsonFormatter
from app.main import app

EVERY_MODE_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": sh.PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-XSS-Protection": "0",
    "X-Robots-Tag": "noindex, nofollow",
}

# "/" is the SPA shell when a frontend build is present, otherwise a 404; both
# go through the same middleware. /api/health is a 200 API response, and the
# unknown API path and the unauthenticated call are error responses.
PATHS = ["/", "/api/health", "/api/does-not-exist", "/api/accounts"]


@pytest.fixture
def production_mode(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    assert settings.is_production


@pytest.fixture
def boom_client():
    """A client for a route that raises, placed ahead of the SPA catch-all."""
    path = "/api/_test_boom"

    @app.get(path, include_in_schema=False)
    def boom():
        raise RuntimeError("boom")

    app.router.routes.insert(0, app.router.routes.pop())
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client
    finally:
        app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != path]


def _csp_directives(response) -> dict[str, list[str]]:
    return {
        parts[0]: parts[1:]
        for parts in (d.split() for d in response.headers["Content-Security-Policy"].split(";") if d.strip())
    }


@pytest.mark.parametrize("path", PATHS)
def test_every_header_on_every_response(unauthenticated_client, path):
    response = unauthenticated_client.get(path)
    for name, value in EVERY_MODE_HEADERS.items():
        assert response.headers.get(name) == value, f"{name} on {path} ({response.status_code})"
    directives = _csp_directives(response)
    assert directives["object-src"] == ["'none'"]
    assert directives["frame-src"] == ["'none'"]
    assert directives["frame-ancestors"] == ["'none'"]
    assert directives["worker-src"] == ["'self'"]
    assert directives["manifest-src"] == ["'self'"]
    assert directives["img-src"] == ["'self'", "data:", "blob:"]
    assert "Cross-Origin-Embedder-Policy" not in response.headers


def test_error_responses_cover_404_and_401(unauthenticated_client):
    assert unauthenticated_client.get("/api/does-not-exist").status_code == 404
    assert unauthenticated_client.get("/api/accounts").status_code == 401


def test_no_https_only_headers_outside_production(unauthenticated_client):
    for path in PATHS:
        response = unauthenticated_client.get(path)
        assert "Strict-Transport-Security" not in response.headers
        assert "upgrade-insecure-requests" not in _csp_directives(response)


@pytest.mark.parametrize("path", PATHS)
def test_https_only_headers_in_production(unauthenticated_client, production_mode, path):
    response = unauthenticated_client.get(path)
    assert response.headers["Strict-Transport-Security"] == "max-age=63072000; includeSubDomains"
    assert "upgrade-insecure-requests" in _csp_directives(response)


def test_unhandled_error_response_carries_the_headers(boom_client, production_mode):
    response = boom_client.get("/api/_test_boom")
    assert response.status_code == 500
    for name, value in EVERY_MODE_HEADERS.items():
        assert response.headers.get(name) == value, name
    assert response.headers["Strict-Transport-Security"] == sh.STRICT_TRANSPORT_SECURITY
    assert response.headers["Cache-Control"] == "no-store"


def test_origin_gate_rejection_carries_the_headers(unauthenticated_client, monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_ORIGIN_VERIFY_SECRET", "s3cret")
    response = unauthenticated_client.get("/api/accounts")
    assert response.status_code == 403
    for name, value in EVERY_MODE_HEADERS.items():
        assert response.headers.get(name) == value, name


def test_api_responses_are_never_cached(unauthenticated_client):
    for path in ["/api/health", "/api/does-not-exist", "/api/accounts"]:
        assert unauthenticated_client.get(path).headers.get("Cache-Control") == "no-store", path


def test_non_api_responses_keep_their_own_caching(unauthenticated_client):
    assert unauthenticated_client.get("/").headers.get("Cache-Control") != "no-store"
    asset_routes = [r for r in app.router.routes if getattr(r, "path", None) == "/assets"]
    if asset_routes:
        assets_dir = asset_routes[0].app.directory
        from pathlib import Path

        first = next((p for p in Path(assets_dir).iterdir() if p.is_file()), None)
        if first is not None:
            response = unauthenticated_client.get(f"/assets/{first.name}")
            assert response.status_code == 200
            assert response.headers.get("Cache-Control") != "no-store"
            assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_a_route_cache_control_is_not_overridden():
    headers = sh.security_headers("/api/x")
    assert headers["Cache-Control"] == "no-store"
    assert "Cache-Control" not in sh.security_headers("/assets/app.js")
    assert "Cache-Control" not in sh.security_headers("/apiary")


def test_build_csp_stays_importable_from_main():
    from app.main import _build_csp

    assert _build_csp() == sh.build_csp()


def test_permissions_policy_denies_all_but_clipboard_write():
    entries = dict(e.split("=", 1) for e in sh.PERMISSIONS_POLICY.split(", "))
    assert entries.pop("clipboard-write") == "(self)"
    assert entries["camera"] == "()" and entries["fullscreen"] == "()"
    assert set(entries.values()) == {"()"}


def test_permissions_policy_uses_no_retired_or_unrecognized_ad_features():
    entries = dict(e.split("=", 1) for e in sh.PERMISSIONS_POLICY.split(", "))
    for retired in ("browsing-topics", "run-ad-auction", "join-ad-interest-group",
                    "attribution-reporting", "private-aggregation", "interest-cohort"):
        assert retired not in entries
    assert entries["unload"] == "()"


def _template_custom_header(name: str) -> str:
    """The value of a CloudFront custom response header in template.yaml."""
    import re
    from pathlib import Path

    template = (Path(__file__).resolve().parents[2] / "template.yaml").read_text(encoding="utf-8")
    match = re.search(
        rf"- Header: {re.escape(name)}\s*\n\s*Value: '([^']*)'", template
    )
    assert match, f"{name} not found in template.yaml"
    return match.group(1)


@pytest.mark.parametrize(
    ("header", "value"),
    [("Permissions-Policy", sh.PERMISSIONS_POLICY), ("X-Robots-Tag", sh.X_ROBOTS_TAG)],
)
def test_cloudfront_backstop_matches_the_app(header, value):
    assert _template_custom_header(header) == value


def test_head_health_check(unauthenticated_client):
    response = unauthenticated_client.head("/api/health")
    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["Cache-Control"] == "no-store"


# ------------------------------------------------------------------ access log

class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.setFormatter(JsonFormatter())
        self.lines: list[dict] = []

    def emit(self, record):
        self.lines.append(json.loads(self.format(record)))


@pytest.fixture
def access_log():
    handler = _Capture()
    logger = logging.getLogger("folio.access")
    logger.addHandler(handler)
    try:
        yield handler.lines
    finally:
        logger.removeHandler(handler)


def test_one_json_access_record_per_request(unauthenticated_client, access_log):
    response = unauthenticated_client.get("/api/health?secret=query&q=groceries")
    assert response.status_code == 200

    assert len(access_log) == 1
    record = access_log[0]
    assert record["logger"] == "folio.access"
    assert record["level"] == "INFO"
    assert record["message"] == "GET /api/health 200"
    assert record["method"] == "GET"
    assert record["path"] == "/api/health"
    assert record["status"] == 200
    assert isinstance(record["duration_ms"], float)
    assert record["duration_ms"] == round(record["duration_ms"], 1)
    assert record["request_id"] == response.headers["x-request-id"]
    assert record["client_ip"] == "testclient"
    assert "secret" not in json.dumps(record) and "groceries" not in json.dumps(record)


def test_access_record_for_errors_and_head(unauthenticated_client, access_log):
    unauthenticated_client.get("/api/accounts")
    unauthenticated_client.head("/api/health")
    assert [(r["method"], r["path"], r["status"]) for r in access_log] == [
        ("GET", "/api/accounts", 401),
        ("HEAD", "/api/health", 200),
    ]


def test_access_record_uses_the_viewer_address_behind_cloudfront(unauthenticated_client, access_log, monkeypatch):
    monkeypatch.setattr(settings, "FOLIO_ORIGIN_VERIFY_SECRET", "s3cret")
    unauthenticated_client.get(
        "/api/health",
        headers={"X-Folio-Origin-Verify": "s3cret", "CloudFront-Viewer-Address": "203.0.113.7:51234"},
    )
    assert len(access_log) == 1
    assert access_log[0]["client_ip"] == "203.0.113.7"


def test_unhandled_error_is_logged_as_500(boom_client, access_log):
    assert boom_client.get("/api/_test_boom").status_code == 500
    assert [(r["path"], r["status"]) for r in access_log] == [("/api/_test_boom", 500)]


def test_uvicorn_loggers_go_through_the_json_handler():
    from app.core.logging import configure_logging

    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).addHandler(logging.StreamHandler())
        logging.getLogger(name).propagate = False
    configure_logging()
    for name in ("uvicorn", "uvicorn.error"):
        server_logger = logging.getLogger(name)
        assert server_logger.handlers == [] and server_logger.propagate is True
    access = logging.getLogger("uvicorn.access")
    assert access.disabled is True and access.propagate is False


def test_head_on_the_spa_shell_is_allowed(unauthenticated_client):
    response = unauthenticated_client.head("/")
    # 200 with a frontend build present, 404 without one; never 405.
    assert response.status_code in (200, 404)
    assert response.headers["X-Frame-Options"] == "DENY"


def test_uvicorn_color_message_is_not_logged():
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, "Started", None, None)
    record.color_message = "\x1b[1mStarted\x1b[0m"
    assert "color_message" not in json.loads(JsonFormatter().format(record))
