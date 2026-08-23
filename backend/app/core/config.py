import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Folio"
    API_V1_STR: str = "/api"
    
    # Base directory
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    
    # SQLite Database
    SQLITE_DB_PATH: Path = BASE_DIR / "data" / "folio.db"
    
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        # Ensure data directory exists
        self.SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.SQLITE_DB_PATH.as_posix()}"

    # Document / statement upload directory
    UPLOAD_DIR: Path = BASE_DIR / "data" / "uploads"
    
    # AWS Litestream / S3 Backup configs
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "folio-storage-vault")
    AWS_REGION: str = os.getenv("AWS_DEFAULT_REGION", "ca-central-1")
    
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
