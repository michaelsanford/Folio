import secrets
import logging
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError
from fastapi import Request, HTTPException, status
from app.core.config import settings

logger = logging.getLogger("folio.security")

COOKIE_NAME = "folio_session"
REFRESH_COOKIE_NAME = "folio_refresh"
LOCAL_TOKEN_ISSUER = "folio-vault"

# Bound the JWKS fetch: PyJWKClient defaults to 30 s, which would hold a
# request (and a Lambda invocation) for the whole outage.
JWKS_TIMEOUT_SECONDS = 5

# Cached JWKS client instance for Cognito
_jwk_client: PyJWKClient | None = None
_jwk_client_url: str | None = None


def get_jwk_client() -> PyJWKClient | None:
    """Returns or initializes the PyJWKClient for Cognito JWKS public key rotation."""
    global _jwk_client, _jwk_client_url
    if not settings.is_cognito_enabled:
        return None
    jwks_url = settings.cognito_jwks_url
    if _jwk_client is None or _jwk_client_url != jwks_url:
        try:
            _jwk_client = PyJWKClient(
                jwks_url, cache_keys=True, max_cached_keys=16, timeout=JWKS_TIMEOUT_SECONDS
            )
            _jwk_client_url = jwks_url
        except Exception as e:
            logger.error(f"Failed to initialize Cognito JWKS client: {e}")
            return None
    return _jwk_client


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a stored bcrypt hash or plain text fallback using constant-time comparison."""
    if not hashed_password or not plain_password:
        return False
    # If the stored value starts with $2b$ or $2a$, verify bcrypt hash
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    # Constant-time comparison for plain text fallback
    return secrets.compare_digest(plain_password, hashed_password)


def is_auth_configured() -> bool:
    """Check if any authentication provider (Cognito or Master Password/Hash) is configured."""
    return bool(
        settings.is_cognito_enabled
        or settings.FOLIO_MASTER_PASSWORD
        or settings.FOLIO_MASTER_PASSWORD_HASH
    )


def check_master_password(password: str) -> bool:
    """Check whether the provided password matches the configured master password or hash."""
    if settings.FOLIO_MASTER_PASSWORD_HASH:
        return verify_password(password, settings.FOLIO_MASTER_PASSWORD_HASH)
    if settings.FOLIO_MASTER_PASSWORD:
        return verify_password(password, settings.FOLIO_MASTER_PASSWORD)
    return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed HS256 JWT access token for local vault authentication."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=settings.SESSION_EXPIRE_DAYS)
    )
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": LOCAL_TOKEN_ISSUER,
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_cognito_token(token: str) -> dict | None:
    """
    Decode and validate a Cognito JWT (ID token or Access token) using Cognito JWKS.
    Verifies cryptographic signature, expiration, issuer, and audience/client_id.
    """
    jwk_client = get_jwk_client()
    if not jwk_client:
        return None

    try:
        # Reject anything that is not an RS256 token before any
        # network round trip: a locally signed HS256 token (or garbage) must not
        # trigger a JWKS fetch, nor turn a JWKS outage into a 503 for it.
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            return None
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={"verify_exp": True, "verify_iss": True, "verify_aud": False},
        )

        # Verify token_use claim (must be 'access' or 'id') and bind client_id / aud
        token_use = payload.get("token_use")
        if token_use == "access":
            token_client_id = payload.get("client_id")
        elif token_use == "id":
            token_client_id = payload.get("aud")
        else:
            logger.warning(f"Invalid Cognito token_use: {token_use}")
            return None

        if token_client_id != settings.COGNITO_CLIENT_ID:
            logger.warning("Cognito token audience/client_id mismatch")
            return None

        return payload
    except PyJWKClientConnectionError as e:
        # The token may be perfectly valid; we just cannot check it. Answering
        # 401 would log the user out over a transient Cognito/network outage.
        logger.error(f"Cognito JWKS endpoint unreachable: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Identity provider is temporarily unreachable. Try again shortly.",
            headers={"Retry-After": "5"},
        ) from e
    except jwt.PyJWTError as e:
        logger.debug(f"Cognito JWT validation failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error validating Cognito token: {e}")
        return None


def decode_access_token(token: str) -> dict | None:
    """
    Decode and validate an access token.
    Uses Cognito JWKS RS256 exclusively when Cognito is configured,
    or local HS256 verification when Master Passphrase mode is configured.
    """
    if settings.is_cognito_enabled:
        return decode_cognito_token(token)

    if not (settings.FOLIO_MASTER_PASSWORD or settings.FOLIO_MASTER_PASSWORD_HASH):
        return None

    # Local HS256 token verification
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=LOCAL_TOKEN_ISSUER,
            options={"verify_exp": True, "require": ["exp", "iss", "sub"]},
        )
        return payload
    except (jwt.PyJWTError, Exception):
        return None


def get_token_from_request(request: Request) -> str | None:
    """Extract JWT from Authorization header or HttpOnly session cookie."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    
    cookie_token = request.cookies.get(COOKIE_NAME)
    if cookie_token:
        return cookie_token.strip()
        
    return None


ORIGIN_VERIFY_HEADER = "X-Folio-Origin-Verify"
ORIGIN_FORBIDDEN_DETAIL = "Direct access to function URL forbidden"


def origin_header_valid(headers) -> bool:
    """True when no origin secret is configured or the header carries it."""
    expected = settings.FOLIO_ORIGIN_VERIFY_SECRET
    if not expected:
        return True
    incoming = headers.get(ORIGIN_VERIFY_HEADER, "") or ""
    return secrets.compare_digest(incoming.encode("utf-8"), expected.encode("utf-8"))


def verify_edge_origin(request: Request) -> None:
    """
    Verifies that the request originates from our CloudFront edge if an origin
    verification secret is configured. The global middleware in app.main
    enforces the same check for every path; this stays for direct callers.
    """
    if not origin_header_valid(request.headers):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ORIGIN_FORBIDDEN_DETAIL,
        )


def require_auth(request: Request) -> dict:
    """
    FastAPI dependency to protect endpoints. Plain ``def`` so FastAPI runs it in
    the threadpool: a JWKS fetch must not block the event loop.
    Enforces FAIL-CLOSED authentication: requests without valid credentials are strictly rejected.
    """
    # 1. Edge origin check
    verify_edge_origin(request)

    # 2. Check if authentication mechanism is configured
    if not is_auth_configured():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: no authentication mechanism configured on server",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Extract and validate session / bearer token
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


# user_preferences.user_key is String(128); "cognito:" + a Cognito uuid is 44.
MAX_USER_KEY_LENGTH = 128


def user_key_from_claims(claims: dict) -> str:
    """Stable per-user key for verified token claims (from ``require_auth``).

    Cognito tokens (they carry ``token_use`` / ``client_id``) map to
    ``cognito:<sub>``; the local master-passphrase token, whose sub is always
    ``owner``, maps to ``owner``. The prefix keeps the two namespaces apart.
    """
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token has no subject",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if "token_use" in claims or "client_id" in claims:
        key = f"cognito:{sub}"
    else:
        # Local tokens are only ever issued with sub "owner" (api/auth.login).
        key = sub
    if len(key) > MAX_USER_KEY_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token subject is too long",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return key
