#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-ca-central-1}"
STACK_NAME="${2:-folio-prod}"
ENVIRONMENT="${3:-prod}"
MASTER_PASSWORD="${4:-}"

echo "=========================================="
echo "Folio - AWS SAM Serverless Deployment"
echo "Region: ${REGION} | Stack: ${STACK_NAME}"
echo "=========================================="

command -v sam >/dev/null 2>&1 || { echo "Error: AWS SAM CLI is not installed." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is not running." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

echo "[1/3] Building Serverless Application (SAM)..."
sam build -t template.yaml

echo "[2/3] Deploying SAM Stack (${STACK_NAME})..."
PARAM_OVERRIDES="EnvironmentName=${ENVIRONMENT}"
if [ -n "${MASTER_PASSWORD}" ]; then
    PARAM_OVERRIDES="${PARAM_OVERRIDES} MasterPassword=${MASTER_PASSWORD}"
fi

sam deploy \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --resolve-s3 \
    --resolve-image-repos \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides ${PARAM_OVERRIDES} \
    --no-fail-on-empty-changeset

echo "[3/3] Retrieving Live Serverless Endpoint..."
APP_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='FolioAppUrl'].OutputValue" \
    --output text)

VAULT_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='S3VaultBucket'].OutputValue" \
    --output text)

echo "========================================================"
echo "Folio Serverless SAM Deployment Complete!"
echo "Live HTTPS Application URL: ${APP_URL}"
echo "S3 Storage Vault Bucket:    ${VAULT_BUCKET}"
echo "========================================================"
