"""People who can sign in to this household: invitations, roles, links to members.

Every route needs a signed-in person (``authorize`` on the router). Managing
other people needs an OWNER; ``/people/me`` is anyone's own record. Invitations
and sign-in changes go to the identity provider, so they exist only when
account sign-in (Cognito) is enabled; passphrase mode has a single owner.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.actor import (
    COGNITO_PREFIX,
    Actor,
    attribution_labels,
    authorize,
    require_owner,
)
from app.core.cognito import (
    CognitoAuthError,
    admin_delete_user,
    admin_invite_user,
    admin_resend_invite,
    admin_set_enabled,
    admin_set_name,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import SlidingWindowLimiter
from app.models.app_user import AppRole, AppUser, AppUserStatus
from app.api.household import add_member
from app.models.household import HouseholdMember
from app.schemas.people import (
    MeResponse,
    MeUpdate,
    PeopleListResponse,
    PersonAdd,
    PersonAddResponse,
    PersonInvite,
    PersonResponse,
    PersonSummary,
    PersonUpdate,
    WelcomeRequest,
)

router = APIRouter(prefix="/people", tags=["People"])
logger = logging.getLogger("folio.people")

# Invitations send email (the default sender allows 50 a day): cap them per owner.
invite_limiter = SlidingWindowLimiter(max_attempts=10, window_seconds=3600)


def me_response(actor: Actor) -> MeResponse:
    return MeResponse(
        user_key=actor.user_key,
        email=actor.email,
        display_name=actor.display_name,
        role=actor.role,
        member_id=actor.member_id,
        can_edit=actor.can_edit,
        is_owner=actor.is_owner,
        can_manage_people=settings.is_cognito_enabled and actor.is_owner,
        needs_welcome=actor.member_id is None and not actor.display_name,
        shared_household=settings.is_cognito_enabled,
    )


def people_summaries(db: Session) -> list[PersonSummary]:
    """Everyone who ever had a sign-in, named for attribution. One query."""
    rows = db.scalars(select(AppUser).options(joinedload(AppUser.member))).all()
    return [PersonSummary(user_key=r.user_key, name=r.label, member_id=r.member_id) for r in rows]


def _error(code: int, slug: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": slug, "message": message})


def _from_cognito(exc: CognitoAuthError) -> HTTPException:
    return _error(exc.status_code, "identity_error", exc.detail)


def _require_account_sign_in() -> None:
    if not settings.is_cognito_enabled:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "single_user",
            "This vault uses a single passphrase, so there is nobody else to manage.",
        )


def _username(person: AppUser) -> str:
    """Name the identity provider knows the person by: email, else their sub."""
    if person.email:
        return person.email
    return person.user_key.removeprefix(COGNITO_PREFIX)


def _get_person(db: Session, user_key: str) -> AppUser:
    person = db.get(AppUser, user_key)
    if person is None:
        raise _error(status.HTTP_404_NOT_FOUND, "not_found", "That person isn't part of this household.")
    return person


def _check_member(db: Session, member_id: str | None, user_key: str) -> None:
    """The member must exist and must not already be someone else's."""
    if member_id is None:
        return
    if db.get(HouseholdMember, member_id) is None:
        raise _error(status.HTTP_404_NOT_FOUND, "member_not_found", "That household member doesn't exist.")
    other = db.scalar(
        select(AppUser).where(AppUser.member_id == member_id, AppUser.user_key != user_key)
    )
    if other is not None:
        raise _error(
            status.HTTP_409_CONFLICT,
            "member_taken",
            f"That household member is already linked to {other.label}.",
        )


def _other_active_owners(db: Session, user_key: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(AppUser)
        .where(
            AppUser.role == AppRole.OWNER.value,
            AppUser.status != AppUserStatus.DISABLED.value,
            AppUser.user_key != user_key,
        )
    ) or 0


def _guard_last_owner(db: Session, person: AppUser) -> None:
    if person.role == AppRole.OWNER.value and _other_active_owners(db, person.user_key) == 0:
        raise _error(
            status.HTTP_409_CONFLICT,
            "last_owner",
            "A household needs at least one owner. Make someone else an owner first.",
        )


def _to_response(people: list[AppUser], me: str, labels: dict[str, str]) -> list[PersonResponse]:
    return [
        PersonResponse(
            user_key=p.user_key,
            email=p.email,
            display_name=p.display_name,
            role=p.role,
            status=p.status,
            member_id=p.member_id,
            member_name=p.member.name if p.member else None,
            invited_by_name=labels.get(p.invited_by) if p.invited_by else None,
            created_at=p.created_at,
            last_sign_in_at=p.last_sign_in_at,
            is_me=p.user_key == me,
        )
        for p in people
    ]


def _person_response(db: Session, person: AppUser, me: str) -> PersonResponse:
    db.refresh(person)
    labels = attribution_labels(db, [person.invited_by])
    return _to_response([person], me, labels)[0]


@router.get("/me", response_model=MeResponse)
def get_me(actor: Actor = Depends(authorize)):
    return me_response(actor)


@router.patch("/me", response_model=MeResponse)
def update_me(body: MeUpdate, actor: Actor = Depends(authorize), db: Session = Depends(get_db)):
    """Your own display name and which household member you are."""
    fields = body.model_dump(exclude_unset=True)
    person = db.get(AppUser, actor.user_key)
    if person is None:
        # The local passphrase owner has no row until now.
        person = AppUser(
            user_key=actor.user_key,
            role=AppRole.OWNER.value,
            status=AppUserStatus.ACTIVE.value,
            created_at=datetime.now(timezone.utc),
        )
        db.add(person)
    if "member_id" in fields:
        _check_member(db, fields["member_id"], actor.user_key)
        person.member_id = fields["member_id"]
    if "display_name" in fields:
        person.display_name = (fields["display_name"] or "").strip() or None
    db.commit()
    db.refresh(person)
    return me_response(
        Actor(
            user_key=person.user_key,
            role=person.role,
            status=person.status,
            email=person.email,
            display_name=person.display_name,
            member_id=person.member_id,
            local=actor.local,
        )
    )


@router.get("", response_model=PeopleListResponse)
def list_people(actor: Actor = Depends(authorize), db: Session = Depends(get_db)):
    """Everyone with a sign-in. Any member may see who shares the household."""
    people = db.scalars(
        select(AppUser).options(joinedload(AppUser.member)).order_by(AppUser.created_at.asc())
    ).all()
    labels = attribution_labels(db, [p.invited_by for p in people])
    return PeopleListResponse(
        people=_to_response(list(people), actor.user_key, labels),
        can_manage_people=settings.is_cognito_enabled and actor.is_owner,
    )


@router.post("", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
async def invite_person(
    body: PersonInvite,
    request: Request,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Email an invitation and add the person. Inviting someone again is harmless."""
    _require_account_sign_in()
    # The invitation email is not part of the vault: never replay this request.
    request.state.no_replay = True
    allowed, retry_after = invite_limiter.check(actor.user_key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "message": "Too many invitations. Try again later."},
            headers={"Retry-After": str(retry_after)},
        )
    await run_in_threadpool(_check_member, db, body.member_id, "")
    try:
        created = await run_in_threadpool(admin_invite_user, body.email)
    except CognitoAuthError as exc:
        raise _from_cognito(exc) from exc
    invite_limiter.record_failure(actor.user_key)  # counts sends, not failures

    def save() -> PersonResponse:
        key = f"{COGNITO_PREFIX}{created['sub']}"
        person = db.get(AppUser, key)
        if person is None:
            person = AppUser(
                user_key=key,
                email=created["email"] or body.email,
                created_at=datetime.now(timezone.utc),
                invited_by=actor.user_key,
                status=AppUserStatus.INVITED.value
                if created.get("status") == "FORCE_CHANGE_PASSWORD"
                else AppUserStatus.ACTIVE.value,
            )
            db.add(person)
        person.role = body.role
        if body.display_name:
            person.display_name = body.display_name.strip()
        if body.member_id:
            _check_member(db, body.member_id, key)
            person.member_id = body.member_id
        db.commit()
        return _person_response(db, person, actor.user_key)

    return await run_in_threadpool(save)


def _check_rate(actor: Actor) -> None:
    allowed, retry_after = invite_limiter.check(actor.user_key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "message": "Too many invitations. Try again later."},
            headers={"Retry-After": str(retry_after)},
        )


@router.post("/add", response_model=PersonAddResponse, status_code=status.HTTP_201_CREATED)
async def add_person(
    body: PersonAdd,
    request: Request,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Add someone in one step: their household member and, with ``access``
    "invite", their sign-in with a role and an invitation email. A dependent
    without an email is a member only (bookkeeping: their accounts, goals and
    spending), and can be invited later."""
    if body.access == "invite":
        _require_account_sign_in()
        if not body.email:
            raise _error(status.HTTP_400_BAD_REQUEST, "email_required", "Enter their email address to invite them.")
        # The invitation email is not part of the database: never replay this request.
        request.state.no_replay = True
        _check_rate(actor)

        def taken() -> bool:
            return db.scalar(select(AppUser.user_key).where(func.lower(AppUser.email) == body.email)) is not None

        if await run_in_threadpool(taken):
            raise _error(status.HTTP_409_CONFLICT, "already_invited", f"{body.email} already has access.")

    member = await run_in_threadpool(add_member, db, body.name, body.relationship, body.color)
    if body.access == "none":
        await run_in_threadpool(db.commit)
        return PersonAddResponse(member_id=member.id, member_name=member.name)

    try:
        created = await run_in_threadpool(admin_invite_user, body.email, body.name)
    except CognitoAuthError as exc:
        await run_in_threadpool(db.rollback)
        raise _from_cognito(exc) from exc
    invite_limiter.record_failure(actor.user_key)  # counts sends, not failures
    role = body.role or (AppRole.VIEWER.value if body.relationship == "Dependent" else AppRole.MEMBER.value)

    def save() -> PersonAddResponse:
        key = f"{COGNITO_PREFIX}{created['sub']}"
        person = db.get(AppUser, key)
        if person is None:
            person = AppUser(
                user_key=key,
                email=created["email"] or body.email,
                created_at=datetime.now(timezone.utc),
                invited_by=actor.user_key,
                status=AppUserStatus.INVITED.value
                if created.get("status") == "FORCE_CHANGE_PASSWORD"
                else AppUserStatus.ACTIVE.value,
            )
            db.add(person)
        person.role = role
        person.display_name = body.name
        person.member_id = member.id
        db.commit()
        return PersonAddResponse(
            member_id=member.id,
            member_name=member.name,
            person=_person_response(db, person, actor.user_key),
        )

    return await run_in_threadpool(save)


@router.post("/me/welcome", response_model=MeResponse)
def welcome(body: WelcomeRequest, actor: Actor = Depends(authorize), db: Session = Depends(get_db)):
    """First sign-in: who you are. Creates your household member (or links the
    unlinked one with your name), names you, and stores the name in your
    sign-in profile."""
    person = db.get(AppUser, actor.user_key)
    if person is None:
        # The local passphrase owner has no row until now.
        person = AppUser(
            user_key=actor.user_key,
            role=AppRole.OWNER.value,
            status=AppUserStatus.ACTIVE.value,
            created_at=datetime.now(timezone.utc),
        )
        db.add(person)
    if person.member_id is None:
        linked = select(AppUser.member_id).where(AppUser.member_id.is_not(None))
        member = db.scalar(
            select(HouseholdMember)
            .where(func.lower(HouseholdMember.name) == body.name.lower(), HouseholdMember.id.not_in(linked))
            .limit(1)
        )
        if member is None:
            relationship = body.relationship or ("Self" if actor.is_owner else "Other")
            member = add_member(db, body.name, relationship)
        elif body.relationship:
            member.role = body.relationship
        person.member_id = member.id
    person.display_name = body.name
    db.commit()
    db.refresh(person)
    if not actor.local and settings.is_cognito_enabled:
        try:
            admin_set_name(_username(person), body.name)
        except Exception:
            logger.warning("Could not store the name in the sign-in profile", exc_info=True)
    return me_response(
        Actor(
            user_key=person.user_key,
            role=person.role,
            status=person.status,
            email=person.email,
            display_name=person.display_name,
            member_id=person.member_id,
            local=actor.local,
        )
    )


@router.patch("/{user_key}", response_model=PersonResponse)
def update_person(
    user_key: str,
    body: PersonUpdate,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Change someone's role, name or member link; disable or re-enable them."""
    person = _get_person(db, user_key)
    fields = body.model_dump(exclude_unset=True)

    if "role" in fields and fields["role"] != person.role and fields["role"] != AppRole.OWNER.value:
        _guard_last_owner(db, person)
    if fields.get("status") == AppUserStatus.DISABLED.value and person.status != AppUserStatus.DISABLED.value:
        if person.user_key == actor.user_key:
            raise _error(status.HTTP_400_BAD_REQUEST, "self", "You can't disable your own sign-in.")
        _guard_last_owner(db, person)

    if "member_id" in fields:
        _check_member(db, fields["member_id"], person.user_key)
        person.member_id = fields["member_id"]
    if "display_name" in fields:
        person.display_name = (fields["display_name"] or "").strip() or None
    if "role" in fields and fields["role"] is not None:
        person.role = fields["role"]

    new_status = fields.get("status")
    if new_status and new_status != person.status and not (
        new_status == AppUserStatus.ACTIVE.value and person.status == AppUserStatus.INVITED.value
    ):
        if person.user_key.startswith(COGNITO_PREFIX) and settings.is_cognito_enabled:
            try:
                admin_set_enabled(_username(person), new_status == AppUserStatus.ACTIVE.value)
            except CognitoAuthError as exc:
                db.rollback()
                raise _from_cognito(exc) from exc
        person.status = new_status
    db.commit()
    return _person_response(db, person, actor.user_key)


@router.post("/{user_key}/resend", status_code=status.HTTP_204_NO_CONTENT)
def resend_invitation(
    user_key: str,
    request: Request,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    _require_account_sign_in()
    request.state.no_replay = True
    person = _get_person(db, user_key)
    if person.status != AppUserStatus.INVITED.value:
        raise _error(status.HTTP_409_CONFLICT, "not_invited", "This person has already signed in.")
    allowed, retry_after = invite_limiter.check(actor.user_key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "message": "Too many invitations. Try again later."},
            headers={"Retry-After": str(retry_after)},
        )
    try:
        admin_resend_invite(_username(person))
    except CognitoAuthError as exc:
        raise _from_cognito(exc) from exc
    invite_limiter.record_failure(actor.user_key)


@router.delete("/{user_key}", status_code=status.HTTP_204_NO_CONTENT)
def remove_person(
    user_key: str,
    actor: Actor = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Delete the sign-in. The row stays (DISABLED, unlinked) so past changes keep a name."""
    person = _get_person(db, user_key)
    if person.user_key == actor.user_key:
        raise _error(status.HTTP_400_BAD_REQUEST, "self", "You can't remove yourself.")
    _guard_last_owner(db, person)
    if person.user_key.startswith(COGNITO_PREFIX) and settings.is_cognito_enabled:
        try:
            admin_delete_user(_username(person))
        except CognitoAuthError as exc:
            raise _from_cognito(exc) from exc
    person.status = AppUserStatus.DISABLED.value
    person.member_id = None
    db.commit()
