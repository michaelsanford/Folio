# Folio

Folio is a self-hosted personal finance tracking, statement ingestion, and household budgeting application. Built with FastAPI, SQLite (WAL mode), and a React 19 + Vite + Tailwind CSS PWA, designed for native AWS SAM serverless deployment in `ca-central-1`.

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
- **Zero-Cost Serverless Cloud Architecture**:
  - AWS SAM model with Lambda Web Adapter and Function URL ($0.00/month baseline within AWS Free Tier).
  - Automatic S3 SQLite cold-start restore and write-snapshot synchronization.
  - Installable PWA with service worker caching for offline balance consultation on iOS and Android.

---

## Architecture

Folio uses a unified single-container deployment model. The React PWA is compiled in a multi-stage Docker build and served directly by FastAPI on port 8000, eliminating CORS issues and secondary CDN hosting requirements.

```mermaid
graph LR
    User[Client: Desktop / Mobile PWA] -->|HTTPS| FURL[Lambda Function URL<br/>Free HTTPS & Automated TLS]
    FURL --> LWA[AWS Lambda + Web Adapter<br/>FastAPI + Embedded React PWA<br/>ARM64 Graviton2]
    LWA <-->|Local /tmp SSD| DB[(SQLite WAL Engine)]
    DB <-->|Cold-Start Restore / Write-Sync| S3[(Amazon S3 Private Vault<br/>ca-central-1)]
```

---

## Quick Start (Local Development)

### 1. Prerequisites
- Python 3.13+
- Node.js 23+ and npm (or Node 22 LTS)

### 2. 1-Command Local Development
Launch both the FastAPI backend and Vite frontend with live hot-reloading:

```powershell
.\dev.ps1
```

This automatically initializes the virtual environment, installs requirements, launches the backend on `http://localhost:8000`, the frontend on `http://localhost:5173`, and opens your browser.

---

## Running Automated Tests

Run the complete 3-phase test suite (backend Pytest coverage + frontend Vitest component tests + production build verification) in 1 command:

```powershell
.\test.ps1
```

---

## Docker Compose Setup

Run the unified single-container build (FastAPI + embedded PWA + SQLite):

```powershell
docker compose -f infra/docker-compose.yml up --build
```

Access the application at `http://localhost:8000`.

---

## PyCharm / JetBrains IDE Setup

Pre-configured run configurations are included in `.idea/runConfigurations/`:
- **`Test: Full Suite (test.ps1)`**: Runs the complete 3-phase test suite (`test.ps1`).
- **`Test: Backend (Pytest)`**: Native Python test runner with graphical test tree and coverage reporting.
- **`Test: Frontend (Vitest)`**: Native NPM runner for frontend component and API tests.
- **`Dev: Local Stack (dev.ps1)`**: Launches the full local dev environment (`dev.ps1`).
- **`Docker: Local Container`**: Builds and boots the production container via `infra/docker-compose.yml`.
- **`Deploy: AWS SAM (deploy.ps1)`**: Deploys the serverless stack using AWS SAM.

---

## Security & Authentication

Folio features multi-layered security designed for public cloud deployment:

- **Master Passphrase Vault Lock**: Protected by bcrypt password hashing and signed `HttpOnly`, `SameSite=Strict`, `Secure` JWT session tokens.
- **Protected Endpoints**: All financial data routes require authenticated sessions.
- **Security Headers**: Automatic injection of `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, and `Referrer-Policy`.
- **WAF & Edge Protection**: Compatible with Cloudflare Free Tier (DDoS, WAF, and Zero Trust Access) or AWS WAF on CloudFront.

---

## AWS SAM Serverless Deployment (True $0.00/mo Baseline)

Folio includes a native AWS SAM model (`template.yaml` + `Dockerfile`) utilizing the **AWS Lambda Web Adapter** on ARM64 Graviton2 with direct **Lambda Function URLs**:

### 1-Command SAM Deployment
```powershell
.\infra\deploy.ps1 -Region ca-central-1 -StackName folio-prod
```

### How the SAM Architecture Works:
1. **Lambda Web Adapter**: Runs the standard FastAPI app and compiled React 19 PWA directly inside AWS Lambda without code modifications.
2. **Lambda Function URL**: Provides a direct public HTTPS endpoint with automated TLS and free CORS (bypassing API Gateway fees).
3. **Single-Writer SQLite Locking**: Configured with `ReservedConcurrentExecutions: 1` to guarantee database file consistency.
4. **Automated S3 Sync**: Pulls `folio.db` on cold-start and checkpoints snapshots back to the private S3 vault.
5. **Cost**: **$0.00/month** (100% within the AWS Lambda Always-Free Tier of 1M requests/month).

---

## License & Rights

All rights reserved (c) Michael Sanford.
