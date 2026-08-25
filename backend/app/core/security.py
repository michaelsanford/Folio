import secrets
import logging
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from jwt import PyJWKClient
from fastapi import Request, HTTPException, status
from app.core.config import settings

logger = logging.getLogger("folio.security")

COOKIE_NAME = "folio_session"

# Cached JWKS client instance for Cognito
_jwk_client: PyJWKClient | None = None


def get_jwk_client() -> PyJWKClient | None:
    """Returns or initializes the PyJWKClient for Cognito JWKS public key rotation."""
    global _jwk_client
    if not settings.is_cognito_enabled:
        return None
    if _jwk_client is None:
        try:
            _jwk_client = PyJWKClient(settings.cognito_jwks_url, cache_keys=True, max_cached_keys=16)
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
        "iss": "folio-vault",
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
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={"verify_exp": True, "verify_iss": True},
        )
        
        # Validate client_id / audience against configured Cognito App Client ID
        token_client_id = payload.get("client_id") or payload.get("aud")
        if token_client_id and token_client_id != settings.COGNITO_CLIENT_ID:
            logger.warning("Cognito token audience/client_id mismatch")
            return None

        # Verify token_use claim (must be 'access' or 'id')
        token_use = payload.get("token_use")
        if token_use not in ("access", "id"):
            logger.warning(f"Invalid Cognito token_use: {token_use}")
            return None

        return payload
    except jwt.PyJWTError as e:
        logger.debug(f"Cognito JWT validation failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error validating Cognito token: {e}")
        return None


def decode_access_token(token: str) -> dict | None:
    """
    Decode and validate an access token.
    First tries Cognito JWKS RS256 if Cognito is configured,
    then falls back to local HS256 signature verification.
    """
    if settings.is_cognito_enabled:
        cognito_payload = decode_cognito_token(token)
        if cognito_payload:
            return cognito_payload

    # Local HS256 token verification
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": True},
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


def verify_edge_origin(request: Request) -> None:
    """
    Verifies that the request originates from our CloudFront / WAF edge
    if an origin verification secret is configured.
    """
    if not settings.FOLIO_ORIGIN_VERIFY_SECRET:
        return

    incoming_secret = request.headers.get("X-Folio-Origin-Verify", "")
    if not secrets.compare_digest(incoming_secret, settings.FOLIO_ORIGIN_VERIFY_SECRET):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Direct access to function URL forbidden",
        )


async def require_auth(request: Request) -> dict:
    """
    FastAPI dependency to protect endpoints.
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

