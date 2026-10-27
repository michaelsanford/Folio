from pydantic import BaseModel, Field
from app.services.categorization.engine import ClassificationTier


class ClassificationEvaluateRequest(BaseModel):
    raw_payee: str = Field(..., description="Raw payee string from transaction description")
    amount: float | None = Field(None, description="Transaction amount")
    account_id: str | None = Field(None, description="Optional account ID")
    account_type: str | None = Field(None, description="Optional account type (e.g. CHECKING, CREDIT_CARD, MORTGAGE)")
    enable_bedrock: bool = Field(False, description="Whether to allow Bedrock AI fallback recourse")
    min_confidence: float = Field(0.70, description="Minimum confidence threshold (0.0 to 1.0)")


class ClassificationEvaluateResponse(BaseModel):
    matched: bool
    category_id: str | None = None
    category_name: str | None = None
    category_color: str | None = None
    normalized_payee: str
    confidence: float
    tier: ClassificationTier
    reason: str
    rule_id: str | None = None


class BatchClassificationRequest(BaseModel):
    transactions: list[ClassificationEvaluateRequest]
    enable_bedrock: bool = Field(False, description="Whether to allow Bedrock AI fallback recourse")
    min_confidence: float = Field(0.70, description="Minimum confidence threshold (0.0 to 1.0)")


class BatchClassificationResponse(BaseModel):
    results: list[ClassificationEvaluateResponse]
    total: int
    matched_count: int
    tier_counts: dict[str, int]


class AutoClassifyUncategorizedRequest(BaseModel):
    threshold: float = Field(0.70, description="Minimum confidence threshold for auto-classification")
    enable_bedrock: bool = Field(False, description="Whether to allow Bedrock AI fallback recourse")
    account_id: str | None = Field(None, description="Optional account ID filter")
    dry_run: bool = Field(False, description="If true, returns results without committing changes to the database")


class AutoClassifyUncategorizedResponse(BaseModel):
    total_uncategorized: int
    classified_count: int
    tier_counts: dict[str, int]
    dry_run: bool = False


class ClassificationStatusResponse(BaseModel):
    bedrock_enabled: bool
    bedrock_model_id: str
    bedrock_region: str
    total_rules: int
    historical_learned_count: int
