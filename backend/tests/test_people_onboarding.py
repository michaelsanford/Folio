"""Adding someone in one step, and the first-sign-in welcome."""
import pytest

import app.core.cognito as cognito
from app.api import people as people_api
from app.core.cognito import CognitoAuthError
from app.models.app_user import AppUser
from app.models.household import HouseholdMember
from tests.test_people_and_roles import as_person, claims_for  # noqa: F401 - fixture


@pytest.fixture
def invites(monkeypatch):
    sent = []

    def fake_invite(email, name=None):
        sent.append((email, name))
        return {"sub": f"sub-{len(sent)}", "email": email, "status": "FORCE_CHANGE_PASSWORD", "created": "true"}

    monkeypatch.setattr(people_api, "admin_invite_user", fake_invite)
    return sent


def test_add_with_an_invitation_creates_a_linked_named_sign_in(as_person, db_session, invites):
    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post(
        "/api/people/add",
        json={"name": "Sam", "relationship": "Partner", "access": "invite", "email": "Sam@Example.com", "role": "MEMBER"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert invites == [("sam@example.com", "Sam")]
    assert body["member_name"] == "Sam"
    person = body["person"]
    assert person["status"] == "INVITED" and person["role"] == "MEMBER"
    assert person["display_name"] == "Sam" and person["member_id"] == body["member_id"]
    member = db_session.get(HouseholdMember, body["member_id"])
    assert member.role == "Partner"


def test_a_dependent_is_bookkeeping_only_by_default(as_person, db_session, invites):
    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post("/api/people/add", json={"name": "Emma", "relationship": "Dependent"})
    assert res.status_code == 201
    assert res.json()["person"] is None
    assert invites == []
    assert db_session.query(AppUser).count() == 1  # just the owner


def test_an_invited_dependent_can_only_view_unless_told_otherwise(as_person, invites):
    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post(
        "/api/people/add",
        json={"name": "Liam", "relationship": "Dependent", "access": "invite", "email": "liam@example.com"},
    )
    assert res.json()["person"]["role"] == "VIEWER"


def test_a_failed_invitation_adds_nobody(as_person, db_session, monkeypatch):
    def broken(email, name=None):
        raise CognitoAuthError(502, "invite failed")

    monkeypatch.setattr(people_api, "admin_invite_user", broken)
    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post("/api/people/add", json={"name": "Sam", "access": "invite", "email": "sam@example.com"})
    assert res.status_code >= 400
    assert db_session.query(HouseholdMember).filter(HouseholdMember.name == "Sam").count() == 0


def test_inviting_an_email_that_already_has_access_is_refused(as_person, invites):
    owner = as_person("owner-sub", "owner@example.com")
    owner.get("/api/people/me")
    res = owner.post("/api/people/add", json={"name": "Me again", "access": "invite", "email": "owner@example.com"})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "already_invited"


def test_only_owners_add_people(as_person, invites):
    as_person("owner-sub", "owner@example.com").get("/api/people/me")
    member = as_person("member-sub", "member@example.com")
    member.get("/api/people/me")
    assert member.post("/api/people/add", json={"name": "Someone"}).status_code == 403


def test_passphrase_mode_adds_members_but_cannot_invite(client):
    assert client.post("/api/people/add", json={"name": "Emma", "relationship": "Dependent"}).status_code == 201
    res = client.post("/api/people/add", json={"name": "Sam", "access": "invite", "email": "sam@example.com"})
    assert res.status_code == 400


def test_welcome_names_you_and_creates_your_member(as_person, db_session, monkeypatch):
    stored = []
    monkeypatch.setattr(people_api, "admin_set_name", lambda username, name: stored.append((username, name)))
    owner = as_person("owner-sub", "owner@example.com")
    assert owner.get("/api/people/me").json()["needs_welcome"] is True
    res = owner.post("/api/people/me/welcome", json={"name": "Michael"})
    assert res.status_code == 200
    me = res.json()
    assert me["display_name"] == "Michael" and me["needs_welcome"] is False
    member = db_session.get(HouseholdMember, me["member_id"])
    assert member.name == "Michael" and member.role == "Self"
    assert stored == [("owner@example.com", "Michael")]


def test_welcome_links_an_existing_unlinked_member_with_your_name(as_person, db_session, monkeypatch):
    monkeypatch.setattr(people_api, "admin_set_name", lambda username, name: None)
    existing = HouseholdMember(name="Sarah", role="Partner")
    db_session.add(existing)
    db_session.commit()
    as_person("owner-sub", "owner@example.com").get("/api/people/me")
    partner = as_person("partner-sub", "partner@example.com")
    me = partner.post("/api/people/me/welcome", json={"name": "sarah"}).json()
    assert me["member_id"] == existing.id
    assert db_session.query(HouseholdMember).count() == 1


def test_welcome_still_works_when_the_profile_cannot_be_updated(as_person, monkeypatch):
    def broken(username, name):
        raise CognitoAuthError(502, "nope")

    monkeypatch.setattr(people_api, "admin_set_name", broken)
    owner = as_person("owner-sub", "owner@example.com")
    res = owner.post("/api/people/me/welcome", json={"name": "Michael"})
    assert res.status_code == 200 and res.json()["needs_welcome"] is False


def test_first_sign_in_takes_the_name_from_the_profile(as_person, monkeypatch):
    monkeypatch.setattr(
        cognito,
        "admin_get_user",
        lambda username: {"sub": "named-sub", "email": "named@example.com", "name": "Named Person", "status": "CONFIRMED"},
    )
    me = as_person("named-sub").get("/api/people/me").json()
    assert me["display_name"] == "Named Person"
    assert me["needs_welcome"] is False
