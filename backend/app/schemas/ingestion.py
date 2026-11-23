from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.core.config import settings
from app.models.account import AccountType


class CsvColumnMapping(BaseModel):
    date_column: str
    payee_column: str
    amount_column: str | None = None
    debit_column: str | None = None
    credit_column: str | None = None
    category_column: str | None = None
    notes_column: str | None = None
    account_type_column: str | None = None
    account_number_column: str | None = None
    date_format: str = "%Y-%m-%d"  # Or auto-detect
    has_header: bool = True
    delimiter: str = ","


class DetectedAccountPreview(BaseModel):
    source_account_key: str
    suggested_name: str
    suggested_type: AccountType
    institution: str | None = None
    account_number_mask: str | None = None
    currency: str = settings.DEFAULT_CURRENCY
    raw_account_type: str | None = None
    matched_account_id: str | None = None
    matched_account_name: str | None = None
    transaction_count: int = 0
    new_count: int = 0
    duplicates_count: int = 0


class ParsedTransactionItem(BaseModel):
    transaction_date: str  # ISO string YYYY-MM-DD
    raw_payee: str
    normalized_payee: str
    amount: float
    currency: str = settings.DEFAULT_CURRENCY
    suggested_category_id: str | None = None
    suggested_category_name: str | None = None
    suggested_category_color: str | None = None
    is_duplicate: bool = False
    import_hash: str
    notes: str | None = None
    source_account_key: str | None = None
    account_id: str | None = None
    account_label: str | None = None
    potential_transfer_account_id: str | None = None
    potential_transfer_account_name: str | None = None
    confidence_score: float = 1.0  # 1.0 for rule match, 0.5-0.9 for ML/heuristic
    classification_tier: str | None = None
    classification_reason: str | None = None


class IngestionPreviewResponse(BaseModel):
    file_id: str | None = None
    filename: str
    file_type: str  # "CSV", "PDF", "OFX"
    account_id: str | None = None
    is_multi_account: bool = False
    detected_accounts: list[DetectedAccountPreview] = Field(default_factory=list)
    total_parsed: int
    duplicates_count: int
    new_count: int
    items: list[ParsedTransactionItem]


class IngestionAccountResolution(BaseModel):
    source_account_key: str
    existing_account_id: str | None = None
    name: str | None = Field(None, min_length=1, max_length=100)
    type: AccountType = AccountType.CHECKING
    institution: str | None = Field(None, max_length=100)
    account_number_mask: str | None = Field(None, max_length=20)
    currency: str = Field(settings.DEFAULT_CURRENCY, min_length=3, max_length=3)


class IngestionCommitItem(BaseModel):
    transaction_date: str
    raw_payee: str
    normalized_payee: str
    amount: float
    currency: str | None = None
    category_id: str | None = None
    notes: str | None = None
    import_hash: str
    source_account_key: str | None = None
    account_id: str | None = None
    transfer_account_id: str | None = None


class IngestionCommitRequest(BaseModel):
    account_id: str | None = None
    statement_file_id: str | None = None
    accounts: list[IngestionAccountResolution] = Field(default_factory=list)
    auto_detect_transfers: bool = True
    items: list[IngestionCommitItem]


class CommittedAccountSummary(BaseModel):
    account_id: str
    account_name: str
    account_type: AccountType
    created: bool
    committed_count: int
    new_account_balance: float


class IngestionCommitResponse(BaseModel):
    committed_count: int
    account_id: str | None = None
    new_account_balance: float = 0.0
    accounts_created_count: int = 0
    accounts: list[CommittedAccountSummary] = Field(default_factory=list)
    transfers_linked_count: int = 0


class StatementFileResponse(BaseModel):
    id: str
    account_id: str | None = None
    filename: str
    mime_type: str
    file_size: int
    transaction_count: int
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)
