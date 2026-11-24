"""AWS Cognito public-client authentication service (invite-only + TOTP MFA)."""

import logging
import urllib.parse
from typing import Any

import boto3
import segno
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger("folio.cognito")


class CognitoAuthError(Exception):
    """Raised when an AWS Cognito authentication step fails with a client-safe message."""

    def __init__(self, status_code: int, detail: str, session_expired: bool = False):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.session_expired = session_expired


def get_cognito_client():
    """Create an unsigned boto3 Cognito IDP client for public App Client flows."""
    return boto3.client(
        "cognito-idp",
        region_name=settings.COGNITO_REGION,
        config=Config(
            signature_version=UNSIGNED,
            connect_timeout=5,
            read_timeout=15,
        ),
    )


def build_totp_setup_payload(secret_code: str, username: str) -> dict[str, str]:
    """Build TOTP provisioning secret, otpauth URI, and inline SVG QR data URI."""
    label = urllib.parse.quote(f"Folio:{username}", safe=":")
    otpauth_uri = f"otpauth://totp/{label}?secret={secret_code}&issuer=Folio"
    qr_data_uri = segno.make(otpauth_uri, error="m").svg_data_uri(
        scale=5,
        border=2,
        dark="#111827",
        light="#ffffff",
    )
    return {
        "totp_secret": secret_code,
        "otpauth_uri": otpauth_uri,
        "qr_data_uri": qr_data_uri,
    }


def _map_client_error(exc: ClientError) -> CognitoAuthError:
    """Translate boto3 Cognito ClientError into a safe HTTP-level error without user enumeration."""
    error = exc.response.get("Error", {})
    code = error.get("Code", "")
    message = error.get("Message", "")

    if code == "NotAuthorizedException":
        if "session" in message.lower():
            return CognitoAuthError(
                401,
                "Your sign-in session expired. Please sign in again.",
                session_expired=True,
            )
        return CognitoAuthError(401, "Incorrect email or password.")

    if code == "UserNotFoundException":
        return CognitoAuthError(401, "Incorrect email or password.")

    if code == "InvalidPasswordException":
        return CognitoAuthError(
            400,
            "Password does not meet requirements (at least 20 characters, including a lowercase letter).",
        )

    if code in ("CodeMismatchException", "EnableSoftwareTokenMFAException"):
        return CognitoAuthError(
            400,
            "Invalid 6-digit authenticator code. Please try the current code.",
        )

    if code == "ExpiredCodeException":
        return CognitoAuthError(
            400,
            "Code expired. Please enter the current 6-digit code.",
        )

    if code in ("TooManyRequestsException", "LimitExceededException"):
        return CognitoAuthError(
            429,
            "Too many attempts. Please wait a moment and try again.",
        )

    if code == "PasswordResetRequiredException":
        return CognitoAuthError(400, "Password reset required by administrator.")

    logger.warning(f"Unhandled Cognito ClientError {code}: {message}")
    return CognitoAuthError(400, "Authentication failed. Please try again.")


def _normalize_totp_code(totp_code: str | None) -> str:
    """Strip spaces/hyphens and validate a 6-digit TOTP authenticator code."""
    code = (totp_code or "").replace(" ", "").replace("-", "").strip()
    if len(code) != 6 or not code.isdigit():
        raise CognitoAuthError(
            400,
            "Please enter the 6-digit code from your authenticator app.",
        )
    return code


def _process_auth_response(
    resp: dict[str, Any],
    username: str,
    client: Any,
    depth: int = 0,
) -> dict[str, Any]:
    """Interpret a Cognito auth/challenge response or advance intermediate setup steps."""
    if depth > 4:
        raise CognitoAuthError(400, "Too many sign-in steps. Please start over.")

    if "AuthenticationResult" in resp:
        auth = resp["AuthenticationResult"]
        return {
            "status": "authenticated",
            "username": username,
            "access_token": auth["AccessToken"],
            "refresh_token": auth.get("RefreshToken"),
            "expires_in": int(auth.get("ExpiresIn", 86400)),
        }

    challenge = resp.get("ChallengeName")
    session = resp.get("Session")

    if challenge == "NEW_PASSWORD_REQUIRED":
        return {
            "status": "challenge",
            "challenge": "NEW_PASSWORD_REQUIRED",
            "session": session,
            "username": username,
            "message": "Choose a permanent passphrase (at least 20 characters, including a lowercase letter).",
        }

    if challenge == "SELECT_MFA_TYPE":
        next_resp = client.respond_to_auth_challenge(
            ClientId=settings.COGNITO_CLIENT_ID,
            ChallengeName="SELECT_MFA_TYPE",
            Session=session,
            ChallengeResponses={
                "USERNAME": username,
                "ANSWER": "SOFTWARE_TOKEN_MFA",
            },
        )
        return _process_auth_response(next_resp, username, client, depth=depth + 1)

    if challenge == "MFA_SETUP":
        assoc = client.associate_software_token(Session=session)
        totp_payload = build_totp_setup_payload(assoc["SecretCode"], username)
        return {
            "status": "challenge",
            "challenge": "MFA_SETUP",
            "session": assoc["Session"],
            "username": username,
            "message": "Scan this QR code with your authenticator app, then enter the 6-digit code.",
            **totp_payload,
        }

    if challenge == "SOFTWARE_TOKEN_MFA":
        return {
            "status": "challenge",
            "challenge": "SOFTWARE_TOKEN_MFA",
            "session": session,
            "username": username,
            "message": "Enter the 6-digit code from your authenticator app.",
        }

    raise CognitoAuthError(400, "Unsupported sign-in step. Please start over.")


def cognito_initiate_login(email: str, password: str) -> dict[str, Any]:
    """Start email/password authentication against the configured Cognito App Client."""
    clean_email = email.strip().lower()
    if not clean_email or not password:
        raise CognitoAuthError(400, "Email and password are required.")

    client = get_cognito_client()
    try:
        resp = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            ClientId=settings.COGNITO_CLIENT_ID,
            AuthParameters={
                "USERNAME": clean_email,
                "PASSWORD": password,
            },
        )
        return _process_auth_response(resp, clean_email, client)
    except ClientError as exc:
        raise _map_client_error(exc) from exc
    except BotoCoreError as exc:
        logger.error(f"Cognito service transport error during sign-in: {exc}")
        raise CognitoAuthError(502, "Unable to reach the sign-in service right now. Please try again.") from exc


def cognito_respond_challenge(
    challenge: str,
    username: str,
    session: str,
    new_password: str | None = None,
    totp_code: str | None = None,
    device_name: str = "Folio Authenticator",
) -> dict[str, Any]:
    """Complete a Cognito sign-in challenge (NEW_PASSWORD_REQUIRED, MFA_SETUP, or SOFTWARE_TOKEN_MFA)."""
    clean_user = username.strip().lower()
    if not clean_user or not session:
        raise CognitoAuthError(400, "Missing sign-in session. Please start over.")

    client = get_cognito_client()
    try:
        if challenge == "NEW_PASSWORD_REQUIRED":
            if not new_password:
                raise CognitoAuthError(400, "New passphrase is required.")
            resp = client.respond_to_auth_challenge(
                ClientId=settings.COGNITO_CLIENT_ID,
                ChallengeName="NEW_PASSWORD_REQUIRED",
                Session=session,
                ChallengeResponses={
                    "USERNAME": clean_user,
                    "NEW_PASSWORD": new_password,
                },
            )
            return _process_auth_response(resp, clean_user, client)

        if challenge == "MFA_SETUP":
            code = _normalize_totp_code(totp_code)
            verify = client.verify_software_token(
                Session=session,
                UserCode=code,
                FriendlyDeviceName=device_name,
            )
            if verify.get("Status") != "SUCCESS":
                raise CognitoAuthError(
                    400,
                    "Invalid 6-digit authenticator code. Please try the current code.",
                )
            resp = client.respond_to_auth_challenge(
                ClientId=settings.COGNITO_CLIENT_ID,
                ChallengeName="MFA_SETUP",
                Session=verify["Session"],
                ChallengeResponses={
                    "USERNAME": clean_user,
                },
            )
            return _process_auth_response(resp, clean_user, client)

        if challenge == "SOFTWARE_TOKEN_MFA":
            code = _normalize_totp_code(totp_code)
            resp = client.respond_to_auth_challenge(
                ClientId=settings.COGNITO_CLIENT_ID,
                ChallengeName="SOFTWARE_TOKEN_MFA",
                Session=session,
                ChallengeResponses={
                    "USERNAME": clean_user,
                    "SOFTWARE_TOKEN_MFA_CODE": code,
                },
            )
            return _process_auth_response(resp, clean_user, client)

        raise CognitoAuthError(400, "Unsupported sign-in step. Please start over.")
    except ClientError as exc:
        raise _map_client_error(exc) from exc
    except BotoCoreError as exc:
        logger.error(f"Cognito service transport error during challenge: {exc}")
        raise CognitoAuthError(502, "Unable to reach the sign-in service right now. Please try again.") from exc


def cognito_refresh_session(refresh_token: str) -> dict[str, Any] | None:
    """Exchange a Cognito refresh token for a fresh access token, returning None if invalid."""
    if not refresh_token:
        return None
    client = get_cognito_client()
    try:
        resp = client.initiate_auth(
            AuthFlow="REFRESH_TOKEN_AUTH",
            ClientId=settings.COGNITO_CLIENT_ID,
            AuthParameters={
                "REFRESH_TOKEN": refresh_token,
            },
        )
        auth = resp.get("AuthenticationResult")
        if not auth or not auth.get("AccessToken"):
            return None
        return {
            "access_token": auth["AccessToken"],
            "refresh_token": auth.get("RefreshToken"),
            "expires_in": int(auth.get("ExpiresIn", 86400)),
        }
    except (ClientError, BotoCoreError) as exc:
        logger.debug(f"Cognito token refresh failed: {exc}")
        return None


def cognito_global_sign_out(access_token: str | None) -> None:
    """Best-effort revocation of active Cognito refresh/access tokens for this user session."""
    if not access_token:
        return
    try:
        client = get_cognito_client()
        client.global_sign_out(AccessToken=access_token)
    except Exception as exc:
        logger.debug(f"Cognito global_sign_out ignored: {exc}")
