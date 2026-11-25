"""People who can sign in to the household vault, and what each may do."""
import enum
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.orm import relationship

from app.core.database import Base


class AppRole(str, enum.Enum):
    OWNER = "OWNER"  # everything, including people and destructive maintenance
    MEMBER = "MEMBER"  # read and change the ledger
    VIEWER = "VIEWER"  # read only


class AppUserStatus(str, enum.Enum):
    INVITED = "INVITED"  # invitation sent, never signed in
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"  # sign-in blocked; kept so attribution keeps a name


class AppUser(Base):
    __tablename__ = "app_users"

    # Same key as user_key_from_claims: "cognito:<sub>". An invitation already
    # knows the sub, so invited people have their final key from the start.
    user_key = Column(String(128), primary_key=True)
    email = Column(String(254), nullable=True, index=True)
    display_name = Column(String(100), nullable=True)
    role = Column(String(16), nullable=False, default=AppRole.MEMBER.value)
    status = Column(String(16), nullable=False, default=AppUserStatus.ACTIVE.value)
    member_id = Column(
        String(36), ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    invited_by = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_sign_in_at = Column(DateTime, nullable=True)

    member = relationship("HouseholdMember")

    @property
    def label(self) -> str:
        """Name shown in attribution: the linked member, else the name or email."""
        if self.member is not None:
            return self.member.name
        return self.display_name or self.email or "Household member"
