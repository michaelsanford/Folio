#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-ca-central-1}"
STACK_NAME="${2:-folio-prod}"
ENVIRONMENT="${3:-prod}"

echo "=========================================="
echo "Folio - Automated AWS Cloud Deployment"
echo "Region: ${REGION} | Stack: ${STACK_NAME}"
echo "=========================================="

# 1. Verify Prerequisites
echo "[1/5] Verifying AWS CLI & Docker prerequisites..."
command -v aws >/dev/null 2>&1 || { echo "Error: AWS CLI is not installed." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is not installed." >&2; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text | tr -d '[:space:]')
echo "Authenticated as AWS Account: ${ACCOUNT_ID} in ${REGION}"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/folio"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 2. Ensure ECR Repository Exists
echo "[2/5] Ensuring ECR Repository exists..."
if ! aws ecr describe-repositories --repository-names folio --region "${REGION}" >/dev/null 2>&1; then
    echo "Creating initial ECR repository 'folio'..."
    aws ecr create-repository --repository-name folio --region "${REGION}" >/dev/null
fi

# 3. Build & Push Multi-stage Container Image
echo "[3/5] Building unified Folio container image..."
docker build -t folio:latest -f "${ROOT_DIR}/Dockerfile" "${ROOT_DIR}"

echo "Authenticating Docker with Amazon ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "Tagging and pushing image to ${ECR_URI}:latest..."
docker tag folio:latest "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
echo "Image successfully pushed to ECR."

# 4. Deploy Infrastructure as Code via CloudFormation
echo "[4/5] Deploying CloudFormation Stack (${STACK_NAME})..."
aws cloudformation deploy \
    --template-file "${SCRIPT_DIR}/cloudformation.yml" \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides EnvironmentName="${ENVIRONMENT}" \
    --no-fail-on-empty-changeset

# 5. Fetch Live URL and Status
echo "[5/5] Retrieving Live Deployment Outputs..."
SERVICE_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" \
    --output text)

VAULT_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='S3VaultBucket'].OutputValue" \
    --output text)

echo "========================================================"
echo "Folio Deployment Complete!"
echo "Live HTTPS Application URL: ${SERVICE_URL}"
echo "S3 Litestream Vault Bucket: ${VAULT_BUCKET}"
echo "========================================================"
