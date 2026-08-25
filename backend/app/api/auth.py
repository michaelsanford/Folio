from fastapi import APIRouter, HTTPException, Response, Request, status
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.security import (
    check_master_password,
    create_access_token,
    decode_access_token,
    get_token_from_request,
    is_auth_configured,
    hash_password,
    verify_edge_origin,
    COOKIE_NAME,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    password: str


class SetupPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, description="Master passphrase (minimum 8 characters)")


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
def get_auth_status(request: Request):
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
    if not token:
        return AuthStatusResponse(
            authenticated=False,
            auth_required=True,
            auth_mode=mode,
            cognito_enabled=settings.is_cognito_enabled,
        )
    
    payload = decode_access_token(token)
    return AuthStatusResponse(
        authenticated=payload is not None,
        auth_required=True,
        auth_mode=mode,
        cognito_enabled=settings.is_cognito_enabled,
    )


@router.post("/login", response_model=TokenResponse)
def login(request_data: LoginRequest, request: Request, response: Response):
    """Verifies master password and sets an HttpOnly session cookie."""
    verify_edge_origin(request)

    if not is_auth_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vault authentication is not configured on this instance.",
        )

    if not check_master_password(request_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect master passphrase",
        )

    token = create_access_token({"sub": "owner"})
    
    # Set HttpOnly, Secure, SameSite cookie
    max_age = settings.SESSION_EXPIRE_DAYS * 86400
    is_secure = request.url.scheme == "https" or settings.ENVIRONMENT == "production"
    
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        samesite="lax",
        secure=is_secure,
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_days=settings.SESSION_EXPIRE_DAYS,
    )


@router.post("/logout")
def logout(response: Response):
    """Clears the session cookie."""
    response.delete_cookie(key=COOKIE_NAME, httponly=True, samesite="lax")
    return {"message": "Successfully logged out"}


@router.post("/setup")
def setup_password(request_data: SetupPasswordRequest, request: Request):
    """Allows setting initial master password if none is configured (dev only)."""
    verify_edge_origin(request)

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

    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password(request_data.password)
    return {"message": "Master passphrase configured successfully"}

