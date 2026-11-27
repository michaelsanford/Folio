<p><img src="frontend/public/folio-icon.svg" alt="" width="72" height="72"></p>

# Folio

Folio is a self-hosted personal finance tracking, statement ingestion, and household budgeting application. Built with **FastAPI**, **PostgreSQL**, and a **React 19 + Vite + Tailwind CSS PWA**, it is engineered for high performance on desktop and mobile, with an optional low-cost AWS SAM serverless deployment (CloudFront + Lambda + Aurora DSQL) in `ca-central-1`.

Folio combines high-density desktop statement parsing and data entry with responsive mobile consultation (charts, budget meters, net worth progression), tailored for Canadian and North American households.

---

## Table of Contents

- [Core Capabilities](#core-capabilities)
  - [1. Multi-Tier Auto-Classification Engine](#1-multi-tier-auto-classification-engine)
  - [2. Canadian Personal Finance & Household Collaboration](#2-canadian-personal-finance--household-collaboration)
  - [3. Dedicated Goals & CRA Contribution Tracking](#3-dedicated-goals--cra-contribution-tracking)
  - [4. Envelope Budgeting & Cash Flow Trajectory Forecasting](#4-envelope-budgeting--cash-flow-trajectory-forecasting)
  - [5. Multi-Format Statement Ingestion & Deduplication](#5-multi-format-statement-ingestion--deduplication)
  - [6. Investment Performance & Portfolio Analytics](#6-investment-performance--portfolio-analytics)
  - [7. Exact Minor-Unit Money Architecture](#7-exact-minor-unit-money-architecture)
  - [8. Interactive Ledger & Transfer Pairing](#8-interactive-ledger--transfer-pairing)
  - [9. Built-in Canadian Demo Dataset](#9-built-in-canadian-demo-dataset)
- [Architecture](#architecture)
  - [Performance Notes](#performance-notes)
  - [Installing the App & Updates](#installing-the-app--updates)
- [Quick Start (Local Development)](#quick-start-local-development)
  - [Prerequisites](#prerequisites)
  - [1-Command Local Launcher](#1-command-local-launcher)
  - [First Run: Master Passphrase Vault](#first-run-master-passphrase-vault)
  - [Database Migrations & Maintenance](#database-migrations--maintenance)
- [Running Automated Tests](#running-automated-tests)
- [CI/CD & Automated Security](#cicd--automated-security)
- [Docker Compose Setup](#docker-compose-setup)
- [Security & Zero-Trust Architecture](#security--zero-trust-architecture)
- [Data Handling](#data-handling)
- [Limits](#limits)
- [AWS SAM Serverless Deployment](#aws-sam-serverless-deployment)
  - [Deploying](#deploying)
  - [Saved Settings (samconfig.toml)](#saved-settings-samconfigtoml)
  - [First-Time Sign-In & Managing Users (Invite-Only Cognito)](#first-time-sign-in--managing-users-invite-only-cognito)
  - [Serverless Architecture Highlights](#serverless-architecture-highlights)
  - [Observability & Alarms](#observability--alarms)
  - [Costs](#costs)
  - [Tearing Down](#tearing-down)
- [Backups & Restore](#backups--restore)
- [Rolling Back a Deploy](#rolling-back-a-deploy)
- [Configuration Reference](#configuration-reference)
- [License](#license)

---

## Core Capabilities

### 1. Multi-Tier Auto-Classification Engine

Folio features an offline-first, 4-tier cascading auto-classification engine that automatically categorizes incoming transactions, learns from historical user choices, and optionally recurses to cloud AI for ambiguous merchants.

```mermaid
flowchart TD
    TXN["Incoming Transaction\n(Payee, Amount, Notes, Date)"] --> T1{"Tier 1:\nDeterministic Rules Engine\n(Exact / Starts-With / Contains / Regex)"}
    T1 -- Match --> RES1["Classified (Tier 1)\nConfidence: 1.0 (100%)\nStatus: Auto-Assigned"]
    T1 -- No Match --> T2{"Tier 2:\nHistorical Bayesian Learner\nP(Category | Payee)"}
    T2 -- "Conf >= 0.85" --> RES2["Classified (Tier 2)\nConfidence: 0.85-0.98\nStatus: Auto-Assigned"]
    T2 -- "No/Low Match" --> T3{"Tier 3:\nMulti-Signal Canadian Heuristics\n(Token Jaccard + Sign / Flow)"}
    T3 -- "Conf >= 0.75" --> RES3["Classified (Tier 3)\nConfidence: 0.75-0.80\nStatus: Auto-Assigned"]
    T3 -- "Conf < 0.75 / Unmatched" --> B_CHECK{"Bedrock Recourse Enabled?\n(FOLIO_BEDROCK_ENABLED)"}
    B_CHECK -- No --> UNC["Uncategorized\nMarked for Review\n(Conf < 0.75 or 0.0)"]
    B_CHECK -- Yes --> T4["Tier 4:\nAWS Bedrock Converse API\n(Amazon Nova Micro)"]
    T4 -- Response --> CACHE["Auto-Learned to Tier 1 Rule\n(Zero Bedrock repeats)"]
    CACHE --> RES4["Classified (Tier 4)\nConfidence: 0.80-0.95\nStatus: Auto-Assigned"]
```

#### The Four Tiers Explained

- **Tier 1 — Deterministic Rules Engine**:
  - Evaluates user-defined and default rules using `EXACT`, `STARTS_WITH`, `CONTAINS`, and safe bounded `REGEX` pattern matching across both merchant payees and bank memo/notes (`Description 2`).
  - Prioritized by numeric rank (lower number = higher priority).
  - Matches execute in $< 1\text{ ms}$ with **100% confidence**.
  - Seeded with North American and Canadian merchant & banking patterns (transfers, Interac e-Transfers, mortgages, auto loans, credit card payments, municipal bills, bank rebates/interest, Costco, Loblaws, Metro, Hydro-Québec, Bell, Rogers, SAQ, LCBO, Petro-Canada, Tim Hortons, etc.).
  - **Generic-Payee Adaptive Learning Guard**: When categorizing a transaction with an uninformative bank label (such as `MISC PAYMENT`, `Payment`, `Transfer`, `Email Trfs`, or `LOAN`), Folio extracts a cleaned rule pattern from its specific memo/`notes` instead of learning an over-broad rule on the generic prefix.

- **Tier 2 — Historical Bayesian Frequency Learner**:
  - Dynamically calculates the empirical probability distribution $P(\text{Category} \mid \text{Payee})$ across your ledger history.
  - Scales confidence by sample size:
    $$N=1 \rightarrow 85\%, \quad N=2 \rightarrow 90\%, \quad N \ge 3 \rightarrow 95\%-98\%$$
  - Includes fallback token-overlap matching for recurring merchants with branch/terminal numbers (e.g. `TIM HORTONS #4122` matches `TIM HORTONS #102`).

- **Tier 3 — Multi-Signal Canadian & US Household Heuristics**:
  - 22 granular Canadian and US household categories with bilingual English and French keyword dictionaries.
  - Token-set fuzzy **Jaccard distance** matching with typo tolerance (e.g., `COSTMART` or `WAL-MRTT`).
  - Cashflow directional validation: distinguishes positive inflows (payroll, government benefits, GST credits) from negative outflows (utilities, subscriptions, bank fees).

- **Tier 4 — Optional AWS Bedrock AI Recourse (Zero Recurring Cost)**:
  - If a novel or ambiguous merchant cannot be resolved locally, Folio can optionally recurse to the AWS Bedrock Converse API using **Amazon Nova Micro** (`amazon.nova-micro-v1:0`) or Claude 3 Haiku in `ca-central-1`.
  - **Zero-Repeat Self-Learning**: When Bedrock successfully classifies an unrecognized merchant, Folio automatically stores a new Tier 1 exact rule in the database. Bedrock is **never invoked twice** for the same merchant pattern.
  - **Graceful Offline Fallback**: If AWS credentials, Bedrock access, or network are unavailable, the engine gracefully continues using local tiers without throwing errors.

#### Interactive Sandbox & Batch Operations

- **Classification Engine & Sandbox Tab**: Located in the Rules Manager, providing a real-time diagnostic playground with a live confidence meter, tier badges, matched pattern preview, and decision explanations.
- **1-Click Batch Auto-Classification**: Detects all uncategorized ledger transactions and classifies them in bulk with configurable minimum confidence thresholds (e.g. auto-assign $\ge 0.75$, flag $< 0.75$ for review).

---

### 2. Canadian Personal Finance & Household Collaboration

Folio is architected for Canadian legal, tax, and banking realities:

- **Multi-Member Collaborative Vault**:
  - Supports multi-user household collaboration with entities (`HouseholdMember`).
  - **Adding someone** (Household > Add someone) is one step: their name, relationship and colour, then either **Can sign in** (their email and what they can do; they get an invitation with a temporary password) or **No sign-in (bookkeeping only)**, for a child or anyone whose accounts you manage. A dependent starts as bookkeeping only, and a dependent who is invited starts as View only. A member without a sign-in can be invited later from their row (the envelope). The name you type goes into their sign-in profile and their household member, so nobody shows up as a bare email.
  - **Welcome**: on first sign-in, anyone the household doesn't know by name yet (including the owner invited by `deploy.ps1`) is asked once "what should we call you?". That names them and creates or links their household member; "Not now" asks again next session.
  - **Sign-ins** (Household > Sign-ins): everyone who signs in shares the one household ledger. Each person has a role. An **Owner** edits everything and manages who has access. A person who **Can edit** adds and changes accounts, transactions, budgets and goals. A **View only** person sees everything they are allowed to see and changes nothing: their edit buttons, Import and Rules are hidden, and the server refuses their changes either way. Owners change roles, resend invitations, pause access (which signs the person out everywhere at once) and remove sign-ins. The last owner cannot be demoted or removed.
  - **Who you are**: your sign-in is linked to a household member (the welcome step does it; you can change it under Sign-ins). New accounts, transactions and goals you add are then yours, and the dashboard gets a **Mine** quick filter (accounts you own, alone or jointly, plus shared ones without an owner).
  - **Account owners and privacy**: an account belongs to one or more members (none means shared). Its owners choose who sees it:
    - **Household**: everyone sees it and its transactions.
    - **Totals only**: others' net worth, cash flow, budgets and goals include it, but they never see its name, institution, details or transactions. It appears to them as a locked "Sam's account" with its balance.
    - **Private**: only its owners know it exists; it is left out of everyone else's totals too.

    Owners are the sign-ins linked to the account's members; the household Owner role does not override an account's privacy. Only an account's owners can change who sees it, and hiding an account requires the person hiding it to be one of its owners, so nobody can hide an account from themselves or a child's account from everybody. The rule is enforced by the server on every query, not just in the screens: a hidden account and its transactions, balances, holdings and statements are simply absent, and opening one by its address answers "not found". Closing a year still locks and archives every account; downloading a year's archive is refused to anyone who cannot see all of the accounts in it. With a single passphrase there is nobody to hide anything from, so the choice is not shown.
  - **Who changed what**: accounts, transactions, budgets, goals, holdings, rules and imports record who added them and who last changed them. The transaction editor shows "Added by Sarah · edited by Michael" once more than one person uses the vault.
  - Canadian statutory ownership rules: Registered accounts (**TFSA**, **RRSP**, **FHSA**, **RESP**) are legally individual, while **Chequing**, **Savings**, and **Mortgages** support joint ownership.
  - Granular household member filtering across the ledger, account balances, and goal tracking.
  - **Dashboard account filter**: choose which accounts the dashboard counts. Quick filters cover whole families (chequing and savings, credit cards, loans and lines, registered, investments, property) and appear only for families you have; a menu picks single accounts. Every figure follows the selection: net worth and its history, income, spending, cash flow and top categories. The choice is saved with your preferences, and new accounts are counted until you hide them.
  - Member relationships: Self, Partner or spouse, Dependent or child, Roommate or housemate, and Other.

- **Canadian Mortgage Mathematics**:
  - Implements **semi-annual compounding, not in advance**, as mandated by the Canadian *Interest Act* (s. 6), rather than the US monthly compounding convention. Using US mathematics overstates Canadian mortgage interest by thousands over a 25-year amortization.
  - Month-by-month principal, interest, and escrow (property tax and insurance) amortization schedules.
  - Supports switching to `MONTHLY` compounding for US mortgages and loans.

- **Liability Balances Are the Amount Owed**:
  - Transactions keep cash-flow signs on every account (a card purchase is negative, a payment to the card positive), but a card, loan, line or mortgage balance is stored as the positive amount owed. A card paid beyond its balance shows as in credit.
  - Imported statements (including RBC CSV exports with Visa, MasterCard and Royal Credit Line rows) produce positive balances for those accounts. Migration `0008` flips balances recorded negative before this change; balances typed in by hand as positive are left alone.
  - Credit cards with a limit show how much credit is left: a bar of the limit used (calm under 30% utilization, the level Canadian credit bureaus treat as healthy, amber to 75%, red above or over the limit) with the amount available. The dashboard's account list shows the amount left too.

- **Revolving Lines of Credit and HELOCs**:
  - No term or original principal: the balance goes up and down as you draw and repay.
  - The minimum monthly payment is interest-only by default. It can instead be set to a percentage of the balance, and is never less than that month's interest.
  - The Loans view projects the next 12 months at the minimum payment, and the cash flow forecast includes that payment.

- **Delayed Market Quotes & Bank of Canada Valet FX**:
  - Free, keyless quotes for TSX and TSX Venture (`.TO`, `.V`), US equities and ETFs, and crypto, delayed about 15 minutes. Yahoo Finance's chart endpoint is tried first; for TSX and TSX-V listings, TMX Money's quote endpoint fills in when Yahoo doesn't answer. Neither is an official API, so every failure is logged and reported by symbol with its reason.
  - Symbols are matched to their listing: `XEQT` typed in a CAD account resolves to `XEQT.TO` (then `.V`, then US), the Add holding dialog previews the match with its name, exchange and price, and a bare symbol never becomes a second, unquotable security. Migration `0009` merges any that already exist.
  - Quotes refresh by themselves once per browser session when Investments opens, then only when you press Refresh quotes, with the time of the last refresh shown. A listing is not fetched outside its trading hours once its close is recorded (TSX and US regular hours 9:30-16:00 ET, US pre-market from 4:00 and after hours to 20:00), nor twice within 10 minutes. A price you type in for a day is never overwritten by a fetched one.
  - Delayed prices carry a small "D" marker, US pre-market and after-hours prices a "Pre" or "Post" marker (with the regular close beside them); the marker's tooltip names the source and quote time. Hand-entered prices carry none.
  - Integration with the official **Bank of Canada Valet API** for daily USD/CAD exchange rates (`FXUSDCAD`) and automated portfolio revaluation.
  - Privacy-preserving: no financial aggregators or API keys; requests carry only ticker symbols.

---

### 3. Dedicated Goals & CRA Contribution Tracking

Folio provides statutory tracking for Canadian tax-advantaged accounts:

- **CRA Statutory Contribution Limits**:
  - **TFSA (Tax-Free Savings Account)**: Tracks the 2026 statutory annual limit ($7,000) with historical room accounting.
  - **FHSA (First Home Savings Account)**: Tracks the $8,000 annual contribution room and $40,000 lifetime cap.
  - Overcontribution warning indicators alerting users before triggering the CRA 1%/month penalty tax.

- **Interactive Emergency Fund Auto-Calculator**:
  - Models **3, 6, 9, or 12 months** of survival cash cushion based on trailing historical monthly expenses.
  - **Discretionary Category Exclusion**: Interactive checkboxes allow toggling off non-essential lifestyle categories (Dining Out, Travel, Shopping) to model lean survival targets versus standard lifestyle targets.
  - Links directly to liquid cash accounts (e.g. High Interest Savings Accounts).

---

### 4. Envelope Budgeting & Cash Flow Trajectory Forecasting

- **Envelope Budgeting with Rollovers**:
  - Category-by-category rollover toggle (`is_rollover`).
  - Surplus savings roll forward into next month's envelope to cushion upcoming expenses.
  - Deficits (overspending) strictly reduce next month's available cushion, preventing budget leakage.

- **30/60/90-Day Cash Flow Trajectory Simulation**:
  - Dynamic forward-looking trajectory modeling Canadian 26-pay-period bi-weekly, semi-monthly, and monthly payroll cycles alongside debt and mortgage amortization schedules.
  - Real-time zero-liquidity floor detection and advance cash deficit warning alerts.

- **Interactive Sankey Cashflow Diagram**:
  - Visualizes monthly income flowing into expense categories and net savings.
  - Internal transfers (credit card payments and inter-account transfers) are automatically identified and separated so cash flow summaries reflect true external expenditures.

---

### 5. Multi-Format Statement Ingestion & Deduplication

- **Empty-Workspace & Multi-Account Auto-Detection**:
  - Upload a bank export directly into an empty workspace (or select **Auto-detect from file**) to automatically detect accounts, infer Canadian account types (`CHECKING`, `SAVINGS`, `HISA`, `CREDIT_CARD`, `LINE_OF_CREDIT`, etc.) and institutions, mask account/card numbers to `*XXXX`, and review or rename accounts before committing.
  - Supports single-file multi-account exports (such as RBC CSV exports combining Chequing, Savings, Visa, MasterCard, and Royal Credit Line rows), matching existing accounts by `*XXXX` mask on subsequent re-imports, automatically pairing offsetting cross-account transfers, and propagating manual category selections to identical uncategorized rows in the import preview.
- **CSV Auto-Detection**:
  - Auto-detects delimiters (comma, semicolon, tab), `cp1252`/UTF-8 encodings, and column layouts across major Canadian institutions (RBC, TD, BMO, Scotiabank, CIBC, Desjardins, National Bank, Tangerine, EQ Bank, Wealthsimple) and US/Global banks (`Debit`, `Credit`, `Amount`, `Description 1`, `Description 2`, `CAD$`, `USD$`).
- **PDF Bank Statements**:
  - Tabular transaction and text pattern extraction using `pdfplumber` for credit cards and chequing accounts.
- **OFX / QFX / QBO Formats**:
  - Direct ingestion of bank export formats via `ofxtools`, including statement currency (`CURDEF`) and account metadata detection.
- **Zero-Duplicate Import Engine**:
  - Deterministic SHA-256 fingerprinting per transaction:
    $$\text{SHA-256}(\text{account\_id} \mid \text{date} \mid \text{amount\_cents} \mid \text{raw\_payee})$$
  - Filters out duplicate rows across overlapping statement imports.
  - Identical rows within one statement (two coffees on the same day for the same amount) are kept as separate transactions: the second and later occurrences get an occurrence number appended to the fingerprint, and the first keeps the original fingerprint so earlier imports still de-duplicate.
- **Unreadable Rows**: Rows whose date or amount cannot be read are skipped and listed in the import preview ("N rows skipped because they couldn't be read") instead of being imported with a guessed date.
- **Upload Size**: Statement files are limited to `FOLIO_MAX_UPLOAD_MB` (25 MB by default, 4 MB on AWS). The limit is shown in the upload screen. See [Limits](#limits).

---

### 6. Investment Performance & Portfolio Analytics

- **Holdings, Lots & Cost Basis**:
  - Individual purchase lot tracking with cost basis and disposal accounting.
  - Fractional-share precision (`Numeric(28, 8)`) for modern brokers and crypto.
  - **Add holding** looks up the symbol as you type (`XEQT` → `XEQT.TO`). It fills in the security's name and today's price, and shows the market value (quantity × price). You can type over either one. The price is saved with the holding, so the holding is valued straight away. A looked-up price keeps its source, so a later quote refresh updates it. A price you typed counts as entered by hand: refreshes leave it alone for that day.
- **Import Holdings from a Broker Export**:
  - On **Import** (or **Investments → Import holdings**), drop a broker holdings export, such as an RBC Direct Investing *Holdings* CSV. Folio recognises it as a snapshot of one account, not a list of transactions.
  - **Matching the account:** the account is matched to an existing investment or registered account by the last four digits of its number. If none matches, the preview proposes a new account with the type taken from the file (TFSA, RRSP, RESP, and so on). Only investment and registered accounts can be chosen.
  - **The preview shows:**
    - each position as **New**, **Changed** (with the quantity before), or **Unchanged**;
    - the uninvested cash, with other currencies converted at the file's own exchange rate;
    - the total Folio will value the account at, next to the file's own total. Folio keeps prices to the cent, so a sub-cent price can leave a small difference.
  - **What the import does:**
    - It sets each position to the file's quantity and book cost. An unchanged position keeps its lots and their purchase dates. A changed one gets a single lot dated the export day.
    - The file's last prices are recorded for that day. A price you typed in, or one already fetched for the day, is kept. Later quote refreshes take over from the imported prices.
    - Cash becomes a **Cash** position valued at face value. It is never quoted.
  - Positions Folio holds that the file doesn't list (for example ones you sold) are shown separately. They are removed only if you tick them.
- **Dual Performance Analytics**:
  - **Time-Weighted Return (TWR)**: Measures investment selection performance independent of cash flow timing.
  - **Money-Weighted Return (MWR / XIRR)**: Measures your actual portfolio return including the timing and magnitude of your deposits and withdrawals.
  - Reported across 1M, 3M, YTD, 1Y, and all-time windows.
- **Capital vs. Growth Breakdown**:
  - Distinguishes cumulative net contributions from market appreciation.
- **Holdings-First Layout and Charts**:
  - A ticker strip across the top shows each holding's latest price and the day's change. It updates only with a quote refresh, pauses on hover or focus, and stands still with reduced motion or fewer than three holdings.
  - The market value, unrealized gain, money added and market growth tiles follow, then the holdings, largest position first, with each position's weight in the portfolio.
  - Returns follow, with the period table charted as time-weighted vs money-weighted bars.
  - Allocation is shown by position (positions under 3% grouped as Other) and by asset class, alongside unrealized gain or loss per position and contributions vs growth.
- **Projection with Error Bands** (collapsed until opened):
  - Projects one account 5, 10, 20 or 30 years ahead from its own month-end history, valued with today's holdings so deposits never count as growth (`GET /api/investments/return-history`).
  - 1,000 simulated paths drawn from the account's monthly return and volatility; the chart shades the middle 50% and 80% of outcomes around the median, with the monthly contribution (defaulting to the past year's average) adjustable.
  - Needs at least 6 months of price history. Past returns don't predict future results, and the panel says so.

---

### 7. Exact Minor-Unit Money Architecture

- All monetary values are stored in the database as exact integer minor units (**cents**).
- Eliminates floating-point rounding errors (`0.1 + 0.2 = 0.30000000000000004`) across loan amortization schedules, budget balances, and transaction totals.
- The HTTP API accepts and emits decimal dollars for seamless integration.
- **Number format preferences** (Appearance → Numbers and currency, saved per device): presets for English Canada (`$1,234.56`), French Canada (`1 234,56 $`) and accounting (`($1,234.56)`), or a custom mix of negative style (minus or brackets), thousands separator (comma, period, space, apostrophe, none), decimal mark, and dollar sign before or after the amount. Charts, tables and month names follow the chosen style.

---

### 8. Interactive Ledger & Transfer Pairing

- Three layouts, one for each screen size. Nothing scrolls sideways at any size: text wraps, and tables hide or fold columns instead.
  - **Phone** (narrower than 768px): bottom tabs and larger type. Every tap target is at least 44px, and fields are 16px so iOS does not zoom into them. Rows are read-only cards that show their full details, wrapped over several lines. Tap a ledger entry, budget category, account, goal, holding, rule or household member to open a sheet with its details and its actions (edit, split, rollover, view transactions, delete). To change several ledger entries at once, use **Select**. Dialogs open as sheets from the bottom of the screen.
  - **Tablet** (768–1023px): the desktop tables and inline actions, with the navigation starting as an icon rail so the content has room. Touch screens get slightly larger buttons.
  - **Desktop**: the full tables. The navigation rail can be collapsed to icons only, and that choice is saved per device.
- Four type styles (Appearance → Type style, saved per device): **Broadsheet** (default; Source Sans 3 with Newsreader serif headlines), **Modern** (Inter), **Friendly** (Figtree), and **Terminal** (IBM Plex with monospaced figures). Amounts always use tabular figures so they align in columns, and charts follow the chosen style. The fonts ship with the app, so pages load nothing from other sites and the first paint never waits on a font server.
- Ten colour themes, each in light and dark: Folio Emerald (default; warm umber and cream paper), Bloomberg Terminal, Editorial, Catppuccin, Nord, Gruvbox, Tokyo Night, Dracula, **Campbell** (the Windows console's PowerShell blue with the Campbell terminal colours) and **High contrast** (black and white with bold colours, every label at 7:1 or more, clear borders and a heavy focus ring; chosen automatically on a new device set to ask for more contrast). Every text colour in every theme meets WCAG AA (4.5:1) on every background it sits on, and a test checks it; where a published palette fell short, only its lightness was adjusted.
- Multi-split transactions (e.g. mortgage payment split between principal, interest, and escrow).
- **Automated Transfer Pairing**: Identifies offsetting transactions between accounts (e.g. Chequing debit and Visa credit), linking them via `transfer_transaction_id` so they do not artificially inflate income or expenses.
- Inline category editing, merchant pattern rules creation, and batch categorization.
- **Closed years** (Ledger > Closed years): once a year is over, an owner can close it. Its transactions are then locked: they cannot be added, changed, deleted or moved in or out of the year, by anyone or anything. Rule application, auto-classification and transfer pairing pass over them, imports skip rows dated in a closed year and say how many, and the ledger shows a lock instead of the edit buttons. Closing a year also locks every year before it. Closing writes a read-only archive of the year: a SQLite file with that year's transactions, splits, budgets and month-end balances, plus the accounts, categories and household members they refer to. It is compressed and checksummed and kept in long-term storage. Anyone can download an archive, and an owner can reopen the latest closed year, which keeps its archive. Nothing is removed from the live database.

---

### 9. Built-in Canadian Demo Dataset

Folio includes a comprehensive Canadian household demo dataset that can be loaded on first launch or generated via `POST /api/maintenance/seed-demo-data`:

- **Household Members**: Michael (Self) & Sarah (Partner).
- **7 Canadian Accounts**: RBC Joint Chequing, EQ Bank Emergency HISA, Wealthsimple TFSA, TD Direct Investing RRSP, RBC Avion Visa Infinite, Desjardins Fixed Mortgage, and Toyota Financial Auto Loan.
- **150+ Realistic Ledger Entries**: Spread across the past 90 days with dynamic relative dates, paired transfers, mortgage splits, and bi-weekly payrolls.
- **20 Curated Uncategorized Showcase Transactions**: Recent transactions explicitly curated to demonstrate each tier of the auto-classification engine (Tier 1 rules, Tier 2 historical learning, Tier 3 Canadian heuristics, and Tier 4 Bedrock recourse).
- **Net Worth History**: 6 months of reconstructed daily balance snapshots for immediate trend visualization.

---

## Architecture

Folio uses a unified deployment model. The React 19 PWA is compiled in a multi-stage Docker build and served directly by FastAPI on port 8000, so the app and its API share one origin and need no CORS. On AWS, a CloudFront distribution sits in front of the Lambda Function URL and is the only supported entry point.

```mermaid
flowchart LR
    User[Client: Desktop / Mobile PWA] -->|HTTPS| CF[Amazon CloudFront<br/>/assets/* cached at the edge<br/>/api/* not cached]
    CF -->|X-Folio-Origin-Verify header| FURL[Lambda Function URL<br/>alias: live]
    FURL --> LWA[AWS Lambda + Web Adapter<br/>FastAPI + Embedded React 19 PWA<br/>ARM64 Graviton2]
    LWA <-->|IAM-token TLS connection| DB[(Aurora DSQL<br/>serverless PostgreSQL, ca-central-1)]
    LWA -->|Closed-year archives| S3[(Amazon S3<br/>Glacier Instant Retrieval)]
    BK[AWS Backup<br/>daily, 14 days] -.-> DB
    LWA -->|Session + origin secrets at startup| SM[(AWS Secrets Manager)]
    LWA -->|Sign-In / JWKS / TOTP MFA| COG[(AWS Cognito<br/>Invite-Only User Pool, Plus tier)]
    LWA -.->|Optional Recourse| BR[(AWS Bedrock<br/>Amazon Nova Micro)]
```

### Performance Notes

- Statement imports, auto-classification and transfer linking work in batches: rules, categories and categorisation history are loaded once per request rather than once per row. A 300-row statement previews in about a second on a vault with 50,000 transactions.
- The frontend loads each view (dashboard, ledger, ingestion, loans, investments and so on) and its charts on demand, so the first page load only fetches what it shows.

### Installing the App & Updates

Folio is an installable Progressive Web App with its own icon (a wallet with cards, in the Folio Emerald palette).

- **Android (Chrome, Edge, Samsung Internet):** open Folio, then use **Install app** from the browser menu. The home-screen icon adapts to the launcher's shape.
- **iPhone and iPad (Safari):** Share, then **Add to Home Screen**. Folio opens full screen, clear of the notch and home indicator.
- **Desktop (Chrome, Edge):** the install icon in the address bar, or the browser menu's **Install Folio**. Right-click the installed app's icon for shortcuts to Ledger, Budget and Import; a shortcut brings an open Folio window forward rather than opening a second one. Chrome and Edge show two screenshots of the dashboard (demo data, in `frontend/public/screenshots/`) in the install dialog.

**Updates.** When a new version has been deployed, an **Update available** item appears at the top of the sidebar (and in the mobile header and menu). Select it to reload into the new version: it shows **Updating…** until the page reloads, which takes at most a few seconds even if the new version cannot take over (for example after a hard refresh, or when another Folio window already switched). After a hard refresh the page is already the newest version, so the item does not appear and the new version quietly takes over for the next visit. Folio never reloads on its own while you are signed in, so nothing you are in the middle of is lost. An open or installed app checks for a new version every hour and each time you return to it; on the sign-in screen a waiting update is applied straight away.

**Changing the icon.** The sources are `frontend/public/folio-icon.svg` (rounded tile: favicon and app icons) and `frontend/icons/folio-icon-maskable.svg` (full-bleed square with the mark inside the maskable safe zone: Android adaptive icons and the iOS home screen). After editing either, run `npm run generate-icons` in `frontend/` and commit the PNGs and `favicon.ico` it writes to `frontend/public/`. Builds use the committed files, so CI and Docker do not need the image toolchain.

---

## Quick Start (Local Development)

### Prerequisites

- **uv** (`winget install astral-sh.uv` — manages Python 3.14 and the backend virtual environment automatically)
- **Python 3.14** (used in CI, container image, and local development)
- **Node.js 26 LTS** and **npm** (used in CI and the container image)
- **Docker** (Docker Desktop on Windows): the local database is PostgreSQL 16 in a container

### 1-Command Local Launcher

Launch both the FastAPI backend and Vite frontend with hot-reloading:

```powershell
.\dev.ps1
```

This starts the local database (the `db` service in `docker-compose.yml`: PostgreSQL 16 on `127.0.0.1:5433`, data in the `folio-db` Docker volume), syncs the Python virtual environment with `uv`, installs frontend dependencies if needed, starts the backend on `http://localhost:8000`, the frontend on `http://localhost:5173`, and opens your browser. The backend creates and migrates the schema on first start.

### First Run: Master Passphrase Vault

There is no default password. Authentication is fail-closed, so with nothing configured the app starts normally and rejects API requests.

On first run, `dev.ps1` prompts for a master passphrase, bcrypt-hashes it locally, and writes only the hash to `backend/.env` (gitignored). Subsequent runs pick it up automatically.

```powershell
.\dev.ps1 -SetPassword   # Change the local master passphrase
.\dev.ps1 -Clean         # Wipe database and uploads to start fresh (passphrase is preserved)
```

To generate a bcrypt hash manually:

```powershell
"your passphrase" | uv run --directory backend python scripts\hash_password.py
```

If the backend starts with no passphrase configured (for example a fresh Docker container), the web app offers a one-time setup through `POST /api/auth/setup`. The bcrypt hash is written to `data/.folio_master_hash` (mode 0600) in the data directory (`FOLIO_DATA_DIR`) and loaded on later starts while `FOLIO_MASTER_PASSWORD_HASH` is unset, so a restart does not reopen setup. Setup is refused in production mode (on AWS Lambda, or when `FOLIO_ENV` is `prod` or `production`).

The session signing key works the same way: when `FOLIO_SECRET_KEY` is unset, a random key is generated once into `data/.folio_secret_key`, so sessions survive restarts. Production mode refuses to start on a generated key when local (non-Cognito) sign-in is in use.

### Database Migrations & Maintenance

The schema is managed by Alembic.

- History starts at a single baseline revision (`0001_baseline`) that creates the whole schema; later changes are new revisions on top of it. A vault file from the last release that kept the database in SQLite (revision `0001`) has the same tables as an export: compress it with `scripts/vault_zstd.py compress` and load it with `python -m app.cli import` (see [Backups & Restore](#backups--restore)).
- **Local and Docker** installs migrate on startup. Each revision runs in its own transaction, so a failed upgrade rolls back.
- **AWS** never migrates from the running app. `deploy.ps1` runs `python -m app.cli migrate` from your machine after `sam deploy`, signed in to the database as its admin role. The app's own database role (`folio_app`) can read and write rows but cannot change the schema; a Lambda instance that finds the database behind its code refuses to start until the migration has run. On the serverless database every schema statement commits on its own and indexes are built asynchronously, so write revisions that add rather than rewrite (new columns and tables, then backfill), and keep each step safe to run against code one version older.
- If the database is at a revision this build does not know (a newer build already migrated it), the app logs a warning and skips migrating rather than attempting a downgrade.

```powershell
cd backend
uv run alembic current           # Show applied revision
uv run python -m app.cli migrate # Apply pending migrations and seed default categories and rules
```

One-shot maintenance operations for existing installations:

```
POST /api/maintenance/seed-demo-data?force=true      # Seed Canadian demo dataset (disabled in production)
POST /api/maintenance/backfill-snapshots?months=24   # Reconstruct net worth history (disabled in production)
POST /api/maintenance/detect-transfers               # Pair historical transfers
```

`seed-demo-data` and `backfill-snapshots` overwrite or reconstruct data, so they return `403` in production mode (on AWS Lambda, or when `FOLIO_ENV` is `prod` or `production`).

---

## Running Automated Tests

Run the complete 3-phase automated test suite (Backend Pytest + Frontend Vitest with `happy-dom` + TypeScript typecheck & production build) in 1 command:

```powershell
.\test.ps1
```

The backend tests run against the `folio_test` database in the local Postgres container (`test.ps1` starts it; the container's first start creates that database). Each test runs inside a transaction that is rolled back, so tests never see each other's data or your development data. Point `FOLIO_TEST_DATABASE_URL` at another server to use it instead; CI uses a Postgres service container.

---

## CI/CD & Automated Security

Folio includes automated GitHub Actions workflows. Every third-party action is pinned to a full commit SHA (with the version in a comment).

- **Continuous Integration ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))**: Runs on every commit:
  - Backend: Pytest suite against a PostgreSQL 16 service container.
  - Frontend: Vitest suite, `tsc -b`, and the Vite production build.
  - Infrastructure: `sam validate --lint`, `cfn-lint`, and Checkov against `template.yaml`.
  - Container: builds the Docker image for `linux/arm64` (the Lambda architecture) without pushing it.
- **CodeQL Security Analysis ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml))**: Static application security testing (SAST) for Python and TypeScript, on pushes and pull requests to `main` and weekly.
- **Gitleaks Secret Scanner ([`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml))**: Scans commits for exposed secrets, tokens, or private keys. Reviewed false positives are listed by fingerprint in [`.gitleaksignore`](.gitleaksignore).
- **Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml))**: Grouped weekly updates for `uv` and `npm`, weekly updates for Dockerfile base images (`docker`), and monthly updates for GitHub Actions. Python minor upgrades of the base image and python-dateutil major upgrades (which botocore rejects) are ignored and taken deliberately.
- **Branch rules**: `main` requires a pull request and five passing checks: Backend Tests, Frontend Tests & Typecheck, Infrastructure Lint, Docker Image Build and Gitleaks. Repository admins can bypass.

---

## Docker Compose Setup

Run the unified build (FastAPI + embedded PWA, with PostgreSQL 16 in a second container):

```powershell
docker compose up --build
```

Access the application at `http://localhost:8000`.

- **Network**: The port is published on `127.0.0.1` only. To reach the app from other devices on your network, change the mapping in `docker-compose.yml` to `"8000:8000"`.
- **Data**: the database lives in the `folio-db` Docker volume. `./backend/data` is mounted at `/app/data` and holds uploads, closed-year archives, the generated session key (`.folio_secret_key`) and, if you used the setup screen, `.folio_master_hash`. Set `FOLIO_DB_PASSWORD` (in a `.env` file next to `docker-compose.yml`) before the first start to use a database password other than the development default; the database port is published on `127.0.0.1` only.
- **Authentication**: Set `FOLIO_MASTER_PASSWORD_HASH` (for example in a `.env` file next to `docker-compose.yml`), or leave it unset and use the one-time setup screen.
- **Session key**: `FOLIO_SECRET_KEY` is optional in development; a random key is generated into `backend/data/.folio_secret_key`. It is required when `FOLIO_ENV` is `prod` or `production`.
- **Origin check**: `FOLIO_ORIGIN_VERIFY_SECRET` is optional. Set it only if a reverse proxy in front of the container injects a matching `X-Folio-Origin-Verify` header; every request without it is then rejected with `403`.
- **Local development only**: Docker Compose is for running Folio on your own machine and never talks to AWS storage. If `S3_BUCKET_NAME` is set outside Lambda it is ignored and a warning is logged. To move a household between Docker and AWS, export and import it (see [Backups & Restore](#backups--restore)).
- **Health**: The image defines a `HEALTHCHECK`, and Compose a matching `healthcheck`, that calls `GET /api/health` every 30 seconds. The endpoint runs a trivial database query and returns `503` when the database does not answer.

---

## Security & Zero-Trust Architecture

Folio implements a defense-in-depth security model for hosting financial data:

- **Dual-Auth Identity Engine**:
  - **AWS Cognito User Pool (Production Cloud)**: RS256-only OpenID Connect / JWKS validation with strict `token_use` + `client_id`/`aud` binding (no HS256 fallback in Cognito mode), invite-only user provisioning (`AllowAdminCreateUserOnly: true`), 20-character passphrases, mandatory **TOTP Software Token MFA** (`MfaConfiguration: ON`), 60-minute access and ID tokens with 30-day refresh tokens, token revocation on sign-out, `HttpOnly` / `SameSite=Lax` / `Secure` access and refresh cookies, and unsigned public-client Cognito API calls (requiring zero Cognito IAM permissions on the Lambda role).
  - **Cognito threat protection**: The pool is on the Plus tier with threat protection enforced. Sign-ins and password changes using known-compromised credentials are blocked. Medium- and high-risk sign-ins are escalated to MFA rather than blocked, because sign-in is proxied through Lambda and Cognito therefore sees AWS IP addresses rather than the user's; a block action could lock the owner out. The pool has deletion protection on and is retained when the stack is deleted.
  - **Master Passphrase Vault (Local / Docker / `-DisableCognito`)**: Protected by bcrypt hashing, constant-time comparisons (`secrets.compare_digest`), and signed `HttpOnly`, `SameSite=Lax`, `Secure` HS256 JWT session cookies.
- **Secrets in Secrets Manager**: On AWS the session signing key and the origin-verify value are generated by the template in AWS Secrets Manager. Lambda's environment holds only their ARNs (`FOLIO_SESSION_SECRET_ARN`, `FOLIO_ORIGIN_SECRET_ARN`) and the app reads the values at startup, failing to start if it cannot. The master passphrase is only ever sent as a bcrypt hash (`MasterPasswordHash`, a `NoEcho` parameter).
- **Fail-Fast Production Validation**: In production mode (every AWS Lambda stack, including `qa` or `staging`, and any install with `FOLIO_ENV` set to `prod` or `production`), the app refuses to start with a generated session key (when local sign-in is enabled) or a plaintext `FOLIO_MASTER_PASSWORD`.
- **Production Hardening**: In production mode the OpenAPI schema and the Swagger/ReDoc pages are not served, CORS allows no origins unless `FOLIO_CORS_ORIGINS` (`AllowedOrigin`) is set, `/api/auth/setup` is refused, and the destructive maintenance endpoints (`seed-demo-data`, `backfill-snapshots`) return `403`. The default CloudFront deployment is same-origin and needs no CORS.
- **Login & MFA Rate Limiting**: Sliding-window rate limiter (8 failed attempts per 5 minutes per client) across `/api/auth/login`, `/api/auth/cognito/login`, and `/api/auth/cognito/challenge`. Behind CloudFront the client is identified by the `CloudFront-Viewer-Address` header; `X-Forwarded-For` is never trusted. The counters are held per instance, so with several Lambda instances the effective ceiling is multiplied by the instance count. This is an accepted limitation: Cognito has its own throttling and threat protection, and the budget alarm bounds cost.
- **Bounded User-Supplied Regex**: Categorization rules accepting regular expressions are length-limited and screened for nested quantifiers to prevent ReDoS (catastrophic backtracking).
- **Edge Origin Verification**: CloudFront adds an `X-Folio-Origin-Verify` header whose value comes from a template-generated Secrets Manager secret. The app rejects every request without it with `403`, so the raw Lambda Function URL cannot be used directly. The only exception is the local health probe from the Lambda Web Adapter or Docker. The value is visible to anyone who can call `cloudfront:GetDistributionConfig` on the distribution, so treat that permission as sensitive.
- **Security Headers**: Defined once in [`backend/app/core/security_headers.py`](backend/app/core/security_headers.py) and sent by the app on every response, including errors:
  - `Content-Security-Policy`: scripts, stylesheets, fonts, images and API calls from the app's own origin only (images may also be `data:`/`blob:`; inline style attributes are allowed for the charts, `<style>` elements are not). Sign-in goes through the app's `/api/auth` routes, so the browser never contacts the identity service directly. No plugins, no frames, `frame-ancestors 'none'`. In production it also adds `upgrade-insecure-requests`.
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`, in production only, so local Docker over `http://localhost` is unaffected.
  - `Permissions-Policy` denying camera, microphone, geolocation, payment, USB, Bluetooth, sensors, fullscreen, `unload` and the other powerful features; only `clipboard-write` is allowed, for copying the TOTP secret. It lists only features Chrome and Edge recognize, so the browser console stays quiet; the retired ad-targeting features (Topics, Protected Audience, Attribution Reporting) are left out because nothing here could use them.
  - `X-Robots-Tag: noindex, nofollow`, and `/robots.txt` disallows everything: a private household app has nothing for search engines or AI crawlers. A request for a file that is not part of the app (`/llms.txt`, `/.well-known/...`) is a plain `404`, not the app shell.
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`, and `X-XSS-Protection: 0` (the legacy filter is disabled, as current guidance recommends).
  - `Cache-Control: no-store` on every `/api` response, so financial data is never kept in browser or proxy caches. The content-hashed files under `/assets` are `public, max-age=31536000, immutable` (a changed file gets a new name); the page itself, the service worker and the manifest are `no-cache`, so a deploy is seen at once.
  - No `Server` header. `Cross-Origin-Embedder-Policy` is deliberately not sent: nothing needs cross-origin isolation.
  - On AWS, a CloudFront response headers policy mirrors these values. It always adds HSTS, and fills in the other headers only where the app did not answer (for example a CloudFront error page). The CSP comes from the app only.
- **Structured Logs**: Every request writes one JSON access line (`folio.access`: method, path without the query string, status, duration, request ID, client IP). Uvicorn's startup and error lines are JSON too, and `GET`/`HEAD` both work on `/` and `/api/health`.
- **Database access**: The database has no password. The function connects to the Aurora DSQL endpoint over TLS with a short-lived IAM authentication token as the `folio_app` role, which may read and write rows but not change the schema; `deploy.ps1` maps that role to the function's IAM role. The cluster has deletion protection on and is retained when the stack is deleted.
- **S3 Archive Protection**: The archive bucket blocks all public access, enforces bucket-owner object ownership (`BucketOwnerEnforced`, ACLs disabled), encrypts objects with SSE-S3 (`AES256`), keeps versions, and has a bucket policy that denies any request not made over TLS.
- **Least-Privilege IAM**: The Lambda role may connect to the stack's own database as a non-admin role (`dsql:DbConnect` on that cluster only), read and write only `archives/*` (closed-year archives) in the archive bucket, and read only the stack's two secrets. With Cognito on, it may create, look up, update (their name), disable, enable, sign out and delete users in the stack's own user pool only, for in-app people management. `bedrock:InvokeModel` is granted only when `EnableBedrock` is `true`, and only for the configured model or inference profile.
- **Container Non-Root Isolation**: Multi-stage Docker execution runs as an unprivileged `appuser` (UID 1000), and the Docker build context excludes `backend/data/`, databases, `.env` files and `samconfig.toml` so no vault data or secrets are baked into the image.

---

## Data Handling

- The database holds financial personal information: payees, amounts, dates, balances, account names and masked account numbers (`*XXXX`). Treat the database, its exports, the archive bucket and any backup copies accordingly.
- Appearance settings (theme, light or dark mode, type style, number format, the collapsed sidebar and the accounts hidden from the dashboard) are stored per user in the vault, in the `user_preferences` table, so they follow you to any device or browser and are backed up with the vault. They arrive with the rest of the start-up data in one request. Each Cognito user has their own row, keyed by their Cognito user ID; the master passphrase owner has one. The browser also keeps a copy so the sign-in screen opens in your colours, and changes are saved about a second after you stop adjusting them.
- On AWS, uploaded statements are parsed in memory and are not archived: `/tmp` disappears with the instance. Only the parsed transactions are stored in the database. Docker and local installs keep a copy of each uploaded statement in the uploads directory.
- With Bedrock enabled, transactions that the local tiers cannot classify are sent to the configured Bedrock model: raw payee text, amount, currency, account type and date, plus your category names. A cross-region inference profile (for example `us.amazon.nova-micro-v1:0`) may process that data outside `ca-central-1`. If that matters to you, leave Bedrock off (the default) or choose a model that runs in your region.

---

## Limits

- **Upload size**: `FOLIO_MAX_UPLOAD_MB`, 25 MB by default. The SAM template sets it to 4 MB because a Lambda Function URL rejects request payloads above 6 MB and multipart uploads are base64-encoded in the Lambda event, which adds about a third. The upload screen shows the active limit.
- **Bedrock classification time**: Bedrock gets at most 20 seconds per request (12-second read timeout, no retries), so a request stays inside the 30-second Lambda and CloudFront limit. Rows Bedrock hasn't answered by then stay uncategorised instead of failing the request.
- **Cognito email**: The pool uses Cognito's default email sender, which is limited to 50 emails per day. That is plenty for household invitations; configure Amazon SES on the user pool if you need more.
- **Statement rows**: Rows that cannot be read are reported in the preview and skipped rather than imported with a guessed date. Identical same-day rows within one statement are kept as separate transactions.
- **Login rate limit**: Per instance, as described under [Security](#security--zero-trust-architecture).

---

## AWS SAM Serverless Deployment

Folio includes a native AWS SAM template (`template.yaml` + `Dockerfile`) that runs the app with the **AWS Lambda Web Adapter** on ARM64 Graviton2, behind an **Amazon CloudFront** distribution, with a **Lambda Function URL** as the origin and an invite-only Cognito User Pool.

### Prerequisites

- **AWS SAM CLI** (`>= 1.159` with `--use-buildkit` support) and **AWS CLI v2** authenticated with permissions to create IAM roles/policies (`iam:CreateRole`, `iam:PutRolePolicy`, `iam:DeleteRole*`; note AWS's built-in `AWSPowerUserAccess` excludes IAM management), plus CloudFront, Secrets Manager, CloudWatch, SNS, AWS Budgets, AWS Backup and `ecr:PutLifecyclePolicy` permissions, `dsql:CreateCluster` / `dsql:DbConnectAdmin` (the deploy step migrates the database as its admin role), `cognito-idp:AdminGetUser` / `cognito-idp:AdminCreateUser` when using `-OwnerEmail`, and CloudFormation/DSQL/Backup/S3/ECR/Logs/Cognito/Secrets Manager delete permissions when using `teardown.ps1`. **uv** is also needed on the deploying machine: `deploy.ps1` runs the database migration with it.
- **Docker with Buildx** (builds the static frontend on native `$BUILDPLATFORM` and compiles the runtime image for `linux/arm64` with `BUILDX_NO_DEFAULT_ATTESTATIONS=1` so BuildKit emits a single-platform manifest compatible with AWS Lambda).

### Deploying

```powershell
# Deploy prod with invite-only Cognito, invite the owner, and send alarms + budget alerts by email
.\deploy.ps1 -Environment prod -OwnerEmail you@example.com -AlarmEmail you@example.com

# Invite another household member later (idempotent; existing users are skipped)
.\deploy.ps1 -Environment prod -OwnerEmail member@example.com

# Deploy an isolated QA stack with its own database and archive bucket (folio-vault-qa-<account>-<region>)
.\deploy.ps1 -Environment qa -StackName Folio-QA -OwnerEmail you@example.com

# Or deploy a QA/dev stack in single Master Passphrase mode without Cognito
.\deploy.ps1 -Environment qa -StackName Folio-QA -DisableCognito -MasterPassword (Read-Host -AsSecureString)

# Reuse a retained archive bucket from a previous deployment
.\deploy.ps1 -Environment qa -StackName Folio-QA -ExistingVaultBucket folio-vault-qa-012345678901-ca-central-1

# Enable Bedrock classification (accepts a model ID or an inference profile ID)
.\deploy.ps1 -Environment prod -EnableBedrock -BedrockModelId us.amazon.nova-micro-v1:0

# Raise the monthly budget alert from the default $5
.\deploy.ps1 -Environment prod -MonthlyBudgetUsd 10

# Show the parameters a deploy would use, without building or deploying
.\deploy.ps1 -Environment prod -WhatIf

# Show the CloudFormation changes a deploy would make, then discard them
.\deploy.ps1 -Environment prod -Preview

# Optional: validate and lint the template before deploying
sam validate -t template.yaml --lint
```

`deploy.ps1` parameters:

| Parameter | Default | Purpose |
| :--- | :--- | :--- |
| `-Environment` | `prod` | Stage name (`[a-z0-9-]`, 1-21 chars). Selects the saved settings and names the database, archive bucket, user pool and log group. |
| `-StackName` | Saved value, else `folio-<Environment>` | CloudFormation stack name. |
| `-Region` | Saved value, else `ca-central-1` | AWS region. |
| `-OwnerEmail` | | Invite this email to the Cognito pool (idempotent). The first one given is saved as the household owner (`OwnerEmail`), who always signs in as an owner. Not valid with Cognito disabled. |
| `-DisableCognito` | Off | Single Master Passphrase mode. Needs `-MasterPassword` (or a saved hash). `-DisableCognito:$false` re-enables Cognito. |
| `-MasterPassword` | | Hashed locally with bcrypt; only the hash is sent (`MasterPasswordHash`). |
| `-EnableBedrock` | Off | Tier 4 Bedrock classification. `-EnableBedrock:$false` turns it off. |
| `-BedrockModelId` | `amazon.nova-micro-v1:0` | Model ID or inference profile ID. IAM access is granted to this ID only. |
| `-AlarmEmail` | | Email for alarm (SNS) and budget notifications. Pass `''` to remove. |
| `-MonthlyBudgetUsd` | `5` | Account-wide monthly cost budget in USD. Only created when an alarm email is set. |
| `-ExistingVaultBucket` | | Reuse a retained archive bucket instead of creating one. |
| `-AllowedOrigin` | | Extra origin allowed to call the API cross-origin. Leave empty for the default same-origin deployment. |
| `-ReservedConcurrency` | `0` | Optional Lambda reserved concurrency, as a spend cap only. See below. |
| `-RollbackToVersion` | | Point the `live` alias at an earlier version and exit. See [Rolling Back a Deploy](#rolling-back-a-deploy). |
| `-Preview` | | Build and create a CloudFormation change set with the saved settings, print every resource it would add, modify or remove, flag any replacement or removal of the database, backup vault, user pool, archive bucket, CloudFront distribution, secrets or log group, then delete the change set without deploying. `samconfig.toml` and the stack stay unchanged, but the image is pushed to ECR. Run it before deploying a template change. |
| `-WhatIf` / `-Confirm` | | Standard PowerShell confirmation. `-WhatIf` only prints the parameters and stops before building; it does not contact CloudFormation. |

What a deploy does:

1. Checks the SAM CLI, Docker and AWS credentials.
2. Runs `sam build --use-buildkit`.
3. Runs `sam deploy` with the saved settings, tagging the stack `app=folio` and `env=<Environment>`.
4. Applies an ECR lifecycle policy to the image repository: untagged images expire after 1 day and only the 5 most recent images are kept.
5. Prints the outputs, including **`AppUrl`**, and invites `-OwnerEmail` if given.

**Open the `AppUrl` output (the CloudFront URL) in your browser.** The `FunctionUrlOrigin` output is the raw Lambda Function URL; it rejects every request that does not carry the CloudFront origin-verify header. The first deploy takes several minutes longer than later ones while CloudFront creates the distribution.

`deploy.ps1` fails fast on authentication, `sam build`, `sam deploy`, or `describe-stacks` errors so a failed container build never provisions orphaned CloudFormation companion stacks. If the deploy fails, `samconfig.toml` is restored to its previous content.

**Reserved concurrency** is not needed for safety. Several Lambda instances can serve the app at once because they share one database and a save that loses a race is retried (see [Serverless Architecture Highlights](#serverless-architecture-highlights)). `-ReservedConcurrency` is only an optional spend cap, and a low cap has a cost: when all reserved instances are busy, the Function URL answers `429` instead of queueing the request. Accounts whose Lambda concurrency quota is 10 (new or sandbox accounts) cannot reserve any concurrency, so leave it at `0` there.

**Upgrading a stack deployed before CloudFront was added**: the old `FolioAppUrl` output is gone; use `AppUrl`. The `SessionSecretKey` and `OriginVerifySecret` parameters were removed and `deploy.ps1` drops them from saved settings. Because the session key moves to a new generated secret, existing sessions end once after that upgrade. Later deploys keep the same key, so redeploying no longer signs anyone out.

### Saved Settings (samconfig.toml)

Settings persist per environment in `samconfig.toml` under `[<Environment>.deploy.parameters]`, and the deploy runs with `sam deploy --config-env <Environment>`. A later deploy of the same environment only needs the parameters that change: anything not passed keeps its saved value, so a redeploy does not reset Cognito, Bedrock, alarm or budget settings. Pass a parameter explicitly to change or clear it (for example `-AlarmEmail ''` or `-EnableBedrock:$false`).

`samconfig.toml` holds the `MasterPasswordHash` (when set) and the alarm email. It is git-ignored, and `deploy.ps1` warns if git does not ignore it.

### First-Time Sign-In & Managing Users (Invite-Only Cognito)

When deploying with `-OwnerEmail you@example.com`, Cognito emails an invitation with a temporary password (`no-reply@verificationemail.com`). Open the `AppUrl` and, on your first sign-in:

1. Enter your invited **Email address** and the emailed temporary password.
2. Choose a permanent passphrase (**20+ characters**, at least one lowercase letter).
3. Scan the rendered **TOTP QR code** (or copy the manual setup key) into your authenticator app and enter the 6-digit verification code to issue `HttpOnly` session and refresh cookies.

The first `-OwnerEmail` is saved as the household owner. Without one, the first person to sign in becomes the owner.

To invite more people, open **Household** and use **Add someone**: their name, relationship, **Can sign in**, their email and what they can do (Owner, Can edit, View only), all in one step. They receive the same invitation email, with their name already in their profile. A member added without a sign-in can be invited later from their row. An invitation that was missed or expired can be sent again from **Sign-ins** (the circular arrow). Everyone already in the user pool before this feature existed joins as **Can edit** on their next sign-in.

Re-running `deploy.ps1 -OwnerEmail member@example.com` still invites someone (as **Can edit**), and the AWS CLI works too:

```powershell
aws cognito-idp admin-create-user --user-pool-id <CognitoUserPoolId> --username you@example.com --message-action RESEND --desired-delivery-mediums EMAIL --region ca-central-1
```

You can sign out and lock the session at any time using the **Sign out** button in the desktop sidebar footer or mobile menu.

### Serverless Architecture Highlights

1. **CloudFront in front of Lambda**: The distribution serves everything from one origin. `/assets/*` (content-hashed Vite files) is cached at the edge with the managed `CachingOptimized` policy; `/api/*` and the app shell are effectively uncached and forward cookies, query strings and the viewer address. CloudFront adds the `X-Folio-Origin-Verify` header on the way to the Function URL. The distribution uses the default `*.cloudfront.net` certificate; a custom domain needs an alternate domain name and a `us-east-1` ACM certificate added to the distribution, which the template does not do.
2. **Lambda Web Adapter**: Runs the standard FastAPI app and compiled React 19 PWA inside AWS Lambda without code changes. Its readiness check calls `/api/health`, which runs a database query. Nothing keeps the function warm, so the first request after a quiet spell waits a few seconds while it starts. The web app is built for that: a browser that was signed in last time draws the app at once and fills it in when the server answers (a remembered flag in local storage, nothing secret; the server still decides). Otherwise it shows the Folio mark, adding "Folio is waking up…" after a moment. The session check and other reads that fail while the server starts (a dropped connection, `502`, `503`, `504`) are retried, and a failed check is never treated as being signed out; after 30 seconds without an answer the app says Folio isn't responding and offers to try again.
3. **Versioned deploys**: Every deploy publishes a new Lambda version and moves the `live` alias, which the Function URL serves. This is what makes [rollback](#rolling-back-a-deploy) a single alias update.
4. **Invite-Only AWS Cognito + Built-in Sign-In & MFA**: Provisioned with `AllowAdminCreateUserOnly: true`, case-insensitive email usernames, 20-char passphrases, mandatory TOTP MFA (`SOFTWARE_TOKEN_MFA`), the Plus tier with threat protection, and deletion protection. The pool is retained when the stack is deleted. The web app handles email/password login, first-login passphrase replacement, inline SVG QR TOTP enrollment, `HttpOnly` session + refresh cookies, and sidebar/mobile sign-out; pass `-DisableCognito -MasterPassword` to use single Master Passphrase mode instead.
5. **Generated secrets**: `FolioSessionSecret` (session signing key) and `FolioOriginSecret` (origin-verify value) are generated once by CloudFormation in Secrets Manager and stay the same across deploys.
6. **Aurora DSQL database**:
   - The household's data lives in an Aurora DSQL cluster: serverless, PostgreSQL 16 compatible, billed per request, with nothing running while nobody uses the app. The function reaches its public endpoint over TLS without a VPC (and without a NAT gateway), authenticating with an IAM token instead of a password. Every Lambda instance works on the same live data; there is no copy to restore at startup or upload after a change.
   - **Concurrent saves**: transactions run at `REPEATABLE READ` with optimistic concurrency. When two people change the same rows at the same moment, one commit wins and the other is rolled back. The server then runs the losing request again on the current data, after a short randomized pause, up to three attempts in all, so both changes land. Only when every attempt loses does the request return `409` with code `write_conflict`; the web app reloads its data and asks the person to try again. Requests with effects outside the database (sending an invitation, uploading a year archive) are never repeated. To make the replay possible, the request body is held in memory. Local Postgres uses the same isolation level, so development and tests behave the same way.
   - **Bounded transactions**: the database refuses a transaction that changes more than 3,000 rows. Imports commit every 1,000 rows; applying rules, auto-classification, transfer pairing, deleting an account and the demo reset commit every 2,000. If a large import fails part-way, the message says how many rows were saved, and importing the file again adds the rest (rows already saved are skipped).
   - **Schema**: changed only by the deploy step, as the database admin (see [Database Migrations & Maintenance](#database-migrations--maintenance)). Default categories and rules use deterministic UUIDv5 IDs, so seeding twice never duplicates them.
   - **Retention**: the cluster has deletion protection on, `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. AWS Backup takes a daily backup kept for 14 days (`-EnableBackups`, on by default).
   - The archive bucket (`folio-vault-${EnvironmentName}-${AWS::AccountId}-${AWS::Region}`) is also retained. Reattach it with `-ExistingVaultBucket`. Objects left in `database/` and `backups/` by releases that kept the vault in S3 expire after 30 and 7 days.
7. **Optional AWS Bedrock Recourse**: When `EnableBedrock` is `true`, the Lambda role may call `bedrock:InvokeModel` for the configured `BedrockModelId` only (as a foundation model, or as an inference profile in the stack's region together with the foundation models that profile routes to). With Bedrock off, the role has no Bedrock permissions.

### Observability & Alarms

- **Logs**: The app writes one JSON object per line. Lambda sends application and platform logs to the stack-owned log group `/folio/<env>/app` (output `AppLogGroup`), kept for 90 days.
- **Request IDs**: Every response carries an `x-request-id` header. Behind the Lambda Web Adapter it is the request ID from the invocation's request context, and every log line for that request carries the same `request_id`, so a user-reported ID leads straight to the logs.
- **Tracing**: AWS X-Ray active tracing is on for the function.
- **Alarms**: Metric filters turn log events into metrics in the `Folio/<env>` namespace. All alarms are created on every deploy; they only send notifications when `-AlarmEmail` is set.

  | Alarm | Fires when |
  | :--- | :--- |
  | `http_5xx` | 5 or more server errors in 5 minutes. |
  | `write_conflict` | 5 or more saves in an hour lost every retry to concurrent writers (people were asked to try again). |
  | Database DPUs | The database used more than `-DailyDpuAlarmThreshold` DPUs (default 3,000, about the daily share of the 100,000-DPU monthly free tier) in a day. |
  | Lambda `Errors` | Any invocation error (crash, timeout, failed init) in 5 minutes. |
  | Lambda `Throttles` | Any throttled request in 5 minutes (concurrency limit reached). |

- **Email notifications**: `-AlarmEmail` subscribes the address to an SNS topic. AWS sends an "AWS Notification - Subscription Confirmation" email after the first deploy, and no alarm emails are delivered until you confirm it.
- **Budget**: With `-AlarmEmail` set, an AWS Budget of `-MonthlyBudgetUsd` (default `$5`) emails you when actual spend passes 80% and when forecast spend passes 100%. The budget is account-wide, not limited to Folio's resources. Budget alerts are emailed directly and need no confirmation.

### Costs

For a single household the deployment typically costs a few dollars a month:

- **Baseline, roughly $0-3/month**: Lambda usage for a household fits within or close to the free tier, CloudFront stays within its always-free allowance, and the 5 alarms fit within CloudWatch's 10 free alarms unless your account already uses them (each extra alarm is about $0.10/month).
- **Aurora DSQL**: billed per request in DPUs and per GB-month of storage, with nothing charged while idle. The free tier covers 100,000 DPUs and 1 GB of storage each month, which a household normally stays well inside (50,000 transactions take a few tens of MB). Past it, DPUs cost about $8 per million and storage about $0.33/GB-month (us-east-1 prices; check the ca-central-1 rates). The DPU alarm warns before a month's usage would leave the free tier.
- **AWS Backup**: daily backups kept 14 days, billed per GB-month of backup storage: cents for a household. Turn off with `-EnableBackups:$false`.
- **Secrets Manager, about $0.80/month**: two secrets at about $0.40 each.
- **Closed-year archives**: stored in S3 Glacier Instant Retrieval (about a sixth of the Standard storage price, with a 90-day minimum and 128 KB minimum billable size per object). A year of household transactions is typically well under 1 MB compressed, so archives cost cents per year.
- **Cognito Plus**: billed per monthly active user, roughly $0.02 per MAU at the time of writing. Cognito's free tier applies to the Lite and Essentials tiers, not Plus, so check current Cognito pricing. A `-DisableCognito` deployment has no Cognito cost.
- **Bounded storage**: The ECR lifecycle policy keeps at most 5 images, and logs are kept for 90 days.

### Tearing Down

```powershell
# Interactive: prompts for each retained resource
.\teardown.ps1 -Region ca-central-1 -StackName Folio-QA

# One prompt for everything (the database and archive buckets still require typing their id or name)
.\teardown.ps1 -Region ca-central-1 -StackName Folio-QA -DeleteAll

# No prompts: delete the stack and all stack-associated retained resources
.\teardown.ps1 -Region ca-central-1 -StackName Folio-QA -Force
```

`teardown.ps1` deletes the stack (waiting for the CloudFront distribution to be removed, which can take several minutes) and then offers to delete what the stack leaves behind: the database and its backup vault, the archive bucket, the Cognito user pool, the stack's secrets, the SAM ECR companion stack and images, and legacy log groups. Parameters: `-Region`, `-StackName` (default `folio-prod`), `-Environment`, `-Profile`, `-DeleteAll`, `-Force`, `-SkipVaultBackup`.

- **Database export first**: Before the database is deleted, every table is exported with `python -m app.cli export` to `.\folio-db-backup-<cluster>-<yyyyMMdd-HHmmss>.db.zst` in the current directory (uv is required). If the export fails, the database is kept, even with `-Force`. The backup vault and its recovery points are deleted only together with the database.
- **Archive backup first**: Before an archive bucket is emptied, closed-year archives (`archives/`) are downloaded to `.\folio-vault-backup-<bucket>-<yyyyMMdd-HHmmss>-archives\`, and a `database/folio.db.zst` left by a release that kept the vault in S3 is downloaded beside it. If a download fails, the bucket is kept, even with `-Force`. Pass `-SkipVaultBackup` to skip the exports and downloads on purpose.
- **Typed confirmation**: Deleting the database requires typing its cluster id, and deleting an archive bucket its exact name, including with `-DeleteAll`. Only `-Force` skips this. A database matched only by its `Name` tag, not by the stack, is never deleted by `-DeleteAll` or `-Force`.
- **Reused buckets are protected**: A bucket attached through `ExistingVaultBucketName` predates the stack and is never selected by `-DeleteAll` or `-Force`; it can only be deleted interactively.
- **Cognito user pool**: The stack retains the pool with deletion protection on. When you choose to delete it (or use `-DeleteAll` / `-Force`), the script turns deletion protection off and deletes the pool with all of its users. Users must then be re-invited and re-enrol MFA. A pool matched only by name, not by the stack, is never deleted by `-DeleteAll` or `-Force`.
- **Secrets**: CloudFormation may leave the stack's secrets scheduled for deletion with a recovery window. When chosen, they are force-deleted without recovery. The secrets are unnamed, so a redeploy never collides with them either way.
- The shared SAM CLI deployment bucket (`aws-sam-cli-managed-default-samclisourcebucket-*`) is left untouched.

---

## Backups & Restore

**What exists**:

- **AWS Backup** (AWS only): a daily backup of the database, kept 14 days, in the `folio-<env>-<region>` backup vault.
- **Exports**: `python -m app.cli export <file>.db.zst` writes every table to a compressed SQLite file that opens in any SQLite tool (after decompressing it). `teardown.ps1` writes one before deleting the database. Run one yourself before a risky change.
- **Closed-year archives**: one read-only `folio-<year>-<timestamp>.db.zst` per closing, in `archives/<year>/` in the archive bucket (Glacier Instant Retrieval, never expired) or `backend/data/archives/<year>/` on Docker and local installs. Each closing records the file's SHA-256, which the download returns in the `X-Archive-SHA256` header. These are a record of the year as closed, not a way to roll the database back.

**Export and import** (any install; on AWS, set `DSQL_ENDPOINT` and use credentials allowed `dsql:DbConnectAdmin`):

```powershell
cd backend
uv run python -m app.cli export ..\folio-backup.db.zst   # local Postgres (DATABASE_URL)

$env:DSQL_ENDPOINT = "<DatabaseEndpoint output>"
uv run python -m app.cli export ..\folio-backup.db.zst   # the AWS database, as its admin role

uv run python scripts/vault_zstd.py decompress ..\folio-backup.db.zst ..\folio-backup.db   # open in a SQLite tool
```

`python -m app.cli import <file>.db.zst` loads an export into a freshly migrated database (it replaces the default categories and rules, and refuses a database that already has transactions or other rows). Import before anyone signs in. Use it to restore after a teardown, or to move a household between Docker and AWS.

**Restore from AWS Backup**: AWS Backup restores a recovery point into a **new** cluster (console: AWS Backup > Backup vaults > `folio-<env>-<region>` > the recovery point > Restore). Then either point the app at it, or export from the new cluster and import into the stack's own database:

1. Export from the restored cluster: `$env:DSQL_ENDPOINT = "<restored cluster endpoint>"; uv run python -m app.cli export ..\restore.db.zst`.
2. Empty the stack's database and import. One way is to delete the stack's cluster (`teardown.ps1`, which exports it first), deploy again (a new, empty, migrated database), then run `import` against the new `DatabaseEndpoint` before anyone signs in.

Expect any edit made between the recovery point and now to be lost.

**Restore on Docker**: Stop the app, wipe the database (`.\dev.ps1 -Clean`, or drop and recreate the `public` schema), start the app once so it migrates, stop it, then `uv run python -m app.cli import <file>.db.zst`.

---

## Rolling Back a Deploy

```powershell
.\deploy.ps1 -Environment prod -RollbackToVersion <n>
```

The script lists the function's published versions (marking the one `live` serves), points the `live` alias at version `<n>`, and exits without building or deploying. It prints the command to undo the rollback. The next normal deploy publishes a new version and moves `live` forward again.

- A Lambda version captures its environment variables and settings as well as its image, so rolling back restores that version's configuration too.
- ECR keeps the 5 most recent images, so rollback reaches back about 5 deploys. A version whose image has expired cannot be served.
- **Database migrations are forward-only.** Rolling code back past a migration leaves an older build facing a newer schema. The app logs a warning and serves the database anyway when it sees a revision it does not know, which works when the migration only added columns or tables. If it does not, restore from AWS Backup (see [Backups & Restore](#backups--restore)); edits made since that backup are lost.

---

## Configuration Reference

| Environment Variable | SAM Parameter | Default | Description |
| :--- | :--- | :--- | :--- |
| `FOLIO_ENV` | `EnvironmentName` | `development` (`prod` in SAM) | Runtime mode and resource naming (`[a-z0-9-]`). `prod` or `production` enables production mode, which is always on in AWS Lambda regardless of this value: API docs hidden, CORS closed by default, setup and destructive maintenance endpoints disabled, generated session key refused |
| `FOLIO_DEFAULT_CURRENCY` | — | `CAD` | Default currency for new accounts and transactions |
| — | `EnableCognito` (`-DisableCognito`) | `true` | Provision invite-only AWS Cognito User Pool (Plus tier, threat protection) + TOTP MFA (`false` for Master Passphrase mode) |
| `FOLIO_SECRET_KEY` | — | Random, generated once into `data/.folio_secret_key` | HS256 session signing key for Docker / local installs. Required in production mode when local sign-in is used. Ignored when `FOLIO_SESSION_SECRET_ARN` is set |
| `FOLIO_SESSION_SECRET_ARN` | Set by the template (`FolioSessionSecret`) | `""` | Secrets Manager ARN of the session signing key, read at startup |
| `FOLIO_MASTER_PASSWORD_HASH` | `MasterPasswordHash` (`-MasterPassword`) | `""`, or the hash saved by `/api/auth/setup` | Bcrypt hash of the master passphrase (hashed locally before deploy; `NoEcho` parameter) |
| `FOLIO_ORIGIN_VERIFY_SECRET` | — | `""` | Expected `X-Folio-Origin-Verify` value for Docker behind your own proxy; when set, requests without it get `403`. Ignored when `FOLIO_ORIGIN_SECRET_ARN` is set |
| `FOLIO_ORIGIN_SECRET_ARN` | Set by the template (`FolioOriginSecret`) | `""` | Secrets Manager ARN of the origin-verify value that CloudFront sends |
| `FOLIO_BEDROCK_ENABLED` | `EnableBedrock` (`-EnableBedrock`) | `false` | Enable Tier 4 AWS Bedrock AI auto-classification |
| `FOLIO_BEDROCK_MODEL_ID` | `BedrockModelId` | `amazon.nova-micro-v1:0` | Bedrock model ID or inference profile ID (e.g. `us.amazon.nova-micro-v1:0`) |
| `FOLIO_BEDROCK_REGION` | — | `AWS_DEFAULT_REGION`, else `ca-central-1` | AWS region for Bedrock Converse API calls |
| `FOLIO_CLASSIFICATION_THRESHOLD`| — | `0.75` | Minimum confidence score for automatic category assignment |
| `FOLIO_MAX_UPLOAD_MB` | — (template sets `4`) | `25` | Maximum statement upload size in MB, shown in the upload screen |
| `DATABASE_URL` | — | `postgresql+psycopg://folio:folio@127.0.0.1:5433/folio` | Local and Docker database (PostgreSQL). Ignored when `DSQL_ENDPOINT` is set |
| `DSQL_ENDPOINT` | Set by the template (`FolioDatabase`) | `""` | Aurora DSQL endpoint; the app connects with IAM tokens |
| `DSQL_USER` | Set by the template (`folio_app`) | `folio_app` | Database role the app signs in as on Aurora DSQL |
| — | `EnableBackups` (`-EnableBackups`) | `true` | Daily AWS Backup of the database, kept 14 days |
| — | `DailyDpuAlarmThreshold` | `3000` | Daily database DPU usage that raises the cost alarm |
| `FOLIO_DATA_DIR` | — (template sets `/tmp/folio`) | `backend/data` | Local files: generated session key, master passphrase hash, closed-year archives (Docker / local) |
| `FOLIO_TEST_DATABASE_URL` | — | `postgresql+psycopg://folio:folio@127.0.0.1:5433/folio_test` | Database the backend tests use |
| `FOLIO_UPLOAD_DIR` | — (template sets `/tmp/uploads`) | `backend/data/uploads` | Directory for uploaded statements |
| `COGNITO_USER_POOL_ID` | Output from SAM (`-OwnerEmail` invites users) | `""` | AWS Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | Output from SAM | `""` | AWS Cognito App Client ID |
| `COGNITO_REGION` | `AWS::Region` (`-Region`) | `ca-central-1` | AWS region for Cognito IDP / JWKS verification |
| `FOLIO_OWNER_EMAIL` | `OwnerEmail` (first `-OwnerEmail`) | `""` | This email always signs in as a household owner. Empty: the first person to sign in becomes the owner |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | `AWS::Region` (`-Region`) | `ca-central-1` | AWS region for the database, archives and Secrets Manager |
| `S3_BUCKET_NAME` | `ExistingVaultBucketName` (`-ExistingVaultBucket`) | Auto-created (`folio-vault-<env>-<acct>-<region>`) | Private S3 bucket for closed-year archives (reuse an existing bucket or let SAM create one). Used only on AWS Lambda; ignored by Docker and local installs |
| `FOLIO_CORS_ORIGINS` | `AllowedOrigin` (`-AllowedOrigin`) | `""` | Comma-separated allowed CORS origins. When empty: the localhost dev-server origins in development, and no origins in production mode. The CloudFront deployment is same-origin and needs none |
| — | `ReservedConcurrency` (`-ReservedConcurrency`) | `0` | Optional Lambda reserved concurrency as a spend cap. Requests beyond it get `429`; not needed for data safety |
| — | `AlarmEmail` (`-AlarmEmail`) | `""` | Email for CloudWatch alarm (SNS) and AWS Budgets notifications; confirm the SNS subscription email |
| — | `MonthlyBudgetUsd` (`-MonthlyBudgetUsd`) | `5` | Account-wide monthly cost budget in USD (created only with `AlarmEmail`) |

---

## License

MIT. Copyright (c) 2026 Michael Sanford. See [LICENSE](LICENSE).
