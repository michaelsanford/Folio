import type {
  Account,
  Category,
  CategoryTree,
  Transaction,
  TransactionListResponse,
  CategorizationRule,
  Budget,
  IngestionPreviewResponse,
  AmortizationScheduleResponse,
  LoanSplitSuggestion,
  DashboardAnalyticsResponse,
  HoldingValuation,
  PerformanceResponse,
  PriceQuote,
  AuthStatusResponse,
  CognitoConfigResponse,
} from "../types";

const API_BASE = "/api";

let onUnauthorizedCallback: (() => void) | null = null;
let inMemoryToken: string | null = null;

export function setOnUnauthorized(callback: () => void) {
  onUnauthorizedCallback = callback;
}

export function getStoredToken(): string | null {
  return inMemoryToken;
}

export function setStoredToken(token: string | null) {
  inMemoryToken = token;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...options?.headers,
    },
    ...options,
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    setStoredToken(null);
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      try {
        const errJson = JSON.parse(text);
        errorDetail = errJson.detail || JSON.stringify(errJson);
      } catch {
        errorDetail = text || errorDetail;
      }
    } catch {
      // Keep default status message
    }
    throw new Error(errorDetail);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const api = {
  // Authentication
  auth: {
    getStatus: () =>
      request<AuthStatusResponse>("/auth/status"),
    getCognitoConfig: () =>
      request<CognitoConfigResponse>("/auth/config/cognito"),
    setToken: (token: string | null) => {
      setStoredToken(token);
    },
    login: async (password: string) => {
      const res = await request<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setStoredToken(res.access_token);
      return res;
    },
    logout: async () => {
      try {
        await request<void>("/auth/logout", { method: "POST" });
      } finally {
        setStoredToken(null);
      }
    },
    setup: (password: string) =>
      request<{ message: string }>("/auth/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  },


  // Accounts
  getAccounts: (isActive?: boolean) => {
    const query = isActive !== undefined ? `?is_active=${isActive}` : "";
    return request<Account[]>(`/accounts${query}`);
  },
  createAccount: (account: Partial<Account>) =>
    request<Account>("/accounts", {
      method: "POST",
      body: JSON.stringify(account),
    }),
  updateAccount: (id: string, account: Partial<Account>) =>
    request<Account>(`/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(account),
    }),
  deleteAccount: (id: string) =>
    request<void>(`/accounts/${id}`, { method: "DELETE" }),
  getAmortization: (id: string) =>
    request<AmortizationScheduleResponse>(`/accounts/${id}/amortization`),
  getAmortizationSchedule: (id: string) =>
    request<AmortizationScheduleResponse>(`/accounts/${id}/amortization`),
  getLoanSplitSuggestion: (id: string, paymentAmount?: number) => {
    const query = paymentAmount ? `?payment_amount=${paymentAmount}` : "";
    return request<LoanSplitSuggestion>(
      `/accounts/${id}/suggest-split${query}`
    );
  },

  // Categories
  getCategories: (tree = false) => {
    const query = tree ? "?tree=true" : "";
    return request<Category[] | CategoryTree[]>(`/categories${query}`);
  },
  createCategory: (category: Partial<Category>) =>
    request<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(category),
    }),
  updateCategory: (id: string, category: Partial<Category>) =>
    request<Category>(`/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(category),
    }),
  deleteCategory: (id: string) =>
    request<void>(`/categories/${id}`, { method: "DELETE" }),

  // Transactions & Splits
  getTransactions: (params?: {
    page?: number;
    page_size?: number;
    account_id?: string;
    category_id?: string;
    search?: string;
    start_date?: string;
    end_date?: string;
    is_uncategorized?: boolean;
    min_amount?: number;
    max_amount?: number;
    sort_by?: string;
    sort_order?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append("page", params.page.toString());
    if (params?.page_size) query.append("page_size", params.page_size.toString());
    if (params?.account_id) query.append("account_id", params.account_id);
    if (params?.category_id) query.append("category_id", params.category_id);
    if (params?.search) query.append("search", params.search);
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    if (params?.is_uncategorized !== undefined)
      query.append("is_uncategorized", params.is_uncategorized.toString());
    if (params?.min_amount !== undefined)
      query.append("min_amount", params.min_amount.toString());
    if (params?.max_amount !== undefined)
      query.append("max_amount", params.max_amount.toString());
    if (params?.sort_by) query.append("sort_by", params.sort_by);
    if (params?.sort_order) query.append("sort_order", params.sort_order);

    const queryString = query.toString() ? `?${query.toString()}` : "";
    return request<TransactionListResponse>(`/transactions${queryString}`);
  },
  createTransaction: (txn: Partial<Transaction> & { splits?: any[] }) =>
    request<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify(txn),
    }),
  updateTransaction: (id: string, update: Partial<Transaction>) =>
    request<Transaction>(`/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify(update),
    }),
  deleteTransaction: (id: string) =>
    request<void>(`/transactions/${id}`, { method: "DELETE" }),
  updateSplits: (
    transactionId: string,
    splits: { category_id: string; amount: number; memo?: string }[]
  ) =>
    request<Transaction>(`/transactions/${transactionId}`, {
      method: "PUT",
      body: JSON.stringify({ splits }),
    }),
  batchCategorize: (req: {
    transaction_ids: string[];
    category_id: string;
    normalized_payee?: string;
    create_rule?: boolean;
    rule_pattern?: string;
  }) =>
    request<{ updated_count: number }>("/transactions/batch-categorize", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  linkTransfer: (req: { source_transaction_id: string; target_transaction_id: string }) =>
    request<{ status: string; transaction1: string; transaction2: string }>("/transactions/link-transfer", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // Rules
  getRules: () => request<CategorizationRule[]>("/rules"),
  createRule: (rule: Partial<CategorizationRule>) =>
    request<CategorizationRule>("/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  updateRule: (id: string, rule: Partial<CategorizationRule>) =>
    request<CategorizationRule>(`/rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(rule),
    }),
  deleteRule: (id: string) =>
    request<void>(`/rules/${id}`, { method: "DELETE" }),
  testRule: (params: { raw_payee: string; amount?: number; account_id?: string }) =>
    request<{
      matched: boolean;
      rule_id?: string;
      category_id?: string;
      category_name?: string;
      category_color?: string;
      normalized_payee?: string;
    }>("/rules/test", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  applyRulesBatch: () =>
    request<{ applied_count: number }>("/rules/apply-batch", {
      method: "POST",
    }),

  // Ingestion
  uploadStatementPreview: async (accountId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", accountId);

    const token = getStoredToken();
    const authHeader: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    const res = await fetch(`${API_BASE}/ingestion/upload-preview`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHeader,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(err.detail || "Upload failed");
    }

    return res.json() as Promise<IngestionPreviewResponse>;
  },
  uploadStatement: async (accountId: string, file: File) => {
    return api.uploadStatementPreview(accountId, file);
  },
  commitIngestionBatch: (req: {
    account_id: string;
    statement_file_id?: string;
    items: any[];
  }) =>
    request<{
      committed_count: number;
      account_id: string;
      new_account_balance: number;
    }>("/ingestion/commit", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  commitImport: (req: any) => api.commitIngestionBatch(req),
  deleteStatementFile: (id: string) =>
    request<void>(`/ingestion/statement-files/${id}`, { method: "DELETE" }),
  getStatementFiles: (accountId?: string) => {
    const query = accountId ? `?account_id=${accountId}` : "";
    return request<any[]>(`/ingestion/statement-files${query}`);
  },

  // Budgets
  getCurrentBudget: () =>
    request<Budget>("/budgets/current"),
  getBudget: (year: number, month: number) =>
    request<Budget>(`/budgets/${year}/${month}`),
  createBudget: (budget: Partial<Budget>) =>
    request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(budget),
    }),
  updateBudget: (budgetId: string, budget: Partial<Budget>) =>
    request<Budget>(`/budgets/${budgetId}`, {
      method: "PUT",
      body: JSON.stringify(budget),
    }),
  upsertBudgetItem: (
    year: number,
    month: number,
    item: { category_id: string; planned_amount: number }
  ) =>
    request<Budget>(`/budgets/${year}/${month}/items`, {
      method: "POST",
      body: JSON.stringify(item),
    }),
  deleteBudgetItem: (budgetId: string, categoryId: string) =>
    request<Budget>(`/budgets/${budgetId}/items/${categoryId}`, {
      method: "DELETE",
    }),

  // Analytics & Dashboard
  getDashboardAnalytics: () =>
    request<DashboardAnalyticsResponse>("/analytics/dashboard"),

  // Investments
  getHoldings: (accountId?: string, asOf?: string) => {
    const q = new URLSearchParams();
    if (accountId) q.append("account_id", accountId);
    if (asOf) q.append("as_of", asOf);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return request<HoldingValuation[]>(`/investments/holdings${qs}`);
  },
  createHolding: (payload: {
    account_id: string;
    symbol: string;
    name?: string;
    asset_class?: string;
    lots: { trade_date: string; quantity: string; cost_basis: string; fee?: string }[];
  }) =>
    request<HoldingValuation>("/investments/holdings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteHolding: (id: string) =>
    request<void>(`/investments/holdings/${id}`, { method: "DELETE" }),
  getPerformance: (accountId: string, asOf?: string) => {
    const q = new URLSearchParams({ account_id: accountId });
    if (asOf) q.append("as_of", asOf);
    return request<PerformanceResponse>(`/investments/performance?${q.toString()}`);
  },
  upsertPrices: (quotes: { symbol: string; as_of_date: string; price: string }[]) =>
    request<PriceQuote[]>("/investments/prices/bulk", {
      method: "POST",
      body: JSON.stringify({ quotes }),
    }),
  getPrices: (symbol?: string) =>
    request<PriceQuote[]>(`/investments/prices${symbol ? `?symbol=${symbol}` : ""}`),
  createInvestmentActivity: (payload: {
    account_id: string;
    type: string;
    trade_date: string;
    symbol?: string;
    quantity?: string;
    amount: string;
    fee?: string;
    notes?: string;
  }) =>
    request<unknown>("/investments/activities", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  revalueInvestments: () =>
    request<{ accounts_revalued: number; unpriced_holdings: string[] }>(
      "/investments/revalue",
      { method: "POST" }
    ),

  // Maintenance / backfill for existing installations
  backfillSnapshots: (months = 24) =>
    request<{ snapshots_written: number; months: number }>(
      `/maintenance/backfill-snapshots?months=${months}`,
      { method: "POST" }
    ),
  detectTransfers: (windowDays = 3) =>
    request<{ pairs_linked: number; transactions_scanned: number }>(
      `/maintenance/detect-transfers?window_days=${windowDays}`,
      { method: "POST" }
    ),
};
