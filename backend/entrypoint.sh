#!/bin/sh
set -e

DB_DIR="/app/data"
DB_PATH="${SQLITE_DB_PATH:-/app/data/folio.db}"
CONFIG_PATH="/app/litestream.yml"

mkdir -p "$DB_DIR"

# If AWS S3 replication is configured
if [ -n "$S3_BUCKET_NAME" ] && [ -f "$CONFIG_PATH" ]; then
  echo "==> Checking for existing Litestream replica in S3 (${S3_BUCKET_NAME})..."
  litestream restore -if-replica-exists -config "$CONFIG_PATH" "$DB_PATH" || echo "No existing replica found; starting with fresh database."
  
  echo "==> Starting Litestream continuous replication in background..."
  litestream replicate -config "$CONFIG_PATH" &
fi

echo "==> Starting Folio FastAPI & PWA server on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
