from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models.transaction import TransactionStatus
from app.schemas.category import CategoryResponse


class TransactionSplitBase(BaseModel):
    category_id: str | None = None
    amount: float
    memo: str | None = None


class TransactionSplitCreate(TransactionSplitBase):
    pass


class TransactionSplitResponse(TransactionSplitBase):
    id: str
    transaction_id: str
    category: CategoryResponse | None = None

    model_config = ConfigDict(from_attributes=True)


class TransactionBase(BaseModel):
    account_id: str
    transaction_date: datetime
    posted_date: datetime | None = None
    raw_payee: str = Field(..., min_length=1, max_length=255)
    normalized_payee: str | None = None
    amount: float  # Negative for debit/expense, Positive for credit/income
    currency: str = "USD"
    status: TransactionStatus = TransactionStatus.CLEARED
    notes: str | None = None


class TransactionCreate(TransactionBase):
    splits: list[TransactionSplitCreate] | None = None
    transfer_transaction_id: str | None = None


class TransactionUpdate(BaseModel):
    account_id: str | None = None
    transaction_date: datetime | None = None
    posted_date: datetime | None = None
    raw_payee: str | None = None
    normalized_payee: str | None = None
    amount: float | None = None
    currency: str | None = None
    status: TransactionStatus | None = None
    notes: str | None = None
    transfer_transaction_id: str | None = None
    splits: list[TransactionSplitCreate] | None = None


class TransactionResponse(TransactionBase):
    id: str
    import_hash: str | None = None
    transfer_transaction_id: str | None = None
    statement_file_id: str | None = None
    created_at: datetime
    updated_at: datetime
    splits: list[TransactionSplitResponse] = []

    model_config = ConfigDict(from_attributes=True)


class TransactionListResponse(BaseModel):
    total: int
    items: list[TransactionResponse]
    page: int
    page_size: int


class BatchCategorizeRequest(BaseModel):
    transaction_ids: list[str]
    category_id: str
    normalized_payee: str | None = None
    create_rule: bool = False
    rule_pattern: str | None = None


class TransferLinkRequest(BaseModel):
    source_transaction_id: str
    target_transaction_id: str
