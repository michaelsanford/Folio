#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"

echo "=========================================="
echo "Starting Folio Local Development Suite"
echo "=========================================="

# Check venv
if [ ! -d "${BACKEND_DIR}/.venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "${BACKEND_DIR}/.venv"
    "${BACKEND_DIR}/.venv/bin/pip" install -r "${BACKEND_DIR}/requirements.txt"
fi

# Check node_modules
if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd "${FRONTEND_DIR}" && npm install)
fi

# Trap to kill child processes on exit
cleanup() {
    echo -e "\nStopping backend and frontend services..."
    kill 0
}
trap cleanup EXIT INT TERM

# Start Backend
echo "[1/2] Launching FastAPI Backend on http://localhost:8000..."
(cd "${BACKEND_DIR}" && "${BACKEND_DIR}/.venv/bin/python" -m uvicorn app.main:app --reload --port 8000) &

# Start Frontend
echo "[2/2] Launching Vite Frontend on http://localhost:5173..."
(cd "${FRONTEND_DIR}" && npm run dev) &

wait
