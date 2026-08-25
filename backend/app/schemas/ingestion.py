from datetime import datetime
from pydantic import BaseModel, ConfigDict


class CsvColumnMapping(BaseModel):
    date_column: str
    payee_column: str
    amount_column: str | None = None
    debit_column: str | None = None
    credit_column: str | None = None
    category_column: str | None = None
    notes_column: str | None = None
    date_format: str = "%Y-%m-%d"  # Or auto-detect
    has_header: bool = True
    delimiter: str = ","


class ParsedTransactionItem(BaseModel):
    transaction_date: str  # ISO string YYYY-MM-DD
    raw_payee: str
    normalized_payee: str
    amount: float
    currency: str = "USD"
    suggested_category_id: str | None = None
    suggested_category_name: str | None = None
    suggested_category_color: str | None = None
    is_duplicate: bool = False
    import_hash: str
    potential_transfer_account_id: str | None = None
    potential_transfer_account_name: str | None = None
    confidence_score: float = 1.0  # 1.0 for rule match, 0.5-0.9 for ML/heuristic


class IngestionPreviewResponse(BaseModel):
    file_id: str | None = None
    filename: str
    file_type: str  # "CSV", "PDF", "OFX"
    account_id: str
    total_parsed: int
    duplicates_count: int
    new_count: int
    items: list[ParsedTransactionItem]


class IngestionCommitItem(BaseModel):
    transaction_date: str
    raw_payee: str
    normalized_payee: str
    amount: float
    category_id: str | None = None
    notes: str | None = None
    import_hash: str
    transfer_account_id: str | None = None


class IngestionCommitRequest(BaseModel):
    account_id: str
    statement_file_id: str | None = None
    items: list[IngestionCommitItem]


class IngestionCommitResponse(BaseModel):
    committed_count: int
    account_id: str
    new_account_balance: float


class StatementFileResponse(BaseModel):
    id: str
    account_id: str
    filename: str
    mime_type: str
    file_size: int
    transaction_count: int
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)
