"""Production configuration and abuse-resistance guards."""
import pytest

from app.core.config import (
    DEFAULT_INSECURE_SECRET_KEY,
    Settings,
    validate_production_settings,
)
from app.core.rate_limit import SlidingWindowLimiter
from app.core.security import hash_password
from app.services.categorization.rules_engine import safe_regex_search


# ----------------------------------------------------------- production config

def test_development_tolerates_the_placeholder_secret():
    dev = Settings(ENVIRONMENT="development", SECRET_KEY=DEFAULT_INSECURE_SECRET_KEY)
    assert validate_production_settings(dev) == []


def test_production_rejects_the_placeholder_secret():
    prod = Settings(ENVIRONMENT="production", SECRET_KEY=DEFAULT_INSECURE_SECRET_KEY)
    problems = validate_production_settings(prod)
    assert any("FOLIO_SECRET_KEY" in p for p in problems)


def test_production_rejects_a_plaintext_master_password():
    prod = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="a-real-random-secret",
        FOLIO_MASTER_PASSWORD="hunter2hunter2",
        FOLIO_MASTER_PASSWORD_HASH="",
    )
    problems = validate_production_settings(prod)
    assert any("plain text" in p for p in problems)


def test_production_accepts_a_hashed_password_and_real_secret():
    prod = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="a-real-random-secret",
        FOLIO_MASTER_PASSWORD="",
        FOLIO_MASTER_PASSWORD_HASH=hash_password("CorrectHorseBattery1!"),
    )
    assert validate_production_settings(prod) == []


# ------------------------------------------------------------------- rate limit

def test_limiter_blocks_after_the_configured_failures():
    limiter = SlidingWindowLimiter(max_attempts=3, window_seconds=300)
    for _ in range(3):
        assert limiter.check("1.2.3.4")[0] is True
        limiter.record_failure("1.2.3.4")

    allowed, retry_after = limiter.check("1.2.3.4")
    assert allowed is False
    assert retry_after > 0


def test_limiter_is_per_client():
    limiter = SlidingWindowLimiter(max_attempts=2, window_seconds=300)
    for _ in range(2):
        limiter.record_failure("1.1.1.1")
    assert limiter.check("1.1.1.1")[0] is False
    assert limiter.check("2.2.2.2")[0] is True


def test_success_clears_the_failure_record():
    limiter = SlidingWindowLimiter(max_attempts=2, window_seconds=300)
    limiter.record_failure("1.1.1.1")
    limiter.reset("1.1.1.1")
    assert limiter.check("1.1.1.1")[0] is True


def test_repeated_bad_logins_are_eventually_rate_limited(unauthenticated_client):
    from app.core.config import settings
    from app.core.rate_limit import login_limiter

    login_limiter.clear()
    original = settings.FOLIO_MASTER_PASSWORD_HASH
    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password("TheRightPassword1!")
    try:
        statuses = [
            unauthenticated_client.post("/api/auth/login", json={"password": "wrong"}).status_code
            for _ in range(12)
        ]
        assert 401 in statuses
        assert 429 in statuses, "unbounded guessing must not be possible"
        # Ordering: the 401s come first, then the lockout.
        assert statuses.index(429) > 0
    finally:
        settings.FOLIO_MASTER_PASSWORD_HASH = original
        login_limiter.clear()


# ------------------------------------------------------------------ regex guard

def test_normal_patterns_still_match():
    assert safe_regex_search(r"STARBUCKS.*", "STARBUCKS #1234") is True
    assert safe_regex_search(r"^AMZN", "AMZN MKTP") is True
    assert safe_regex_search(r"^AMZN", "SHELL") is False


@pytest.mark.parametrize("pattern", [r"(a+)+b", r"(x*)*y", r"(\d+)+z"])
def test_catastrophic_backtracking_patterns_are_refused(pattern):
    assert safe_regex_search(pattern, "a" * 60) is False


def test_overlong_and_invalid_patterns_are_refused():
    assert safe_regex_search("a" * 500, "aaa") is False
    assert safe_regex_search("[unclosed", "x") is False


# --------------------------------------------------------------- CSP correctness

def test_csp_pins_exact_cognito_hosts_rather_than_an_invalid_wildcard():
    from app.core.config import settings
    from app.main import _build_csp

    original_pool, original_client = settings.COGNITO_USER_POOL_ID, settings.COGNITO_CLIENT_ID
    settings.COGNITO_USER_POOL_ID = "ca-central-1_abc"
    settings.COGNITO_CLIENT_ID = "client123"
    settings.COGNITO_REGION = "ca-central-1"
    try:
        csp = _build_csp()
        assert "https://cognito-idp.ca-central-1.amazonaws.com" in csp
        # A wildcard in a non-leftmost label is invalid CSP and was silently ignored.
        assert "cognito-idp.*." not in csp
    finally:
        settings.COGNITO_USER_POOL_ID = original_pool
        settings.COGNITO_CLIENT_ID = original_client


def test_setup_endpoint_is_disabled_in_production(unauthenticated_client):
    from app.core.config import settings

    original = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        resp = unauthenticated_client.post("/api/auth/setup", json={"password": "LongEnough123"})
        assert resp.status_code == 403
        assert "disabled in production" in resp.json()["detail"]
    finally:
        settings.ENVIRONMENT = original
