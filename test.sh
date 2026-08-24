#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "Running Folio Full Test Suite"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"

# 1. Backend Pytest Suite
echo ""
echo "[1/3] Running Backend Pytest Suite (Coverage & Integration Tests)..."
cd "${BACKEND_DIR}"
source .venv/bin/activate || source .venv/Scripts/activate
pytest tests --cov=app --cov-report=term-missing

# 2. Frontend Vitest Suite
echo ""
echo "[2/3] Running Frontend Vitest Suite (Component & Auth Unit Tests)..."
cd "${FRONTEND_DIR}"
npm run test

# 3. Frontend TypeScript & Production Build Verification
echo ""
echo "[3/3] Running Frontend Typecheck & Production Build..."
cd "${FRONTEND_DIR}"
npm run build

echo ""
echo "=========================================="
echo "All Folio Tests & Builds Passed!"
echo "=========================================="
