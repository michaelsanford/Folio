"""Per-user UI appearance preferences (theme, colour mode, number format...)."""
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime
from app.core.database import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"

    # "owner" for the master passphrase, "cognito:<sub>" for Cognito users
    # (see core.security.user_key_from_claims).
    user_key = Column(String(128), primary_key=True)
    # JSON object validated by schemas.preferences.UiPreferences.
    data = Column(Text, nullable=False)

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
