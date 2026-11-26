"""Per-user UI appearance preferences, keyed by the authenticated identity."""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_auth, user_key_from_claims
from app.models.user_preference import UserPreference
from app.schemas.preferences import PreferencesResponse, UiPreferences

logger = logging.getLogger("folio.preferences")

router = APIRouter(prefix="/me", tags=["Preferences"])

MAX_PREFERENCES_BODY_BYTES = 4096


def _load_preferences(row: UserPreference, user_key: str) -> UiPreferences:
    """Stored JSON -> UiPreferences, dropping any field that no longer validates.

    A theme id retired in a later release must not turn every page load into a
    500; the user just falls back to the default for that one setting.
    """
    try:
        raw = json.loads(row.data)
    except (TypeError, ValueError):
        logger.warning("Discarding unreadable stored preferences for %s", user_key)
        return UiPreferences()
    if not isinstance(raw, dict):
        logger.warning("Discarding non-object stored preferences for %s", user_key)
        return UiPreferences()

    kept: dict = {}
    for name, value in raw.items():
        try:
            UiPreferences.model_validate({name: value})
        except ValidationError:
            logger.warning("Dropping invalid stored preference %r for %s", name, user_key)
            continue
        kept[name] = value
    return UiPreferences.model_validate(kept)


async def _bounded_body(request: Request) -> bytes:
    """The raw request body, refused with 413 once it passes the size limit."""
    too_large = HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Preferences body exceeds {MAX_PREFERENCES_BODY_BYTES} bytes",
    )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PREFERENCES_BODY_BYTES:
        raise too_large
    # Content-Length can be absent (chunked) or wrong: count what actually arrives.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_PREFERENCES_BODY_BYTES:
            raise too_large
    return bytes(body)


def preferences_for(db: Session, user_key: str) -> PreferencesResponse:
    """Saved preferences for ``user_key``; empty with ``updated_at`` None if none."""
    row = db.get(UserPreference, user_key)
    if row is None:
        return PreferencesResponse(preferences=UiPreferences(), updated_at=None)
    return PreferencesResponse(preferences=_load_preferences(row, user_key), updated_at=row.updated_at)


@router.get("/preferences", response_model=PreferencesResponse)
def get_preferences(claims: dict = Depends(require_auth), db: Session = Depends(get_db)):
    """The caller's saved preferences; ``{"preferences": {}, "updated_at": null}`` if none."""
    return preferences_for(db, user_key_from_claims(claims))


@router.put(
    "/preferences",
    response_model=PreferencesResponse,
    # The body is read by _bounded_body (to enforce the size limit before
    # parsing), so describe it for OpenAPI by hand.
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UiPreferences"}}},
        }
    },
)
def put_preferences(
    body: bytes = Depends(_bounded_body),
    claims: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Replace the caller's preferences wholesale (omitted fields are cleared)."""
    user_key = user_key_from_claims(claims)
    try:
        prefs = UiPreferences.model_validate_json(body or b"null")
    except ValidationError as exc:
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in exc.errors(include_url=False)]
        ) from None

    data = json.dumps(prefs.model_dump(mode="json", exclude_none=True), separators=(",", ":"))
    now = datetime.now(timezone.utc)
    row = db.get(UserPreference, user_key)
    if row is None:
        row = UserPreference(user_key=user_key, data=data, updated_at=now)
        db.add(row)
    else:
        row.data = data
        row.updated_at = now  # explicit: onupdate does not fire for an unchanged payload
    db.commit()
    return PreferencesResponse(preferences=prefs, updated_at=now)
