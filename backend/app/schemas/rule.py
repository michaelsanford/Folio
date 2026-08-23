from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models.rule import RulePatternType
from app.schemas.category import CategoryResponse


class CategorizationRuleBase(BaseModel):
    category_id: str
    priority: int = 10
    pattern_type: RulePatternType = RulePatternType.CONTAINS
    pattern: str = Field(..., min_length=1, max_length=255)
    min_amount: float | None = None
    max_amount: float | None = None
    target_account_id: str | None = None
    normalized_payee_override: str | None = None
    is_active: bool = True


class CategorizationRuleCreate(CategorizationRuleBase):
    pass


class CategorizationRuleUpdate(BaseModel):
    category_id: str | None = None
    priority: int | None = None
    pattern_type: RulePatternType | None = None
    pattern: str | None = None
    min_amount: float | None = None
    max_amount: float | None = None
    target_account_id: str | None = None
    normalized_payee_override: str | None = None
    is_active: bool | None = None


class CategorizationRuleResponse(CategorizationRuleBase):
    id: str
    created_at: datetime
    updated_at: datetime
    category: CategoryResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class TestRuleMatchRequest(BaseModel):
    raw_payee: str
    amount: float
    account_id: str | None = None


class TestRuleMatchResponse(BaseModel):
    matched: bool
    matched_rule: CategorizationRuleResponse | None = None
    suggested_category_id: str | None = None
    suggested_payee: str | None = None
