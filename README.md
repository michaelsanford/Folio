# Folio

Folio is a self-hosted personal finance tracking, statement ingestion, and household budgeting application. Built with FastAPI, SQLite (WAL mode), Litestream (continuous S3 replication), and a React 19 + Vite + Tailwind CSS PWA.

Designed for high-density desktop statement parsing and data entry with responsive mobile consultation (charts, budget meters, net worth progression).

---

## Features

- **Multi-Format Statement Ingestion**:
  - **CSV**: Auto-detects delimiters and column headers (Date, Payee, Amount, Debit/Credit, Memo).
  - **PDF Statements**: Extracts tabular transactions and text patterns from Chase, Amex, Bank of America, and credit unions via `pdfplumber`.
  - **OFX / QFX / QBO**: Ingests direct bank export formats via `ofxtools`.
- **Zero-Duplicate Import Engine**: Deterministic SHA-256 fingerprinting per transaction (`account_id` + `date` + `amount` + `payee`) flags and filters out duplicate rows across overlapping statement imports.
- **Auto-Categorization & Merchant Normalization**:
  - Cleans raw bank payee descriptions (e.g. `POS DEBIT CHASE *SQ BLUE BOTTLE #12` -> `Blue Bottle Coffee`).
  - Evaluates configurable priority rules (`CONTAINS`, `EXACT`, `STARTS_WITH`, `REGEX`) with interactive sandbox testing.
  - Automatically identifies inter-account transfers (Checking <-> Credit Card / Loans) within rolling time windows.
- **Loan & Mortgage Intelligence**:
  - Full month-by-month loan amortization schedules for 15/30-year Mortgages and Vehicle Loans.
  - Computes remaining interest, payoff date projections, and automated Principal vs. Interest vs. Escrow payment splits.
- **Envelope Budgeting & Analytics**:
  - Category target progress meters with live spend tracking and overspend warnings.
  - Interactive Sankey Flow Chart visualizing cash flow from Income into Category expenditures and Net Savings.
  - 6-Month Net Worth timeline (Assets vs. Liabilities).
- **Resilient Cloud & Disaster Recovery**:
  - SQLite in WAL mode with Litestream continuously streaming SQLite WAL transactions to AWS S3 in real-time.
  - Installable PWA with service worker caching for offline balance consultation on iOS and Android.

---

## Architecture

Folio uses a unified single-container deployment model. The React PWA is compiled in a multi-stage Docker build and served directly by FastAPI on port 8000, eliminating CORS issues and secondary CDN hosting requirements.

```mermaid
graph LR
    User[Client: Desktop / Mobile PWA] -->|HTTPS| AR[AWS App Runner<br/>Single Container: FastAPI + Embedded React PWA]
    AR <-->|Local NVMe/SSD| DB[(SQLite WAL Engine)]
    DB -->|Litestream Real-Time Stream| S3[(AWS S3 Bucket<br/>ca-central-1)]
```

---

## Quick Start (Local Development)

### 1. Prerequisites
- Python 3.13+
- Node.js 23+ and npm (or Node 22 LTS)

### 2. 1-Command Local Development
Launch both the FastAPI backend and Vite frontend with live hot-reloading:

**Windows (PowerShell):**
```powershell
.\dev.ps1
```

**macOS / Linux (Bash):**
```bash
./dev.sh
```

This automatically initializes the environment, launches the backend on `http://localhost:8000`, the frontend on `http://localhost:5173`, and opens your browser.

---

## Running Automated Tests

Run the complete test suite (backend Pytest coverage + frontend TypeScript build check) in 1 command:

**Windows (PowerShell):**
```powershell
.\test.ps1
```

**macOS / Linux (Bash):**
```bash
./test.sh
```

---

## Docker Compose Setup

Run the unified single-container build (FastAPI + embedded PWA + SQLite + Litestream):

```bash
docker compose -f infra/docker-compose.yml up --build
```

Access the application at `http://localhost:8000`.

---

## PyCharm / JetBrains IDE Setup

Pre-configured run configurations are included in `.idea/runConfigurations/`:
- **Full Stack (Backend + Frontend)**: Launches both the FastAPI server and Vite dev server concurrently.
- **FastAPI Backend**: Runs `uvicorn app.main:app --reload --port 8000` with hot-reload.
- **Vite Frontend (Dev)**: Runs `npm run dev`.
- **Pytest (Backend)**: Runs the Pytest test suite with graphical test tree.
- **docker-compose up**: Starts the unified stack inside Docker with `--build`.

---

## Automated AWS Cloud Deployment (CloudFormation + App Runner)

Folio includes Infrastructure-as-Code in `infra/cloudformation.yml` and automated deployment scripts that provision the S3 replication vault, ECR repository, IAM roles, and AWS App Runner service in `ca-central-1`.

### 1-Command Deployment (PowerShell / Windows)
```powershell
.\infra\deploy.ps1 -Region ca-central-1 -StackName folio-prod
```

### 1-Command Deployment (Bash / Linux / macOS)
```bash
./infra/deploy.sh ca-central-1 folio-prod
```

### What the Automation Does:
1. Provisions the private S3 Litestream Vault (`folio-vault-<account-id>-ca-central-1`) with 30-day WAL lifecycle retention.
2. Creates the Amazon ECR container repository with image retention policies.
3. Configures fine-grained IAM Instance Roles (App Runner assumes IAM credentials directly, eliminating hardcoded secrets).
4. Builds the unified multi-stage container and pushes it to ECR.
5. Deploys the AWS App Runner service with health checks on `/api/health`, automated HTTPS, and auto-pause when idle.
6. Returns the live public HTTPS URL.

---

## License & Rights

All rights reserved (c) Michael Sanford.
