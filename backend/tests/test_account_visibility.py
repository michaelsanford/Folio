"""Account owners and visibility: household, totals only, private."""
from datetime import datetime

import pytest

from app.models.account import Account, AccountType
from app.models.app_user import AppUser
from app.models.household import HouseholdMember
from app.models.transaction import Transaction, TransactionSplit
from tests.test_people_and_roles import as_person, claims_for  # noqa: F401 - fixture


@pytest.fixture
def household(as_person, db_session):
    """Alex (owner) and Blair (can edit), each linked to a member, plus a child
    with no sign-in. Alex has one account of each visibility."""
    as_person("alex-sub", "alex@example.com").get("/api/people/me")
    as_person("blair-sub", "blair@example.com").get("/api/people/me")
    alex_m, blair_m, kid_m = HouseholdMember(name="Alex"), HouseholdMember(name="Blair"), HouseholdMember(name="Kid")
    db_session.add_all([alex_m, blair_m, kid_m])
    db_session.flush()
    db_session.get(AppUser, "cognito:alex-sub").member_id = alex_m.id
    db_session.get(AppUser, "cognito:blair-sub").member_id = blair_m.id

    accounts = {}
    for name, visibility, balance in (("Joint", None, 100.0), ("Alex Savings", "TOTALS", 1000.0), ("Alex Secret", "PRIVATE", 50000.0)):
        acc = Account(name=name, type=AccountType.SAVINGS, visibility=visibility, current_balance=balance)
        acc.owners = [alex_m]
        db_session.add(acc)
        db_session.flush()
        txn = Transaction(account_id=acc.id, transaction_date=datetime(2026, 2, 1), raw_payee=f"{name} payee", amount=-5.0)
        txn.splits.append(TransactionSplit(amount=-5.0))
        db_session.add(txn)
        accounts[name] = acc.id
    db_session.commit()
    return {"alex": alex_m.id, "blair": blair_m.id, "kid": kid_m.id, **accounts}


def test_owner_sees_everything_they_own(as_person, household):
    alex = as_person("alex-sub", "alex@example.com")
    names = {a["name"]: a for a in alex.get("/api/accounts").json()}
    assert set(names) == {"Joint", "Alex Savings", "Alex Secret"}
    assert not any(a["redacted"] for a in names.values())
    assert names["Alex Secret"]["visibility"] == "PRIVATE"
    assert names["Alex Secret"]["owner_names"] == ["Alex"]
    payees = {t["raw_payee"] for t in alex.get("/api/transactions").json()["items"]}
    assert payees == {"Joint payee", "Alex Savings payee", "Alex Secret payee"}


def test_others_see_totals_only_accounts_redacted_and_private_ones_not_at_all(as_person, household):
    blair = as_person("blair-sub", "blair@example.com")
    accounts = blair.get("/api/accounts").json()
    by_id = {a["id"]: a for a in accounts}
    assert household["Alex Secret"] not in by_id
    redacted = by_id[household["Alex Savings"]]
    assert redacted["redacted"] is True
    assert redacted["name"] == "Alex’s account"
    assert redacted["institution"] is None and redacted["current_balance"] == 1000.0
    assert by_id[household["Joint"]]["redacted"] is False

    payees = {t["raw_payee"] for t in blair.get("/api/transactions").json()["items"]}
    assert payees == {"Joint payee"}
    for hidden in ("Alex Savings", "Alex Secret"):
        assert blair.get(f"/api/accounts/{household[hidden]}").status_code == 404
        assert blair.put(f"/api/accounts/{household[hidden]}", json={"name": "Mine now"}).status_code == 404


def test_household_totals_count_totals_only_accounts_but_not_private_ones(as_person, household):
    alex = as_person("alex-sub", "alex@example.com").get("/api/analytics/dashboard").json()
    blair = as_person("blair-sub", "blair@example.com").get("/api/analytics/dashboard").json()
    assert alex["current_net_worth"] == pytest.approx(51100.0)
    assert blair["current_net_worth"] == pytest.approx(1100.0)


def test_only_owners_change_who_sees_an_account(as_person, household):
    blair = as_person("blair-sub", "blair@example.com")
    res = blair.put(f"/api/accounts/{household['Joint']}", json={"visibility": "PRIVATE"})
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "not_account_owner"
    # Blair can still edit the joint account itself.
    assert blair.put(f"/api/accounts/{household['Joint']}", json={"name": "Joint chequing"}).status_code == 200


def test_hiding_an_account_needs_the_person_hiding_it_among_its_owners(as_person, household):
    alex = as_person("alex-sub", "alex@example.com")
    # A child's account cannot be hidden from everyone (the child has no sign-in).
    res = alex.post(
        "/api/accounts",
        json={"name": "Kid RESP", "type": "RESP", "owner_member_ids": [household["kid"]], "visibility": "PRIVATE"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "owner_required"
    res = alex.post(
        "/api/accounts",
        json={
            "name": "Kid RESP",
            "type": "RESP",
            "owner_member_ids": [household["kid"], household["alex"]],
            "visibility": "TOTALS",
        },
    )
    assert res.status_code == 201
    assert set(res.json()["owner_member_ids"]) == {household["kid"], household["alex"]}


def test_a_new_account_belongs_to_whoever_created_it(as_person, household):
    blair = as_person("blair-sub", "blair@example.com")
    res = blair.post("/api/accounts", json={"name": "Blair Visa", "type": "CREDIT_CARD"})
    assert res.status_code == 201
    assert res.json()["owner_member_ids"] == [household["blair"]]
    assert res.json()["visibility"] == "HOUSEHOLD"


def test_mine_filter_matches_any_owner(as_person, household):
    alex = as_person("alex-sub", "alex@example.com")
    alex.put(f"/api/accounts/{household['Joint']}", json={"owner_member_ids": [household["alex"], household["blair"]]})
    blair = as_person("blair-sub", "blair@example.com")
    mine = blair.get(f"/api/accounts?owner_member_id={household['blair']}").json()
    assert [a["name"] for a in mine] == ["Joint"]


def test_deleting_a_member_keeps_their_accounts(as_person, household, db_session):
    alex = as_person("alex-sub", "alex@example.com")
    joint_owned = alex.put(
        f"/api/accounts/{household['Joint']}", json={"owner_member_ids": [household["alex"], household["kid"]]}
    )
    assert joint_owned.status_code == 200
    assert alex.delete(f"/api/household/members/{household['kid']}").status_code == 204
    joint = alex.get(f"/api/accounts/{household['Joint']}").json()
    assert joint["owner_member_ids"] == [household["alex"]]


def test_an_archive_with_hidden_accounts_is_only_for_people_who_see_them(as_person, household, monkeypatch, tmp_path):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    alex = as_person("alex-sub", "alex@example.com")
    assert alex.post("/api/periods/2024/close").status_code == 200
    assert alex.get("/api/periods/2024/archive").status_code == 200
    res = as_person("blair-sub", "blair@example.com").get("/api/periods/2024/archive")
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "archive_has_hidden_accounts"
