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

export interface Account {
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
  loan_term_months?: number;
  loan_original_principal?: number;
  monthly_payment?: number;
  escrow_payment?: number;
  owner_member_id?: string | null;
  owner_member?: HouseholdMember;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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

export interface Transaction {
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
  import_hash: string;
  potential_transfer_account_id?: string | null;
  potential_transfer_account_name?: string | null;
  confidence_score: number;
  classification_tier?: ClassificationTier;
  classification_reason?: string;
}

export interface IngestionPreviewResponse {
  file_id?: string | null;
  filename: string;
  file_type: string;
  account_id: string;
  total_parsed: number;
  duplicates_count: number;
  new_count: number;
  items: ParsedTransactionItem[];
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
  original_principal: number;
  current_balance: number;
  interest_rate: number;
  loan_term_months: number;
  monthly_payment: number;
  escrow_payment: number;
  total_interest: number;
  total_cost: number;
  payoff_date: string;
  schedule: AmortizationScheduleRow[];
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

export interface Goal {
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
