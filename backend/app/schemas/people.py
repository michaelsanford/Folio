from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["OWNER", "MEMBER", "VIEWER"]
PersonStatus = Literal["INVITED", "ACTIVE", "DISABLED"]


class MeResponse(BaseModel):
    """The signed-in person, as the app needs it on load."""

    user_key: str
    email: str | None = None
    display_name: str | None = None
    role: Role
    member_id: str | None = None
    can_edit: bool
    is_owner: bool
    # False in passphrase mode: there is nobody else to invite.
    can_manage_people: bool
    # No name and no household member yet: the app asks once who they are.
    needs_welcome: bool = False
    # Several people sign in (accounts can be hidden from each other); False
    # with a single passphrase.
    shared_household: bool = False


class PersonResponse(BaseModel):
    user_key: str
    email: str | None = None
    display_name: str | None = None
    role: Role
    status: PersonStatus
    member_id: str | None = None
    member_name: str | None = None
    invited_by_name: str | None = None
    created_at: datetime
    last_sign_in_at: datetime | None = None
    is_me: bool = False

    model_config = ConfigDict(from_attributes=True)


class PeopleListResponse(BaseModel):
    people: list[PersonResponse]
    can_manage_people: bool


class PersonInvite(BaseModel):
    email: str = Field(..., min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["MEMBER", "VIEWER", "OWNER"] = "MEMBER"
    display_name: str | None = Field(None, max_length=100)
    member_id: str | None = Field(None, max_length=36)

    @field_validator("email")
    @classmethod
    def _normalize(cls, value: str) -> str:
        return value.strip().lower()


Relationship = Literal["Self", "Partner", "Dependent", "Roommate", "Other"]


class PersonAdd(BaseModel):
    """Add someone to the household in one step: a member, and optionally a sign-in."""

    name: str = Field(..., min_length=1, max_length=100)
    relationship: Relationship = "Other"
    color: str | None = Field(None, max_length=20)
    # "invite": email them an invitation with ``role``; "none": bookkeeping only.
    access: Literal["invite", "none"] = "none"
    email: str | None = Field(None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["MEMBER", "VIEWER", "OWNER"] | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A name is required")
        return value

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else None


class PersonAddResponse(BaseModel):
    member_id: str
    member_name: str
    # The new sign-in, when they were invited.
    person: "PersonResponse | None" = None


class WelcomeRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    relationship: Relationship | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A name is required")
        return value


class PersonUpdate(BaseModel):
    role: Role | None = None
    status: Literal["ACTIVE", "DISABLED"] | None = None
    display_name: str | None = Field(None, max_length=100)
    # Send null to unlink; leave out to keep.
    member_id: str | None = Field(None, max_length=36)


class MeUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    member_id: str | None = Field(None, max_length=36)


class PersonSummary(BaseModel):
    """Enough to put a name on ``created_by`` / ``updated_by``."""

    user_key: str
    name: str
    member_id: str | None = None
