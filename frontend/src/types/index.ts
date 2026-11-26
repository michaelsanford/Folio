export type AccountType =
  // Banking / Cash
  | "CHECKING"
  | "SAVINGS"
  | "HISA"
  | "CASH"
  // Registered Accounts (Canada)
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "RESP"
  | "RDSP"
  | "RRIF"
  | "LIRA"
  | "LIF"
  | "IPP"
  // Non-Registered Investments
  | "INVESTMENT"
  | "NON_REGISTERED"
  | "CRYPTO"
  // Credit & Debt / Liabilities
  | "CREDIT_CARD"
  | "LINE_OF_CREDIT"
  | "MORTGAGE"
  | "VEHICLE_LOAN"
  | "STUDENT_LOAN"
  | "PERSONAL_LOAN"
  | "OTHER_LIABILITY"
  // Real & Other Assets
  | "REAL_ESTATE"
  | "VEHICLE_ASSET"
  | "OTHER_ASSET";

export interface Account extends Attributed {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  account_number_mask?: string;
  icon?: string | null;
  color?: string | null;
  currency: string;
  current_balance: number;
  credit_limit?: number;
  interest_rate?: number;
  loan_origination_date?: string;
  loan_term_months?: number | null;
  loan_original_principal?: number | null;
  monthly_payment?: number | null;
  escrow_payment?: number;
  /** Revolving lines only: minimum payment as % of balance; null = interest-only. */
  minimum_payment_percent?: number | null;
  /** Household members who own it (one or more; none means shared). */
  owner_member_ids?: string[];
  owner_names?: string[];
  /** Missing means HOUSEHOLD. */
  visibility?: AccountVisibility;
  /** Someone else's "totals only" account: name, details and transactions withheld. */
  redacted?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Who may see an account: everyone, totals only, or its owners only. */
export type AccountVisibility = "HOUSEHOLD" | "TOTALS" | "PRIVATE";

export type CategoryType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface Category {
  id: string;
  parent_id?: string | null;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  type: CategoryType;
  is_budgeted: boolean;
  is_rollover: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryTree extends Category {
  children: CategoryTree[];
}

export type TransactionStatus = "PENDING" | "CLEARED" | "RECONCILED";

export interface TransactionSplit {
  id?: string;
  category_id?: string | null;
  amount: number;
  memo?: string | null;
  category?: Category;
}

export interface Transaction extends Attributed {
  id: string;
  account_id: string;
  transfer_transaction_id?: string | null;
  statement_file_id?: string | null;
  transaction_date: string;
  posted_date?: string | null;
  raw_payee: string;
  normalized_payee?: string | null;
  amount: number;
  currency: string;
  import_hash?: string | null;
  status: TransactionStatus;
  notes?: string | null;
  assigned_member_id?: string | null;
  assigned_member?: HouseholdMember;
  created_at: string;
  updated_at: string;
  splits: TransactionSplit[];
  confidence_score?: number | null;
  classification_tier?: ClassificationTier;
  classification_reason?: string | null;
}

export type ClassificationTier = "EXPLICIT_RULE" | "USER_HISTORY" | "HEURISTIC" | "BEDROCK_AI" | "UNCLASSIFIED";

export interface ClassificationResult {
  matched: boolean;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  normalized_payee: string;
  confidence: number;
  tier: ClassificationTier;
  reason: string;
  rule_id?: string | null;
}

export interface ClassificationStatus {
  bedrock_enabled: boolean;
  bedrock_model_id: string;
  bedrock_region: string;
  confidence_threshold: number;
  rules_count: number;
  historical_matches_available: boolean;
}

export interface AutoClassifyResult {
  classified_count: number;
  remaining_count: number;
  total_uncategorized?: number;
  updated_count?: number;
  dry_run?: boolean;
}

export interface TransactionListResponse {
  total: number;
  items: Transaction[];
  page: number;
  page_size: number;
}

export interface CategorizationRule {
  id: string;
  category_id: string;
  priority: number;
  pattern_type: RulePatternType;
  pattern: string;
  min_amount?: number | null;
  max_amount?: number | null;
  target_account_id?: string | null;
  normalized_payee_override?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: Category;
}

export type RulePatternType = "EXACT" | "CONTAINS" | "REGEX" | "STARTS_WITH";

export interface BudgetItem {
  id?: string;
  budget_id?: string;
  category_id: string;
  planned_amount: number;
  actual_amount: number;
  remaining_amount: number;
  rollover_amount?: number;
  available_amount?: number;
  category?: Category;
}

export interface Budget {
  id: string;
  year: number;
  month: number;
  total_income_target: number;
  total_expense_target: number;
  total_actual_income: number;
  total_actual_expense: number;
  notes?: string | null;
  items: BudgetItem[];
}

export interface DetectedAccountPreview {
  source_account_key: string;
  suggested_name: string;
  suggested_type: AccountType;
  institution?: string | null;
  account_number_mask?: string | null;
  currency: string;
  raw_account_type?: string | null;
  matched_account_id?: string | null;
  matched_account_name?: string | null;
  transaction_count: number;
  new_count: number;
  duplicates_count: number;
}

export interface ParsedTransactionItem {
  transaction_date: string;
  raw_payee: string;
  normalized_payee: string;
  amount: number;
  currency: string;
  suggested_category_id?: string | null;
  suggested_category_name?: string | null;
  suggested_category_color?: string | null;
  is_duplicate: boolean;
  /** Dated in a closed year: the import skips it. */
  in_closed_period?: boolean;
  import_hash: string;
  notes?: string | null;
  source_account_key?: string | null;
  account_id?: string | null;
  account_label?: string | null;
  potential_transfer_account_id?: string | null;
  potential_transfer_account_name?: string | null;
  confidence_score: number;
  classification_tier?: ClassificationTier;
  classification_reason?: string;
}

export type HoldingStatus = "NEW" | "CHANGED" | "UNCHANGED";

/** One position in a holdings export, compared with what the account holds now. */
export interface HoldingsPositionPreview {
  symbol: string;
  name?: string | null;
  asset_class: string;
  currency: string;
  /** Decimal as a string. */
  quantity: string;
  book_cost: number;
  market_value: number;
  last_price?: number | null;
  previous_close?: number | null;
  status: HoldingStatus;
  current_quantity?: string | null;
  current_book_cost?: number | null;
}

export interface HoldingsCashLine {
  currency: string;
  amount: number;
  rate_to_cad: number;
  rate_to_account: number;
  amount_in_account_currency: number;
}

/** Held in the account but not in the file; removed only when ticked. */
export interface HoldingsMissingPosition {
  holding_id: string;
  symbol: string;
  name?: string | null;
  quantity: string;
  market_value: number;
}

export interface HoldingsComparison {
  account_id?: string | null;
  account_currency: string;
  positions: HoldingsPositionPreview[];
  cash: HoldingsCashLine[];
  cash_total: number;
  missing: HoldingsMissingPosition[];
  /** What Folio will value the account at (prices to the cent). */
  import_total: number;
  /** The broker's own total, when the file has one. */
  file_total?: number | null;
}

export interface HoldingsImportPreview extends HoldingsComparison {
  account: DetectedAccountPreview;
  as_of_date: string;
}

export interface HoldingsCommitPosition {
  symbol: string;
  name?: string | null;
  asset_class: string;
  currency: string;
  quantity: string;
  book_cost: number;
  last_price?: number | null;
  previous_close?: number | null;
  market_value?: number | null;
}

export interface HoldingsCommitResponse {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  created: boolean;
  added_count: number;
  updated_count: number;
  unchanged_count: number;
  removed_count: number;
  cash_total: number;
  new_account_balance: number;
}

export interface IngestionPreviewResponse {
  /** HOLDINGS: a broker holdings export, described by `holdings`. */
  kind?: "TRANSACTIONS" | "HOLDINGS";
  holdings?: HoldingsImportPreview | null;
  file_id?: string | null;
  filename: string;
  file_type: string;
  account_id?: string | null;
  is_multi_account?: boolean;
  detected_accounts?: DetectedAccountPreview[];
  total_parsed: number;
  duplicates_count: number;
  new_count: number;
  items: ParsedTransactionItem[];
  /** Rows skipped because a value (usually the date) could not be read. */
  row_errors?: ParsedRowError[];
}

export interface ParsedRowError {
  row_number?: number | null;
  field: string;
  value?: string | null;
  message: string;
}

export interface IngestionAccountResolution {
  source_account_key: string;
  existing_account_id?: string | null;
  name?: string;
  type: AccountType;
  institution?: string | null;
  account_number_mask?: string | null;
  currency: string;
}

export interface CommittedAccountSummary {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  created: boolean;
  committed_count: number;
  new_account_balance: number;
}

export interface IngestionCommitResponse {
  committed_count: number;
  account_id?: string | null;
  new_account_balance: number;
  accounts_created_count: number;
  accounts: CommittedAccountSummary[];
  transfers_linked_count: number;
  /** Rows dated in a closed year, left out. */
  skipped_closed_count?: number;
}

export interface AmortizationScheduleRow {
  period: number;
  payment_date: string;
  payment: number;
  principal: number;
  interest: number;
  escrow: number;
  total_payment: number;
  remaining_balance: number;
}

export interface AmortizationScheduleResponse {
  account_id: string;
  account_name: string;
  /** Null for a revolving line of credit, which has no original principal. */
  original_principal: number | null;
  current_balance: number;
  interest_rate: number;
  /** Null for a revolving line of credit, which has no maturity. */
  loan_term_months: number | null;
  monthly_payment: number;
  escrow_payment: number;
  total_interest: number;
  total_cost: number;
  payoff_date: string | null;
  schedule: AmortizationScheduleRow[];
  is_revolving?: boolean;
  minimum_payment_percent?: number | null;
}

export interface LoanSplitSuggestion {
  principal_amount: number;
  interest_amount: number;
  escrow_amount: number;
  principal_category_id?: string | null;
  interest_category_id?: string | null;
  escrow_category_id?: string | null;
}

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export interface CategorySpendPoint {
  category_id: string;
  category_name: string;
  category_color: string;
  category_icon?: string | null;
  amount: number;
  percentage: number;
}

export interface CashFlowSummary {
  total_income: number;
  total_expenses: number;
  net_savings: number;
  savings_rate: number;
}

export interface SankeyNode {
  name: string;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface DashboardAnalyticsResponse {
  current_net_worth: number;
  total_assets: number;
  total_liabilities: number;
  monthly_cash_flow: CashFlowSummary;
  net_worth_history: NetWorthPoint[];
  category_spending: CategorySpendPoint[];
  sankey: SankeyData;
}

export interface ServerLimits {
  /** Largest statement upload the server accepts, in megabytes. */
  max_upload_mb: number;
}

/** `GET /api/bootstrap`: everything the shell needs on first load, in one round trip. */
export interface BootstrapResponse {
  accounts: Account[];
  categories: Category[];
  analytics: DashboardAnalyticsResponse;
  household_members: HouseholdMember[];
  limits: ServerLimits;
  /** The signed-in person (absent from older servers). */
  me?: Me;
  /** Everyone who has had a sign-in, to name `created_by` / `updated_by`. */
  people?: PersonSummary[];
  /** Transactions dated up to Dec 31 of this year are locked (a closed year). */
  closed_through_year?: number | null;
  /** The caller's saved appearance settings (== GET /api/me/preferences). */
  preferences?: PreferencesResponse;
}

/** A row of `GET /api/periods`. */
export interface YearClosure {
  year: number;
  closed_through: string;
  closed_at: string;
  closed_by_name?: string | null;
  is_active: boolean;
  reopened_at?: string | null;
  archive_available: boolean;
  archive_bytes?: number | null;
  archive_sha256?: string | null;
  row_counts?: Record<string, number> | null;
}

export interface PeriodsResponse {
  closed_through_year: number | null;
  closures: YearClosure[];
  closable_years: number[];
}

export type PersonRole = "OWNER" | "MEMBER" | "VIEWER";
export type PersonStatus = "INVITED" | "ACTIVE" | "DISABLED";

/** `GET /api/people/me`. */
export interface Me {
  user_key: string;
  email?: string | null;
  display_name?: string | null;
  role: PersonRole;
  member_id?: string | null;
  can_edit: boolean;
  is_owner: boolean;
  /** False with a single passphrase: there is nobody to invite. */
  can_manage_people: boolean;
  /** No name and no household member yet: ask once who they are. */
  needs_welcome?: boolean;
  /** Several people sign in, so accounts can be hidden from each other. */
  shared_household?: boolean;
}

export type Relationship = "Self" | "Partner" | "Dependent" | "Roommate" | "Other";

/** `POST /api/people/add`: a member, and optionally their sign-in. */
export interface PersonAdd {
  name: string;
  relationship: Relationship;
  color?: string | null;
  access: "invite" | "none";
  email?: string | null;
  role?: PersonRole | null;
}

export interface PersonAddResponse {
  member_id: string;
  member_name: string;
  person?: Person | null;
}

export interface PersonSummary {
  user_key: string;
  name: string;
  member_id?: string | null;
}

/** A row of `GET /api/people`. */
export interface Person {
  user_key: string;
  email?: string | null;
  display_name?: string | null;
  role: PersonRole;
  status: PersonStatus;
  member_id?: string | null;
  member_name?: string | null;
  invited_by_name?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  is_me: boolean;
}

export interface PeopleListResponse {
  people: Person[];
  can_manage_people: boolean;
}

/** Who added and last changed a row (user keys). */
export interface Attributed {
  created_by?: string | null;
  updated_by?: string | null;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  auth_required: boolean;
  auth_mode: "cognito" | "master_password" | "unconfigured";
  cognito_enabled: boolean;
}

export interface CognitoConfigResponse {
  enabled: boolean;
  user_pool_id: string;
  client_id: string;
  region: string;
}

export type CognitoChallengeType =
  | "NEW_PASSWORD_REQUIRED"
  | "MFA_SETUP"
  | "SOFTWARE_TOKEN_MFA";

export interface CognitoAuthResponse {
  status: "authenticated" | "challenge";
  challenge?: CognitoChallengeType | null;
  session?: string | null;
  username?: string | null;
  message?: string | null;
  totp_secret?: string | null;
  otpauth_uri?: string | null;
  qr_data_uri?: string | null;
}


// ---------------------------------------------------------------- Investments

export type AssetClass =
  | "EQUITY"
  | "ETF"
  | "MUTUAL_FUND"
  | "FIXED_INCOME"
  | "CASH"
  | "CRYPTO"
  | "OTHER";

export type InvestmentActivityType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "CONTRIBUTION"
  | "WITHDRAWAL"
  | "FEE";

export interface HoldingValuation {
  holding_id: string;
  security_id: string;
  symbol: string;
  name?: string | null;
  asset_class: string;
  quantity: string;
  cost_basis: number;
  market_value: number;
  unrealized_gain: number;
  unrealized_gain_pct: number;
  price?: number | null;
  price_as_of?: string | null;
  /** False when no quote has been entered; the value shown falls back to cost. */
  is_priced: boolean;
  /** MANUAL, or the delayed source: YAHOO or TMX. */
  price_source?: QuoteSource | null;
  /** Trading session of an automated price. */
  price_session?: QuoteSession | null;
  /** Market time of the price (ISO). */
  price_quoted_at?: string | null;
  /** The day's reference price, and the change from it. */
  previous_close?: number | null;
  day_change?: number | null;
  day_change_pct?: number | null;
  /** The exchange listing quotes come from (XEQT.TO for a typed XEQT). */
  quote_symbol?: string | null;
}

/** IMPORT: the last price in an imported holdings export. */
export type QuoteSource = "MANUAL" | "YAHOO" | "TMX" | "IMPORT";
export type QuoteSession = "PRE" | "REGULAR" | "POST";

/** `POST /investments/quotes/fetch-automated`. */
export interface QuoteRefreshResponse {
  updated_count: number;
  failed_count: number;
  quotes: {
    symbol: string;
    listing: string;
    price: number;
    currency: string;
    as_of_date: string;
    source: QuoteSource;
    session: QuoteSession;
    quoted_at: string | null;
    previous_close: number | null;
  }[];
  failed_symbols: string[];
  failures: { symbol: string; reason: string }[];
  usdcad_fx_rate: number | null;
  accounts_revalued: number;
  skipped_count: number;
  skipped_symbols: string[];
  skipped_closed: string[];
  skipped_recent: string[];
  skipped_manual: string[];
  timed_out: boolean;
  refreshed_at: string | null;
}

/** `GET /investments/symbol-lookup`: what a typed symbol resolves to. */
export interface SymbolLookupResponse {
  query: string;
  found: boolean;
  listing?: string | null;
  name?: string | null;
  exchange?: string | null;
  currency?: string | null;
  price?: number | null;
  source?: QuoteSource | null;
  session?: QuoteSession | null;
  reason?: string | null;
}

export interface PeriodReturn {
  money_weighted: number | null;
  time_weighted: number | null;
}

export interface PerformanceResponse {
  account_id: string;
  as_of: string;
  market_value: number;
  cost_basis: number;
  unrealized_gain: number;
  contributions: number;
  withdrawals: number;
  net_invested: number;
  market_growth: number;
  holdings: HoldingValuation[];
  returns: Record<string, PeriodReturn>;
  unpriced_holdings: string[];
}

/** One month-end value of the account's current positions. */
export interface ReturnHistoryPoint {
  month: string;
  value: number;
  /** Fractional monthly return (0.012 = 1.2%); null for the first month. */
  return_pct: number | null;
}

/** `GET /investments/return-history`: the inputs for projecting an account forward. */
export interface ReturnHistoryResponse {
  account_id: string;
  as_of: string;
  points: ReturnHistoryPoint[];
  months_of_history: number;
  /** Null until there are enough months to estimate them. */
  mean_monthly_log_return: number | null;
  stdev_monthly_log_return: number | null;
  annualized_return: number | null;
  annualized_volatility: number | null;
  average_monthly_contribution: number;
}

export interface PriceQuote {
  id: string;
  security_id: string;
  symbol: string;
  as_of_date: string;
  price: number;
}


// ---------------------------------------------------------------- Household & Collaboration

export interface HouseholdMember {
  id: string;
  name: string;
  color?: string | null;
  avatar_icon?: string | null;
  role?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}


// ---------------------------------------------------------------- Goals & Canadian CRA

export type GoalType =
  | "SAVINGS"
  | "EMERGENCY_FUND"
  | "TFSA_ANNUAL"
  | "FHSA_ANNUAL"
  | "HBP_REPAYMENT"
  | "DEBT_PAYOFF";

export interface Goal extends Attributed {
  id: string;
  name: string;
  type: GoalType;
  target_amount: number;
  current_amount: number;
  effective_current_amount: number;
  progress_percentage: number;
  target_date?: string | null;
  emergency_fund_months?: number | null;
  excluded_category_ids?: string[] | null;
  linked_account_id?: string | null;
  owner_member_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  linked_account?: Account;
  owner_member?: HouseholdMember;
}

export interface EmergencyCategoryBreakdown {
  category_id: string;
  category_name: string;
  monthly_average: number;
  is_excluded: boolean;
}

export interface EmergencyFundCalcResponse {
  lookback_months: number;
  months?: number;
  months_selected: number;
  monthly_average_total_expense: number;
  monthly_average_included_expense: number;
  monthly_fixed_expense?: number;
  suggested_target_amount: number;
  suggested_target?: number;
  total_spent_in_period?: number;
  excluded_category_ids: string[];
  category_breakdown: EmergencyCategoryBreakdown[];
  categories?: EmergencyCategoryBreakdown[];
}

export interface CraLimitInfo {
  account_type: string;
  annual_limit: number;
  year_to_date_contributions: number;
  remaining_annual_room: number;
  is_over_limit: boolean;
  lifetime_limit?: number | null;
  total_lifetime_contributions?: number | null;
  notes: string;
  owner_member_id?: string | null;
  owner_member_name?: string | null;
}

export interface CraSummaryResponse {
  year?: number;
  tax_year: number;
  tfsa_annual_limit: number;
  fhsa_annual_limit: number;
  fhsa_lifetime_limit: number;
  tfsa_contributed: number;
  tfsa_remaining_room: number;
  fhsa_contributed: number;
  fhsa_remaining_room: number;
  notes: string;
  limits?: CraLimitInfo[];
}


// ---------------------------------------------------------------- Cash Flow Forecast

export interface ForecastEvent {
  date: string;
  amount: number;
  description: string;
  event_type: "INCOME" | "MORTGAGE" | "LOAN" | "EXPENSE";
  account_name?: string | null;
}

export interface ForecastDataPoint {
  date: string;
  cash_balance: number;
  projected_income: number;
  projected_expense: number;
  net_change: number;
  events: string[];
}

export interface CashFlowForecastResponse {
  start_date: string;
  end_date: string;
  starting_cash: number;
  ending_cash: number;
  lowest_cash_point: number;
  lowest_cash_date: string;
  daily_curve: ForecastDataPoint[];
  scheduled_events: ForecastEvent[];
}

/** Number format as stored server side (snake_case mirror of NumberFormatPrefs). */
export interface NumberFormatPreferences {
  preset: "en-CA" | "fr-CA" | "accounting" | "custom";
  negative_style: "minus" | "parentheses";
  /** The space option is a no-break space (U+00A0). */
  group_separator: "," | "." | " " | "'" | "";
  decimal_separator: "." | ",";
  symbol_position: "before" | "after";
  symbol_space: boolean;
}

/** Appearance settings kept with the user's profile (GET/PUT /me/preferences). */
export interface UiPreferences {
  theme?: string;
  color_mode?: "light" | "dark" | "system";
  type_style?: string;
  number_format?: NumberFormatPreferences;
  sidebar_collapsed?: boolean;
  /** Accounts the dashboard leaves out of every figure. */
  dashboard_hidden_account_ids?: string[];
}

export interface PreferencesResponse {
  preferences: UiPreferences;
  updated_at: string | null;
}
