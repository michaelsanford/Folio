#!/bin/sh
set -e

DB_DIR="/app/data"
DB_PATH="${SQLITE_DB_PATH:-/app/data/folio.db}"
CONFIG_PATH="/app/litestream.yml"

mkdir -p "$DB_DIR"

# Check if AWS credentials (static keys or IAM container role) are present
HAS_AWS_AUTH=""
if [ -n "$AWS_ACCESS_KEY_ID" ] || [ -n "$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI" ] || [ -n "$AWS_CONTAINER_CREDENTIALS_FULL_URI" ] || [ -n "$AWS_WEB_IDENTITY_TOKEN_FILE" ]; then
  HAS_AWS_AUTH="true"
fi

if [ -n "$S3_BUCKET_NAME" ] && [ -n "$HAS_AWS_AUTH" ] && [ -f "$CONFIG_PATH" ]; then
  echo "==> AWS credentials detected. Checking for Litestream replica in S3 (${S3_BUCKET_NAME})..."
  litestream restore -if-replica-exists -config "$CONFIG_PATH" "$DB_PATH" || echo "No existing replica found; starting with fresh database."
  
  echo "==> Starting Litestream continuous S3 replication in background..."
  litestream replicate -config "$CONFIG_PATH" &
else
  echo "==> Local mode: Remote S3 replication disabled. Running SQLite locally on ${DB_PATH}."
fi

echo "==> Starting Folio FastAPI & PWA server on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
