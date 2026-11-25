"""The signed-in person: who they are, what they may do, and who changed what.

``authorize`` replaces ``require_auth`` on every protected router. It verifies
the session (through ``require_auth``), resolves the person in ``app_users``
and enforces their role:

- DISABLED people are refused (403 ``account_disabled``) even while their
  token is still valid, so removing someone takes effect at once.
- VIEWERs may only read; any other method answers 403 ``read_only``, except
  saving their own appearance preferences.
- ``require_owner`` additionally guards people management and destructive
  maintenance.

Local passphrase sessions (and any non-Cognito key) are the single implicit
OWNER and never need a row.

The person's key is also put in a ContextVar, which the session
``before_flush`` listener below copies into ``created_by`` / ``updated_by``.
``authorize`` is ``async`` so the ContextVar is set in the request's own
context, which the threadpool running a sync endpoint inherits.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_auth, user_key_from_claims
from app.core.visibility import set_viewer
from app.models.app_user import AppRole, AppUser, AppUserStatus

logger = logging.getLogger("folio.actor")

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Writes a VIEWER may still make: their own appearance preferences.
VIEWER_WRITABLE_PATHS = frozenset({f"{settings.API_V1_STR}/me/preferences"})

COGNITO_PREFIX = "cognito:"

_current_actor: ContextVar[str | None] = ContextVar("folio_actor", default=None)


@dataclass(frozen=True)
class Actor:
    user_key: str
    role: str
    status: str
    email: str | None = None
    display_name: str | None = None
    member_id: str | None = None
    local: bool = False
    # True when resolving this person wrote to the vault (first sign-in,
    # invitation accepted), so even a GET must upload before it returns.
    wrote: bool = False

    @property
    def can_edit(self) -> bool:
        return self.role in (AppRole.OWNER.value, AppRole.MEMBER.value)

    @property
    def is_owner(self) -> bool:
        return self.role == AppRole.OWNER.value


def current_actor_key() -> str | None:
    """User key of the person making the current request, if any."""
    return _current_actor.get()


def set_current_actor(user_key: str | None):
    """Bind an actor outside a request (tests, scripts). Returns the reset token."""
    return _current_actor.set(user_key)


def reset_current_actor(token) -> None:
    _current_actor.reset(token)


def _claims_email(claims: dict) -> str | None:
    for name in ("email", "username", "cognito:username"):
        value = claims.get(name)
        if isinstance(value, str) and "@" in value:
            return value.strip().lower()[:254]
    return None


def _lookup_profile(claims: dict) -> dict[str, str]:
    """Email and name of a Cognito person, looked up once when they are first
    registered (access tokens of an email-username pool carry neither)."""
    if not settings.is_cognito_enabled:
        return {}
    username = claims.get("username") or claims.get("cognito:username") or claims.get("sub")
    if not isinstance(username, str) or not username:
        return {}
    try:
        from app.core.cognito import admin_get_user

        found = admin_get_user(username)
    except Exception:
        logger.warning("Could not look up the profile of a new sign-in", exc_info=True)
        return {}
    return found or {}


def _owner_email() -> str:
    return (settings.FOLIO_OWNER_EMAIL or "").strip().lower()


def _actor_from_row(row: AppUser, wrote: bool = False) -> Actor:
    return Actor(
        user_key=row.user_key,
        role=row.role,
        status=row.status,
        email=row.email,
        display_name=row.display_name,
        member_id=row.member_id,
        wrote=wrote,
    )


def resolve_actor(db: Session, claims: dict, email: str | None = None) -> Actor:
    """The person behind verified ``claims``, registering them on first sight.

    - A key that is not a Cognito one is the local passphrase owner.
    - A Cognito person not yet in ``app_users`` is added: as OWNER when their
      email is ``FOLIO_OWNER_EMAIL`` or nobody is an owner yet, otherwise as
      MEMBER. The pool only accepts people an administrator created, so
      everyone in it was invited on purpose.
    - An INVITED person becomes ACTIVE on their first request.
    """
    key = user_key_from_claims(claims)
    if not key.startswith(COGNITO_PREFIX):
        # The local passphrase owner. A row exists only once they link
        # themselves to a household member (PATCH /people/me).
        row = db.get(AppUser, key)
        return Actor(
            user_key=key,
            role=AppRole.OWNER.value,
            status=AppUserStatus.ACTIVE.value,
            display_name=row.display_name if row else None,
            member_id=row.member_id if row else None,
            local=True,
        )

    email = (email or "").strip().lower() or _claims_email(claims)
    owner_email = _owner_email()
    row = db.get(AppUser, key)
    now = datetime.now(timezone.utc)

    if row is None:
        profile = _lookup_profile(claims)
        email = email or profile.get("email") or None
        profile_name = (profile.get("name") or "").strip() or None
        has_owner = db.scalar(select(AppUser.user_key).where(AppUser.role == AppRole.OWNER.value).limit(1))
        role = AppRole.OWNER if (email and email == owner_email) or not has_owner else AppRole.MEMBER
        row = AppUser(
            user_key=key,
            email=email,
            display_name=profile_name,
            role=role.value,
            status=AppUserStatus.ACTIVE.value,
            created_at=now,
            last_sign_in_at=now,
        )
        db.add(row)
        db.commit()
        logger.info("Registered %s as %s on first sign-in", key, role.value)
        return _actor_from_row(row, wrote=True)

    wrote = False
    if row.status == AppUserStatus.INVITED.value:
        row.status = AppUserStatus.ACTIVE.value
        row.last_sign_in_at = now
        wrote = True
    if email and not row.email:
        row.email = email
        wrote = True
    if owner_email and email == owner_email and row.role != AppRole.OWNER.value:
        row.role = AppRole.OWNER.value
        wrote = True
    if wrote:
        db.commit()
    return _actor_from_row(row, wrote=wrote)


def _forbidden(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": code, "message": message})


async def authorize(
    request: Request,
    claims: dict = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Actor:
    """Router dependency: verified session + known, enabled person + role check."""
    actor = await run_in_threadpool(resolve_actor, db, claims)
    if actor.status == AppUserStatus.DISABLED.value:
        raise _forbidden("account_disabled", "This account has been disabled. Ask the household owner.")
    if (
        not actor.can_edit
        and request.method in MUTATING_METHODS
        and request.url.path not in VIEWER_WRITABLE_PATHS
    ):
        raise _forbidden("read_only", "You have view-only access to this household.")
    _current_actor.set(actor.user_key)
    # Which accounts this request may see (core/visibility.py). The single
    # passphrase owner is the only person, so nothing is hidden from them.
    set_viewer(actor.member_id, unrestricted=actor.local)
    request.state.actor = actor
    return actor


def require_owner(actor: Actor = Depends(authorize)) -> Actor:
    """Route dependency for people management and destructive maintenance."""
    if not actor.is_owner:
        raise _forbidden("owner_only", "Only a household owner can do this.")
    return actor


def record_sign_in(db: Session, claims: dict, email: str | None = None) -> None:
    """Register the person and stamp ``last_sign_in_at`` after a completed
    sign-in (a POST, so the write is uploaded before it returns)."""
    try:
        actor = resolve_actor(db, claims, email=email)
        if actor.local:
            return
        row = db.get(AppUser, actor.user_key)
        if row is not None:
            row.last_sign_in_at = datetime.now(timezone.utc)
            db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Recording the sign-in failed")


def attribution_labels(db: Session, keys) -> dict[str, str]:
    """Display names for user keys, in one query. Unknown keys are left out."""
    wanted = {k for k in keys if k}
    if not wanted:
        return {}
    rows = db.scalars(select(AppUser).where(AppUser.user_key.in_(wanted))).all()
    labels = {row.user_key: row.label for row in rows}
    for key in wanted - labels.keys():
        if not key.startswith(COGNITO_PREFIX):
            labels[key] = "Owner"
    return labels


# ---------------------------------------------------------------------------
# created_by / updated_by
# ---------------------------------------------------------------------------
@event.listens_for(Session, "before_flush")
def _stamp_attribution(session: Session, flush_context, instances) -> None:
    actor = _current_actor.get()
    if not actor:
        return
    for obj in session.new:
        if hasattr(obj, "created_by"):
            if obj.created_by is None:
                obj.created_by = actor
            obj.updated_by = actor
    for obj in session.dirty:
        if hasattr(obj, "updated_by") and session.is_modified(obj, include_collections=False):
            obj.updated_by = actor
