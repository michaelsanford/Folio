# Stage 1: Build Frontend React 19 PWA (static assets; build natively on host)
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend Python Environment with uv
FROM python:3.14-slim AS backend-builder
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /bin/uv

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON_PREFERENCE=only-system

# Runtime dependencies only; the dev dependency group (pytest) is excluded.
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project --no-cache

# Stage 3: Unified Execution Environment (Docker Compose / AWS Lambda Web Adapter)
FROM python:3.14-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000 \
    AWS_LWA_PORT=8000 \
    AWS_LWA_ASYNC_INIT=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /app/.venv /app/.venv
COPY backend/ .
# Copy compiled Frontend PWA into /app/static
COPY --from=frontend-builder /app/frontend/dist /app/static

# Create non-root user and group with proper permissions
RUN groupadd -g 1000 appuser && \
    useradd -u 1000 -g appuser -d /app -s /bin/bash appuser && \
    mkdir -p /app/data/uploads /tmp && \
    chown -R appuser:appuser /app /tmp

USER appuser

EXPOSE 8000

# Container health for Docker / Compose (Lambda ignores HEALTHCHECK and uses the
# Lambda Web Adapter readiness check on AWS_LWA_READINESS_CHECK_PATH instead).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# No Server header (don't advertise the stack) and no uvicorn access log: the app
# writes its own JSON access line per request (logger folio.access).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--no-access-log"]

