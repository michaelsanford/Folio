from datetime import timedelta
from fastapi import APIRouter, HTTPException, Response, Request, status
from pydantic import BaseModel
from app.core.config import settings
from app.core.security import (
    check_master_password,
    create_access_token,
    decode_access_token,
    get_token_from_request,
    is_auth_configured,
    hash_password,
    COOKIE_NAME,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    password: str


class SetupPasswordRequest(BaseModel):
    password: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
    auth_required: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_days: int


@router.get("/status", response_model=AuthStatusResponse)
def get_auth_status(request: Request):
    """Returns whether authentication is required and whether the current session is valid."""
    if not is_auth_configured():
        return AuthStatusResponse(authenticated=True, auth_required=False)
    
    token = get_token_from_request(request)
    if not token:
        return AuthStatusResponse(authenticated=False, auth_required=True)
    
    payload = decode_access_token(token)
    return AuthStatusResponse(
        authenticated=payload is not None,
        auth_required=True,
    )


@router.post("/login", response_model=TokenResponse)
def login(request_data: LoginRequest, response: Response):
    """Verifies master password and sets an HttpOnly session cookie."""
    if not is_auth_configured():
        token = create_access_token({"sub": "owner"})
        return TokenResponse(access_token=token, expires_in_days=settings.SESSION_EXPIRE_DAYS)

    if not check_master_password(request_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect master password",
        )

    token = create_access_token({"sub": "owner"})
    
    # Set HttpOnly, Secure, SameSite cookie
    max_age = settings.SESSION_EXPIRE_DAYS * 86400
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in HTTPS production environments automatically
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_days=settings.SESSION_EXPIRE_DAYS,
    )


@router.post("/logout")
def logout(response: Response):
    """Clears the session cookie."""
    response.delete_cookie(key=COOKIE_NAME)
    return {"message": "Successfully logged out"}


@router.post("/setup")
def setup_password(request_data: SetupPasswordRequest):
    """Allows setting initial master password if none is configured."""
    if is_auth_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Master password is already configured",
        )

    if len(request_data.password) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 4 characters",
        )

    settings.FOLIO_MASTER_PASSWORD_HASH = hash_password(request_data.password)
    return {"message": "Master password configured successfully"}
