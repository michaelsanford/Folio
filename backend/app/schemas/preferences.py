"""UI appearance preferences stored per user (GET/PUT /me/preferences)."""
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_serializer, field_validator


class NumberFormatPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preset: Literal["en-CA", "fr-CA", "accounting", "custom"]
    negative_style: Literal["minus", "parentheses"]
    # " " (NO-BREAK SPACE) is the fr-CA "space" separator; ASCII " " is refused.
    group_separator: Literal[",", ".", " ", "'", ""]
    decimal_separator: Literal[".", ","]
    symbol_position: Literal["before", "after"]
    symbol_space: bool


class UiPreferences(BaseModel):
    """Every field is optional; an unset field means "use the app default"."""

    model_config = ConfigDict(extra="forbid")

    theme: Literal[
        "folio-emerald", "bloomberg", "editorial", "catppuccin",
        "nord", "gruvbox", "tokyo-night", "dracula",
    ] | None = None
    color_mode: Literal["light", "dark", "system"] | None = None
    type_style: Literal["broadsheet", "modern", "friendly", "terminal"] | None = None
    number_format: NumberFormatPreferences | None = None
    sidebar_collapsed: bool | None = None
    # Accounts left out of the dashboard. Stored as exclusions so a new account
    # shows up until the user hides it.
    dashboard_hidden_account_ids: list[Annotated[str, StringConstraints(max_length=64)]] | None = Field(
        None, max_length=100
    )


class PreferencesResponse(BaseModel):
    preferences: UiPreferences
    updated_at: datetime | None = None

    @field_validator("updated_at")
    @classmethod
    def _assume_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite drops the offset; stored values are always UTC.
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @field_serializer("preferences")
    def _omit_unset(self, value: UiPreferences) -> dict[str, Any]:
        # Unset fields are absent, but updated_at stays (null when never saved).
        return value.model_dump(mode="json", exclude_none=True)
