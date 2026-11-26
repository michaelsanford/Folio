from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import settings
from app.models.account import AccountType
from app.models.investment import AssetClass


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
    # Dated in a closed year: the import skips it.
    in_closed_period: bool = False
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


class ParsedRowError(BaseModel):
    """A statement row that could not be imported, reported instead of guessed."""

    row_number: int | None = None  # 1-based position in the source (CSV line, OFX/PDF row)
    field: str
    value: str | None = None
    message: str


class HoldingsPositionPreview(BaseModel):
    """One position in a holdings export, compared with the account's current one."""

    symbol: str
    name: str | None = None
    asset_class: AssetClass = AssetClass.EQUITY
    currency: str = settings.DEFAULT_CURRENCY
    quantity: Decimal
    book_cost: float
    market_value: float
    last_price: float | None = None
    previous_close: float | None = None
    # NEW: not held yet. CHANGED: quantity or book cost differ (the lots are
    # replaced). UNCHANGED: left exactly as it is.
    status: Literal["NEW", "CHANGED", "UNCHANGED"] = "NEW"
    current_quantity: Decimal | None = None
    current_book_cost: float | None = None


class HoldingsCashLine(BaseModel):
    currency: str
    amount: float
    # The file's own exchange rate, and the conversion into the account's currency.
    rate_to_cad: float = 1.0
    rate_to_account: float = 1.0
    amount_in_account_currency: float = 0.0


class HoldingsMissingPosition(BaseModel):
    """Held in the account but absent from the file: removed only if the person asks."""

    holding_id: str
    symbol: str
    name: str | None = None
    quantity: Decimal
    market_value: float


class HoldingsComparison(BaseModel):
    """How the file's positions line up with one account's current holdings."""

    account_id: str | None = None
    account_currency: str = settings.DEFAULT_CURRENCY
    positions: list[HoldingsPositionPreview]
    cash: list[HoldingsCashLine] = Field(default_factory=list)
    cash_total: float = 0.0
    missing: list[HoldingsMissingPosition] = Field(default_factory=list)
    # What Folio will value the account at (prices are kept to the cent), and
    # the broker's own total for comparison.
    import_total: float = 0.0
    file_total: float | None = None


class HoldingsImportPreview(HoldingsComparison):
    account: DetectedAccountPreview
    as_of_date: date


class IngestionPreviewResponse(BaseModel):
    # HOLDINGS: a broker holdings export, described by ``holdings`` (``items``
    # is then empty).
    kind: Literal["TRANSACTIONS", "HOLDINGS"] = "TRANSACTIONS"
    holdings: HoldingsImportPreview | None = None
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
    # Rows skipped because a value (usually the date) could not be parsed. The
    # importer used to drop them silently or stamp them with today's date.
    row_errors: list[ParsedRowError] = Field(default_factory=list)


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
    category_name: str | None = None
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
    # Rows dated in a closed year, left out of the import.
    skipped_closed_count: int = 0


class StatementFileResponse(BaseModel):
    id: str
    account_id: str | None = None
    filename: str
    mime_type: str
    file_size: int
    transaction_count: int
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HoldingsCommitPosition(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=32)
    name: str | None = Field(None, max_length=200)
    asset_class: AssetClass = AssetClass.EQUITY
    currency: str = Field(settings.DEFAULT_CURRENCY, min_length=3, max_length=3)
    quantity: Decimal = Field(..., gt=0)
    book_cost: Decimal = Field(..., ge=0)
    last_price: Decimal | None = Field(None, ge=0)
    previous_close: Decimal | None = Field(None, ge=0)
    # The broker's figure, shown in the preview; Folio values the position itself.
    market_value: Decimal | None = None

    @field_validator("symbol", "currency")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.strip().upper()


class HoldingsCommitRequest(BaseModel):
    statement_file_id: str | None = None
    account: IngestionAccountResolution
    as_of_date: date
    positions: list[HoldingsCommitPosition] = Field(..., max_length=1000)
    # Uninvested cash in the account's currency.
    cash_total: Decimal = Decimal(0)
    remove_holding_ids: list[str] = Field(default_factory=list, max_length=1000)


class HoldingsCommitResponse(BaseModel):
    account_id: str
    account_name: str
    account_type: AccountType
    created: bool
    added_count: int
    updated_count: int
    unchanged_count: int
    removed_count: int
    cash_total: float
    new_account_balance: float


class HoldingsCompareRequest(BaseModel):
    """Compare a previewed file with another destination account.

    The preview's own positions and cash are sent back, because the uploaded
    file is not kept on the server.
    """

    account_id: str | None = None
    currency: str = Field(settings.DEFAULT_CURRENCY, min_length=3, max_length=3)
    positions: list[HoldingsCommitPosition] = Field(..., max_length=1000)
    cash: list[HoldingsCashLine] = Field(default_factory=list, max_length=20)
    file_total: float | None = None
