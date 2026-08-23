import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class StatementFile(Base):
    __tablename__ = "statement_files"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_hash = Column(String(64), nullable=False)  # SHA-256 of file content
    mime_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)
    transaction_count = Column(Integer, nullable=False, default=0)
    
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    account = relationship("Account", back_populates="statement_files")
    transactions = relationship("Transaction", back_populates="statement_file")
