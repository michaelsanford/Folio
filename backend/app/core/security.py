from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from fastapi import Request, HTTPException, status, Depends
from app.core.config import settings

COOKIE_NAME = "folio_session"


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a stored bcrypt hash or plain text fallback."""
    if not hashed_password:
        return False
    # If the stored value starts with $2b$ or $2a$, verify bcrypt hash
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    # Direct equality check (if plain text password configured in environment)
    return plain_password == hashed_password


def is_auth_configured() -> bool:
    """Check if any master password or hash is configured."""
    return bool(settings.FOLIO_MASTER_PASSWORD or settings.FOLIO_MASTER_PASSWORD_HASH)


def check_master_password(password: str) -> bool:
    """Check whether the provided password matches the configured master password or hash."""
    if settings.FOLIO_MASTER_PASSWORD_HASH:
        return verify_password(password, settings.FOLIO_MASTER_PASSWORD_HASH)
    if settings.FOLIO_MASTER_PASSWORD:
        return verify_password(password, settings.FOLIO_MASTER_PASSWORD)
    return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=settings.SESSION_EXPIRE_DAYS)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except (jwt.PyJWTError, Exception):
        return None


def get_token_from_request(request: Request) -> str | None:
    """Extract JWT from Authorization header or HttpOnly session cookie."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]
    
    cookie_token = request.cookies.get(COOKIE_NAME)
    if cookie_token:
        return cookie_token
        
    return None


async def require_auth(request: Request) -> dict:
    """
    FastAPI dependency to protect endpoints.
    If auth is not configured on the instance, allow access automatically.
    If auth is configured, requires a valid JWT token.
    """
    if not is_auth_configured():
        return {"sub": "owner", "auth_disabled": True}

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
