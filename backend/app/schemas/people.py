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
