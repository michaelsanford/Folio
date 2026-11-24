from typing import Literal

from fastapi import APIRouter, HTTPException, Response, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from app.core.cognito import (
    CognitoAuthError,
    cognito_global_sign_out,
    cognito_initiate_login,
    cognito_refresh_session,
    cognito_respond_challenge,
)
from app.core.config import master_hash_file, persist_master_hash, settings
from app.core.rate_limit import client_key, login_limiter
from app.core.security import (
    COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    check_master_password,
    create_access_token,
    decode_access_token,
    get_token_from_request,
    hash_password,
    is_auth_configured,
    verify_edge_origin,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _is_secure_request(request: Request) -> bool:
    """Detect HTTPS behind TLS-terminating proxies such as Lambda Function URLs or CloudFront."""
    forwarded_proto = request.headers.get("X-Forwarded-Proto", "").split(",")[0].strip().lower()
    return bool(
        forwarded_proto == "https"
        or request.url.scheme == "https"
        or settings.is_production
    )


def _set_session_cookies(
    response: Response,
    request: Request,
    access_token: str,
    access_max_age: int,
    refresh_token: str | None = None,
) -> None:
    """Persist HttpOnly session access cookie and optional Cognito refresh cookie."""
    is_secure = _is_secure_request(request)
    response.set_cookie(
        key=COOKIE_NAME,
        value=access_token,
        max_age=access_max_age,
        expires=access_max_age,
        httponly=True,
        samesite="lax",
        secure=is_secure,
        path="/",
    )
    if refresh_token:
        refresh_max_age = 30 * 86400
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=refresh_token,
            max_age=refresh_max_age,
            expires=refresh_max_age,
            httponly=True,
            samesite="lax",
            secure=is_secure,
            path="/api/auth",
        )


def _clear_session_cookies(response: Response, request: Request) -> None:
    """Clear both access and refresh session cookies."""
    is_secure = _is_secure_request(request)
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=is_secure,
        path="/",
    )
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=is_secure,
        path="/api/auth",
    )


class LoginRequest(BaseModel):
    password: str


class SetupPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, description="Master passphrase (minimum 8 characters)")


class CognitoLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=256)


class CognitoChallengeRequest(BaseModel):
    challenge: Literal["NEW_PASSWORD_REQUIRED", "MFA_SETUP", "SOFTWARE_TOKEN_MFA"]
    username: str = Field(..., min_length=1, max_length=254)
    session: str = Field(..., min_length=1)
    new_password: str | None = Field(default=None, max_length=256)
    totp_code: str | None = Field(default=None, max_length=16)


class CognitoAuthResponse(BaseModel):
    status: Literal["authenticated", "challenge"]
    challenge: str | None = None
    session: str | None = None
    username: str | None = None
    message: str | None = None
    totp_secret: str | None = None
    otpauth_uri: str | None = None
    qr_data_uri: str | None = None


class AuthStatusResponse(BaseModel):
    authenticated: bool
    auth_required: bool
    auth_mode: str = "master_password"  # "cognito", "master_password", "unconfigured"
    cognito_enabled: bool = False


class CognitoConfigResponse(BaseModel):
    enabled: bool
    user_pool_id: str = ""
    client_id: str = ""
    region: str = "ca-central-1"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_days: int


def _finish_cognito_result(
    result: dict,
    request: Request,
    response: Response,
) -> CognitoAuthResponse:
    """Set HttpOnly cookies on completed Cognito login or serialize the next challenge."""
    if result["status"] == "authenticated":
        _set_session_cookies(
            response,
            request,
            result["access_token"],
            int(result.get("expires_in", 86400)),
            result.get("refresh_token"),
        )
        return CognitoAuthResponse(
            status="authenticated",
            username=result.get("username"),
        )

    return CognitoAuthResponse(
        status="challenge",
        challenge=result.get("challenge"),
        session=result.get("session"),
        username=result.get("username"),
        message=result.get("message"),
        totp_secret=result.get("totp_secret"),
        otpauth_uri=result.get("otpauth_uri"),
        qr_data_uri=result.get("qr_data_uri"),
    )


@router.get("/config/cognito", response_model=CognitoConfigResponse)
def get_cognito_config(request: Request):
    """Safe public endpoint returning client-side Cognito parameters if configured."""
    verify_edge_origin(request)
    return CognitoConfigResponse(
        enabled=settings.is_cognito_enabled,
        user_pool_id=settings.COGNITO_USER_POOL_ID if settings.is_cognito_enabled else "",
        client_id=settings.COGNITO_CLIENT_ID if settings.is_cognito_enabled else "",
        region=settings.COGNITO_REGION,
    )


@router.get("/status", response_model=AuthStatusResponse)
def get_auth_status(request: Request, response: Response):
    """
    Returns authentication status.
    Strictly fail-closed: if unconfigured, auth_required remains True and authenticated remains False.
    """
    verify_edge_origin(request)

    if not is_auth_configured():
        return AuthStatusResponse(
            authenticated=False,
            auth_required=True,
            auth_mode="unconfigured",
            cognito_enabled=False,
        )

    mode = "cognito" if settings.is_cognito_enabled else "master_password"

    token = get_token_from_request(request)
    payload = decode_access_token(token) if token else None
    if payload is not None:
        return AuthStatusResponse(
            authenticated=True,
            auth_required=True,
            auth_mode=mode,
            cognito_enabled=settings.is_cognito_enabled,
        )

    if settings.is_cognito_enabled:
        refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
        if refresh_token:
            refreshed = cognito_refresh_session(refresh_token)
            if refreshed and refreshed.get("access_token"):
                _set_session_cookies(
                    response,
                    request,
                    refreshed["access_token"],
                    int(refreshed.get("expires_in", 86400)),
                    refreshed.get("refresh_token"),
                )
                return AuthStatusResponse(
                    authenticated=True,
                    auth_required=True,
                    auth_mode=mode,
                    cognito_enabled=True,
                )
            _clear_session_cookies(response, request)

    return AuthStatusResponse(
        authenticated=False,
        auth_required=True,
        auth_mode=mode,
        cognito_enabled=settings.is_cognito_enabled,
    )


@router.post("/cognito/login", response_model=CognitoAuthResponse)
def cognito_login(request_data: CognitoLoginRequest, request: Request, response: Response):
    """Authenticate an invited Cognito user with email/password and set HttpOnly cookies."""
    verify_edge_origin(request)

    if not settings.is_cognito_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account sign-in is not enabled on this instance.",
        )

    key = client_key(request)
    allowed, retry_after = login_limiter.check(key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        result = cognito_initiate_login(request_data.email, request_data.password)
    except CognitoAuthError as exc:
        if exc.status_code == 401:
            login_limiter.record_failure(key)
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    login_limiter.reset(key)
    return _finish_cognito_result(result, request, response)


@router.post("/cognito/challenge", response_model=CognitoAuthResponse)
def cognito_challenge(request_data: CognitoChallengeRequest, request: Request, response: Response):
    """Respond to Cognito NEW_PASSWORD_REQUIRED, MFA_SETUP, or SOFTWARE_TOKEN_MFA challenges."""
    verify_edge_origin(request)

    if not settings.is_cognito_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account sign-in is not enabled on this instance.",
        )

    key = client_key(request)
    allowed, retry_after = login_limiter.check(key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed verification attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        result = cognito_respond_challenge(
            challenge=request_data.challenge,
            username=request_data.username,
            session=request_data.session,
            new_password=request_data.new_password,
            totp_code=request_data.totp_code,
        )
    except CognitoAuthError as exc:
        if exc.status_code in (400, 401):
            login_limiter.record_failure(key)
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    login_limiter.reset(key)
    return _finish_cognito_result(result, request, response)


@router.post("/cognito/refresh")
def cognito_refresh(request: Request, response: Response):
    """Refresh the Cognito access cookie from the HttpOnly refresh cookie."""
    verify_edge_origin(request)

    if not settings.is_cognito_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account sign-in is not enabled on this instance.",
        )

    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No active refresh session.",
        )

    refreshed = cognito_refresh_session(refresh_token)
    if not refreshed or not refreshed.get("access_token"):
        err_response = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Session expired. Please sign in again."},
        )
        _clear_session_cookies(err_response, request)
        return err_response

    _set_session_cookies(
        response,
        request,
        refreshed["access_token"],
        int(refreshed.get("expires_in", 86400)),
        refreshed.get("refresh_token"),
    )
    return {"authenticated": True}


@router.post("/login", response_model=TokenResponse)
def login(request_data: LoginRequest, request: Request, response: Response):
    """Verifies master password and sets an HttpOnly session cookie."""
    verify_edge_origin(request)

    if settings.is_cognito_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This instance uses account sign-in. Sign in with your email address instead.",
        )

    if not is_auth_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vault authentication is not configured on this instance.",
        )

    # Bound online guessing against the single master passphrase.
    key = client_key(request)
    allowed, retry_after = login_limiter.check(key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )

    if not check_master_password(request_data.password):
        login_limiter.record_failure(key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect master passphrase",
        )

    # Only failures are counted, so a correct passphrase clears the record.
    login_limiter.reset(key)
    token = create_access_token({"sub": "owner"})

    max_age = settings.SESSION_EXPIRE_DAYS * 86400
    _set_session_cookies(response, request, token, max_age)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_days=settings.SESSION_EXPIRE_DAYS,
    )


@router.post("/logout")
def logout(request: Request, response: Response):
    """Revokes Cognito tokens if applicable and clears session cookies."""
    verify_edge_origin(request)
    if settings.is_cognito_enabled:
        cognito_global_sign_out(get_token_from_request(request))
    _clear_session_cookies(response, request)
    return {"message": "Successfully logged out"}


@router.post("/setup")
def setup_password(request_data: SetupPasswordRequest, request: Request):
    """Set an initial master passphrase. Development / Docker only.

    The bcrypt hash is written to the data directory (``.folio_master_hash``,
    mode 0600, created exclusively) and loaded at startup when
    FOLIO_MASTER_PASSWORD_HASH is unset, so a restart does not reopen setup.
    Production refuses it: on Lambda the data directory is per-container /tmp,
    so the passphrase would exist on one instance only.
    """
    verify_edge_origin(request)

    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Setup is disabled in production. Configure FOLIO_MASTER_PASSWORD_HASH "
                "or Cognito in the environment instead."
            ),
        )

    if is_auth_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Master password is already configured",
        )

    if len(request_data.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters",
        )

    password_hash = hash_password(request_data.password)
    try:
        created = persist_master_hash(master_hash_file(settings.SQLITE_DB_PATH), password_hash)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not persist the master passphrase to the data directory.",
        ) from exc
    if not created:
        # Another worker finished setup first; its hash is the one on disk.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Master password is already configured",
        )

    settings.FOLIO_MASTER_PASSWORD_HASH = password_hash
    return {"message": "Master passphrase configured successfully"}

