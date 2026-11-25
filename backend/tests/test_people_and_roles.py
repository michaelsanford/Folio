"""Household people: registration, roles, attribution and invitations."""
import pytest
from fastapi.testclient import TestClient

import app.core.cognito as cognito
from app.api import people as people_api
from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_auth
from app.main import app
from app.models.account import Account
from app.models.app_user import AppUser
from app.models.household import HouseholdMember


def claims_for(sub: str, email: str | None = None) -> dict:
    claims = {"sub": sub, "token_use": "access", "client_id": "test-client", "username": sub}
    if email:
        claims["email"] = email
    return claims


@pytest.fixture
def as_person(db_session, monkeypatch):
    """A client whose session belongs to whichever Cognito person is chosen."""
    monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "ca-central-1_test")
    monkeypatch.setattr(settings, "COGNITO_CLIENT_ID", "test-client")
    monkeypatch.setattr(settings, "FOLIO_OWNER_EMAIL", "")
    # No real identity provider in tests: emails come from the claims.
    monkeypatch.setattr(cognito, "admin_get_user", lambda username: None)
    people_api.invite_limiter.clear()
    current = {"claims": claims_for("owner-sub", "owner@example.com")}

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_auth] = lambda: current["claims"]
    with TestClient(app) as client:
        def switch(sub: str, email: str | None = None) -> TestClient:
            current["claims"] = claims_for(sub, email)
            return client

        yield switch
    app.dependency_overrides.clear()


def test_first_sign_in_owns_the_household_and_later_ones_are_members(as_person, db_session):
    me = as_person("owner-sub", "owner@example.com").get("/api/people/me").json()
    assert me["role"] == "OWNER" and me["can_manage_people"] is True

    me = as_person("partner-sub", "partner@example.com").get("/api/people/me").json()
    assert me["role"] == "MEMBER" and me["can_edit"] is True and me["can_manage_people"] is False
    assert {u.user_key for u in db_session.query(AppUser)} == {"cognito:owner-sub", "cognito:partner-sub"}


def test_configured_owner_email_is_always_an_owner(as_person, monkeypatch):
    as_person("first-sub", "first@example.com").get("/api/people/me")
    monkeypatch.setattr(settings, "FOLIO_OWNER_EMAIL", "Boss@Example.com")
    me = as_person("boss-sub", "boss@example.com").get("/api/people/me").json()
    assert me["role"] == "OWNER"


def test_viewer_reads_but_cannot_write(as_person, db_session):
    as_person("owner-sub").get("/api/people/me")
    db_session.add(AppUser(user_key="cognito:viewer-sub", role="VIEWER", status="ACTIVE"))
    db_session.commit()

    viewer = as_person("viewer-sub")
    assert viewer.get("/api/accounts").status_code == 200
    res = viewer.post("/api/accounts", json={"name": "Nope", "type": "CHECKING"})
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "read_only"
    # Their own appearance settings are still theirs to save.
    assert viewer.put("/api/me/preferences", json={}).status_code == 200


def test_disabled_person_is_refused_even_with_a_valid_session(as_person, db_session):
    as_person("owner-sub").get("/api/people/me")
    db_session.add(AppUser(user_key="cognito:gone-sub", role="MEMBER", status="DISABLED"))
    db_session.commit()
    res = as_person("gone-sub").get("/api/accounts")
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "account_disabled"


def test_changes_record_who_made_them(as_person, db_session):
    as_person("owner-sub").get("/api/people/me")
    created = as_person("owner-sub").post("/api/accounts", json={"name": "Joint", "type": "CHECKING"}).json()
    assert created["created_by"] == "cognito:owner-sub"

    as_person("partner-sub").put(f"/api/accounts/{created['id']}", json={"name": "Joint chequing"})
    row = db_session.get(Account, created["id"])
    db_session.refresh(row)
    assert row.created_by == "cognito:owner-sub"
    assert row.updated_by == "cognito:partner-sub"

    people = as_person("owner-sub").get("/api/bootstrap").json()["people"]
    names = {p["user_key"]: p["name"] for p in people}
    assert names["cognito:partner-sub"] == "Household member"  # no email or name known


def test_the_last_owner_cannot_step_down_or_be_removed(as_person):
    owner = as_person("owner-sub")
    owner.get("/api/people/me")
    res = owner.patch("/api/people/cognito:owner-sub", json={"role": "MEMBER"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "last_owner"


def test_members_cannot_manage_people(as_person):
    as_person("owner-sub").get("/api/people/me")
    member = as_person("member-sub")
    res = member.post("/api/people", json={"email": "x@example.com"})
    assert res.status_code == 403 and res.json()["detail"]["code"] == "owner_only"
    # ...but can see who shares the household.
    assert member.get("/api/people").status_code == 200


def test_invite_is_idempotent_and_links_a_member(as_person, db_session, monkeypatch):
    sent = []

    def fake_invite(email):
        sent.append(email)
        return {"sub": "new-sub", "email": email, "status": "FORCE_CHANGE_PASSWORD",
                "created": "true" if len(sent) == 1 else "false"}

    monkeypatch.setattr(people_api, "admin_invite_user", fake_invite)
    member = HouseholdMember(name="Sarah")
    db_session.add(member)
    db_session.commit()

    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post("/api/people", json={"email": " Sarah@Example.com ".strip(), "role": "VIEWER", "member_id": member.id})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user_key"] == "cognito:new-sub"
    assert body["status"] == "INVITED" and body["role"] == "VIEWER" and body["member_name"] == "Sarah"
    assert body["invited_by_name"] == "owner@example.com"

    again = owner.post("/api/people", json={"email": "sarah@example.com", "role": "MEMBER"})
    assert again.status_code == 201 and again.json()["role"] == "MEMBER"
    assert db_session.query(AppUser).filter(AppUser.user_key == "cognito:new-sub").count() == 1

    # First request from the invited person activates them.
    assert as_person("new-sub").get("/api/people/me").json()["role"] == "MEMBER"
    assert db_session.get(AppUser, "cognito:new-sub").status == "ACTIVE"


def test_disable_and_remove_go_to_the_identity_provider(as_person, db_session, monkeypatch):
    calls = []
    monkeypatch.setattr(people_api, "admin_set_enabled", lambda u, enabled: calls.append(("enabled", u, enabled)))
    monkeypatch.setattr(people_api, "admin_delete_user", lambda u: calls.append(("delete", u)))
    owner = as_person("owner-sub")
    owner.get("/api/people/me")
    db_session.add(AppUser(user_key="cognito:p-sub", email="p@example.com", role="MEMBER", status="ACTIVE"))
    db_session.commit()

    res = owner.patch("/api/people/cognito:p-sub", json={"status": "DISABLED"})
    assert res.status_code == 200 and res.json()["status"] == "DISABLED"
    assert calls == [("enabled", "p@example.com", False)]

    assert owner.delete("/api/people/cognito:p-sub").status_code == 204
    assert calls[-1] == ("delete", "p@example.com")
    assert owner.delete("/api/people/cognito:owner-sub").status_code == 400  # not yourself


def test_link_yourself_to_a_member_once(as_person, db_session):
    member = HouseholdMember(name="Michael")
    db_session.add(member)
    db_session.commit()
    owner = as_person("owner-sub")
    me = owner.patch("/api/people/me", json={"member_id": member.id, "display_name": "Mike"}).json()
    assert me["member_id"] == member.id and me["display_name"] == "Mike"

    res = as_person("other-sub").patch("/api/people/me", json={"member_id": member.id})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "member_taken"


def test_passphrase_owner_needs_no_row_and_cannot_invite(client):
    me = client.get("/api/people/me").json()
    assert me["role"] == "OWNER" and me["can_manage_people"] is False
    res = client.post("/api/people", json={"email": "x@example.com"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "single_user"
