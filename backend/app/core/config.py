import os
from pathlib import Path

# Placeholder for local development only. Startup refuses to run with this value
# in production, because a known signing key means forgeable session tokens.
DEFAULT_INSECURE_SECRET_KEY = "dev-insecure-secret-key-change-in-production-1234567890"
# `or` rather than a getenv default: an env var present but empty (a common
# docker-compose pattern) must not leave the signing key blank.
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

    # Environment & Mode
    ENVIRONMENT: str = os.getenv("FOLIO_ENV", "development")

    # Skip migration + seeding on app startup. Set by the test suite, which builds
    # its own in-memory schema and must not touch the developer database.
    SKIP_STARTUP_TASKS: bool = os.getenv("FOLIO_SKIP_STARTUP_TASKS", "").lower() in ("1", "true", "yes")
    
    # Document / statement upload directory & limits.
    # Overridable because Lambda's filesystem is read-only outside /tmp -- without
    # this, statement upload fails in the serverless deployment.
    UPLOAD_DIR: Path = Path(os.getenv("FOLIO_UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
    MAX_UPLOAD_SIZE_BYTES: int = 25 * 1024 * 1024  # 25 MB max statement size
    
    # AWS S3 Backup & Persistence configs
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    AWS_REGION: str = os.getenv("AWS_DEFAULT_REGION", "ca-central-1")
    
    # Security & Local Vault Authentication
    SECRET_KEY: str = os.getenv("FOLIO_SECRET_KEY") or DEFAULT_INSECURE_SECRET_KEY
    FOLIO_MASTER_PASSWORD: str = os.getenv("FOLIO_MASTER_PASSWORD", "")
    FOLIO_MASTER_PASSWORD_HASH: str = os.getenv("FOLIO_MASTER_PASSWORD_HASH", "")
    SESSION_EXPIRE_DAYS: int = 30
    JWT_ALGORITHM: str = "HS256"
    
    # AWS Cognito Zero-Trust Identity
    COGNITO_USER_POOL_ID: str = os.getenv("COGNITO_USER_POOL_ID", "")
    COGNITO_CLIENT_ID: str = os.getenv("COGNITO_CLIENT_ID", "")
    COGNITO_REGION: str = os.getenv("COGNITO_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    
    @property
    def is_cognito_enabled(self) -> bool:
        return bool(self.COGNITO_USER_POOL_ID and self.COGNITO_CLIENT_ID)

    @property
    def cognito_issuer(self) -> str:
        return f"https://cognito-idp.{self.COGNITO_REGION}.amazonaws.com/{self.COGNITO_USER_POOL_ID}"

    @property
    def cognito_jwks_url(self) -> str:
        return f"{self.cognito_issuer}/.well-known/jwks.json"

    # Edge Origin Verification (CloudFront / WAF secret header)
    FOLIO_ORIGIN_VERIFY_SECRET: str = os.getenv("FOLIO_ORIGIN_VERIFY_SECRET", "")
    
    # CORS Origins (parsed from comma-separated env or defaults for local dev)
    @property
    def CORS_ORIGINS(self) -> list[str]:
        raw_origins = os.getenv("FOLIO_CORS_ORIGINS", "")
        if raw_origins:
            return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://localhost:8000",
        ]

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


settings = Settings()


def validate_production_settings(current: Settings = settings) -> list[str]:
    """Configuration that is merely unwise in development but unsafe in production.

    Returned as a list so the caller can report every problem at once rather than
    making the operator fix them one restart at a time.
    """
    if not current.is_production:
        return []

    problems: list[str] = []

    if current.SECRET_KEY == DEFAULT_INSECURE_SECRET_KEY:
        problems.append(
            "FOLIO_SECRET_KEY is still the built-in development value. Anyone who has "
            "read the source can forge a session token. Set it to a random secret."
        )

    if current.FOLIO_MASTER_PASSWORD and not current.FOLIO_MASTER_PASSWORD_HASH:
        problems.append(
            "FOLIO_MASTER_PASSWORD stores the passphrase in plain text (and it is "
            "visible to anyone who can read the process environment). Set "
            "FOLIO_MASTER_PASSWORD_HASH to a bcrypt hash instead."
        )

    return problems

