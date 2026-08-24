import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Folio"
    API_V1_STR: str = "/api"
    
    # Base directory
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    
    # SQLite Database
    SQLITE_DB_PATH: Path = Path(os.getenv("SQLITE_DB_PATH", str(BASE_DIR / "data" / "folio.db")))
    
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        # Ensure data directory exists
        self.SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.SQLITE_DB_PATH.as_posix()}"

    # Document / statement upload directory
    UPLOAD_DIR: Path = BASE_DIR / "data" / "uploads"
    
    # AWS S3 Backup & Persistence configs
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    AWS_REGION: str = os.getenv("AWS_DEFAULT_REGION", "ca-central-1")
    
    # Security & Authentication
    SECRET_KEY: str = os.getenv("FOLIO_SECRET_KEY", "folio-production-secret-key-salt-987654321")
    FOLIO_MASTER_PASSWORD: str = os.getenv("FOLIO_MASTER_PASSWORD", "")
    FOLIO_MASTER_PASSWORD_HASH: str = os.getenv("FOLIO_MASTER_PASSWORD_HASH", "")
    SESSION_EXPIRE_DAYS: int = 30
    JWT_ALGORITHM: str = "HS256"
    
    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:8000",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


settings = Settings()
