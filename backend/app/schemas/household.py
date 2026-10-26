from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class HouseholdMemberBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field("#10B981", max_length=20)
    avatar_icon: str = Field("user", max_length=50)
    role: str | None = Field("Member", max_length=50)
    notes: str | None = Field(None, max_length=255)


class HouseholdMemberCreate(HouseholdMemberBase):
    pass


class HouseholdMemberUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    avatar_icon: str | None = None
    role: str | None = None
    notes: str | None = None


class HouseholdMemberResponse(HouseholdMemberBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
