#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"

echo "=========================================="
echo "Running Folio Full Test Suite"
echo "=========================================="

echo -e "\n[1/2] Running Backend Pytest Suite (Coverage & Unit Tests)..."
(cd "${BACKEND_DIR}" && "${BACKEND_DIR}/.venv/bin/pytest" tests --cov=app --cov-report=term-missing)

echo -e "\n[2/2] Running Frontend Typecheck & Build..."
(cd "${FRONTEND_DIR}" && npm run build)

echo "=========================================="
echo "All Folio Tests & Builds Passed!"
echo "=========================================="
