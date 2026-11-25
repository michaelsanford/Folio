"""Closed years: the books are locked through Dec 31 and a read-only archive is kept."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, Date, DateTime, Integer, String

from app.core.database import Base


class PeriodClosure(Base):
    __tablename__ = "period_closures"

    year = Column(Integer, primary_key=True, autoincrement=False)
    closed_through = Column(Date, nullable=False)
    closed_by = Column(String(128), nullable=True)
    closed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    # Where the archive copy lives: an S3 key on AWS, a file name under the
    # data directory's archives/ folder otherwise.
    archive_key = Column(String(255), nullable=True)
    archive_sha256 = Column(String(64), nullable=True)
    archive_bytes = Column(Integer, nullable=True)
    row_counts = Column(JSON, nullable=True)
    # Set when an owner reopens the year; the archive is kept.
    reopened_at = Column(DateTime, nullable=True)
    reopened_by = Column(String(128), nullable=True)

    @property
    def is_active(self) -> bool:
        return self.reopened_at is None
