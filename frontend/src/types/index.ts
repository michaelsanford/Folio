export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "MORTGAGE"
  | "VEHICLE_LOAN"
  | "INVESTMENT"
  | "OTHER_ASSET"
  | "OTHER_LIABILITY";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  account_number_mask?: string;
  currency: string;
  current_balance: number;
  credit_limit?: number;
  interest_rate?: number;
  loan_origination_date?: string;
  loan_term_months?: number;
  loan_original_principal?: number;
  monthly_payment?: number;
  escrow_payment?: number;
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
  created_at: string;
  updated_at: string;
  splits: TransactionSplit[];
}

export interface TransactionListResponse {
  total: number;
  items: Transaction[];
  page: number;
  page_size: number;
}

export type RulePatternType = "EXACT" | "CONTAINS" | "REGEX" | "STARTS_WITH";

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

export interface BudgetItem {
  id?: string;
  budget_id?: string;
  category_id: string;
  planned_amount: number;
  actual_amount: number;
  remaining_amount: number;
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

