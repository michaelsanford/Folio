# Stage 1: Build Frontend React 19 PWA
FROM node:23-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Unified Execution Environment (Docker Compose / AWS Lambda Web Adapter)
FROM python:3.13-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    AWS_LWA_PORT=8000 \
    AWS_LWA_ASYNC_INIT=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install boto3 for native S3 synchronization in cloud serverless mode
RUN pip install --no-cache-dir boto3

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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

