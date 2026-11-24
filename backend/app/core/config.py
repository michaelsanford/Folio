import os
import secrets
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
SECRET_KEY_FILENAME = ".folio_secret_key"
MASTER_HASH_FILENAME = ".folio_master_hash"
DEFAULT_MAX_UPLOAD_MB = 25

_generated_key: str | None = None


def _load_or_create_key(key_file: Path) -> str:
    """Read the persisted signing key, creating it with fresh randomness if absent.

    O_EXCL makes creation atomic, so concurrent workers starting together all end
    up reading the same key. If the directory is not writable, an in-memory key is
    still unpredictable; sessions just won't survive a restart.
    """
    try:
        existing = key_file.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except OSError:
        pass

    key = secrets.token_hex(32)
    try:
        key_file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(key)
    except FileExistsError:
        try:
            return key_file.read_text(encoding="utf-8").strip() or key
        except OSError:
            return key
    except OSError:
        pass
    return key


def generated_secret_key(key_file: Path | None = None) -> str:
    """The session signing key used when FOLIO_SECRET_KEY is unset.

    Random per installation and persisted next to the database, so a dev session
    survives uvicorn reloads and container restarts. It is never derived from
    anything in the source or the image: a key every reader of the repository
    can compute (e.g. from the fixed /app path in the container) lets anyone
    forge a session.

    Production refuses to start on it, because on Lambda each container would
    hold a different key; see validate_production_settings.
    """
    global _generated_key
    if _generated_key is None:
        _generated_key = _load_or_create_key(key_file or _DEFAULT_DATA_DIR / SECRET_KEY_FILENAME)
    return _generated_key


def is_lambda_runtime() -> bool:
    """True when running inside AWS Lambda (the runtime always sets this variable).

    Lambda freezes the execution environment as soon as a response is returned,
    so background timers cannot be relied on there: writes are flushed to S3
    synchronously before responding instead of being debounced.
    """
    return bool(os.getenv("AWS_LAMBDA_FUNCTION_NAME"))


def _max_upload_mb() -> int:
    raw = os.getenv("FOLIO_MAX_UPLOAD_MB", "")
    try:
        value = int(raw) if raw.strip() else DEFAULT_MAX_UPLOAD_MB
    except ValueError:
        value = DEFAULT_MAX_UPLOAD_MB
    return value if value > 0 else DEFAULT_MAX_UPLOAD_MB


def fetch_secret_string(secret_arn: str, region: str | None = None) -> str:
    """Read a Secrets Manager secret's SecretString, used verbatim.

    The template generates both secrets with GenerateSecretString and no
    template, so the value is a plain random string rather than JSON. Any
    failure propagates: starting with a missing signing or origin key would
    either break every session or silently disable edge verification.
    """
    import boto3

    # The region is part of the ARN (arn:aws:secretsmanager:<region>:...).
    parts = secret_arn.split(":")
    arn_region = parts[3] if len(parts) > 3 and parts[3] else None
    client = boto3.client(
        "secretsmanager",
        region_name=arn_region or region or os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1")),
    )
    value = client.get_secret_value(SecretId=secret_arn).get("SecretString") or ""
    if not value:
        raise RuntimeError(f"Secret {secret_arn} has no SecretString value")
    return value


def master_hash_file(db_path: Path) -> Path:
    """Where /api/auth/setup persists the master passphrase hash (next to the DB)."""
    return Path(db_path).parent / MASTER_HASH_FILENAME


def load_persisted_master_hash(hash_file: Path) -> str:
    try:
        value = hash_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return value if value.startswith(("$2a$", "$2b$", "$2y$")) else ""


def persist_master_hash(hash_file: Path, password_hash: str) -> bool:
    """Write the hash once with O_EXCL and mode 0600.

    Returns False when the file already exists, i.e. another worker completed
    setup first; the caller must then treat setup as already done.
    """
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(hash_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(password_hash)
    return True


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

    # Default currency for new accounts and transactions. Folio targets Canadian
    # households -- its merchant rules, bank parsers, and mortgage compounding all
    # assume CAD -- so a foreign-currency row is the exception, not the baseline.
    DEFAULT_CURRENCY: str = os.getenv("FOLIO_DEFAULT_CURRENCY", "CAD")

    # Skip migration + seeding on app startup. Set by the test suite, which builds
    # its own in-memory schema and must not touch the developer database.
    SKIP_STARTUP_TASKS: bool = os.getenv("FOLIO_SKIP_STARTUP_TASKS", "").lower() in ("1", "true", "yes")
    
    # Document / statement upload directory & limits.
    # Overridable because Lambda's filesystem is read-only outside /tmp -- without
    # this, statement upload fails in the serverless deployment.
    UPLOAD_DIR: Path = Path(os.getenv("FOLIO_UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
    # FOLIO_MAX_UPLOAD_MB (default 25). The SAM template sets 5 because a Lambda
    # Function URL rejects request payloads above 6 MB.
    MAX_UPLOAD_MB: int = _max_upload_mb()
    MAX_UPLOAD_SIZE_BYTES: int = _max_upload_mb() * 1024 * 1024
    
    # AWS S3 Backup & Persistence configs
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    AWS_REGION: str = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    
    # Security & Local Vault Authentication
    # `or` rather than a getenv default: an env var present but empty (a common
    # docker-compose pattern) must not leave the signing key blank.
    SECRET_KEY: str = os.getenv("FOLIO_SECRET_KEY") or generated_secret_key(
        SQLITE_DB_PATH.parent / SECRET_KEY_FILENAME
    )
    FOLIO_MASTER_PASSWORD: str = os.getenv("FOLIO_MASTER_PASSWORD", "")
    FOLIO_MASTER_PASSWORD_HASH: str = os.getenv("FOLIO_MASTER_PASSWORD_HASH", "")
    # Secrets Manager ARNs (Lambda). When set they take precedence over
    # FOLIO_SECRET_KEY / FOLIO_ORIGIN_VERIFY_SECRET, which still work for Docker.
    FOLIO_SESSION_SECRET_ARN: str = os.getenv("FOLIO_SESSION_SECRET_ARN", "")
    FOLIO_ORIGIN_SECRET_ARN: str = os.getenv("FOLIO_ORIGIN_SECRET_ARN", "")
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

    # AWS Bedrock LLM Recourse for Transaction Classification
    FOLIO_BEDROCK_ENABLED: bool = os.getenv("FOLIO_BEDROCK_ENABLED", "").lower() in ("1", "true", "yes")
    FOLIO_BEDROCK_MODEL_ID: str = os.getenv("FOLIO_BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")
    FOLIO_BEDROCK_REGION: str = os.getenv("FOLIO_BEDROCK_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    FOLIO_CLASSIFICATION_THRESHOLD: float = float(os.getenv("FOLIO_CLASSIFICATION_THRESHOLD", "0.75"))

    # Edge Origin Verification (CloudFront / WAF secret header)
    FOLIO_ORIGIN_VERIFY_SECRET: str = os.getenv("FOLIO_ORIGIN_VERIFY_SECRET", "")
    
    # CORS Origins (parsed from comma-separated env or defaults for local dev)
    @property
    def CORS_ORIGINS(self) -> list[str]:
        raw_origins = os.getenv("FOLIO_CORS_ORIGINS", "")
        if raw_origins:
            return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
        # The SPA is served from the same origin in production, so no cross-origin
        # caller needs credentials. Localhost defaults are for the Vite dev server.
        if self.is_production:
            return []
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

    @model_validator(mode="after")
    def _resolve_external_secrets(self) -> "Settings":
        if self.FOLIO_SESSION_SECRET_ARN:
            self.SECRET_KEY = fetch_secret_string(self.FOLIO_SESSION_SECRET_ARN, self.AWS_REGION)
        if self.FOLIO_ORIGIN_SECRET_ARN:
            self.FOLIO_ORIGIN_VERIFY_SECRET = fetch_secret_string(self.FOLIO_ORIGIN_SECRET_ARN, self.AWS_REGION)
        # A passphrase set through /api/auth/setup survives restarts.
        if not self.FOLIO_MASTER_PASSWORD_HASH and not self.FOLIO_MASTER_PASSWORD:
            self.FOLIO_MASTER_PASSWORD_HASH = load_persisted_master_hash(
                master_hash_file(self.SQLITE_DB_PATH)
            )
        return self

    @property
    def is_lambda(self) -> bool:
        return is_lambda_runtime()


    @property
    def is_production(self) -> bool:
        # "prod" is the SAM/deploy.ps1 default EnvironmentName; matching only
        # "production" silently skipped every production guard on AWS.
        return self.ENVIRONMENT.lower() in ("production", "prod")


settings = Settings()


def validate_production_settings(current: Settings = settings) -> list[str]:
    """Configuration that is merely unwise in development but unsafe in production.

    Returned as a list so the caller can report every problem at once rather than
    making the operator fix them one restart at a time.
    """
    if not current.is_production:
        return []

    problems: list[str] = []

    if (
        not current.is_cognito_enabled
        or current.FOLIO_MASTER_PASSWORD
        or current.FOLIO_MASTER_PASSWORD_HASH
    ) and current.SECRET_KEY == _generated_key:
        problems.append(
            "FOLIO_SECRET_KEY is unset, so sessions are signed with a key generated "
            "on this host, which is not shared across instances. Set it to a random secret."
        )

    if current.FOLIO_MASTER_PASSWORD and not current.FOLIO_MASTER_PASSWORD_HASH:
        problems.append(
            "FOLIO_MASTER_PASSWORD stores the passphrase in plain text (and it is "
            "visible to anyone who can read the process environment). Set "
            "FOLIO_MASTER_PASSWORD_HASH to a bcrypt hash instead."
        )

    return problems
