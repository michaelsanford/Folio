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
} from "../types";

const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

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
  getLoanSplitSuggestion: (id: string, paymentAmount?: number) => {
    const query = paymentAmount ? `?payment_amount=${paymentAmount}` : "";
    return request<LoanSplitSuggestion>(`/accounts/${id}/suggest-split${query}`);
  },

  // Categories
  getCategories: () => request<Category[]>("/categories"),
  getCategoryTree: () => request<CategoryTree[]>("/categories/tree"),
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

  // Transactions
  getTransactions: (params: {
    account_id?: string;
    category_id?: string;
    search?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params.account_id) searchParams.append("account_id", params.account_id);
    if (params.category_id) searchParams.append("category_id", params.category_id);
    if (params.search) searchParams.append("search", params.search);
    if (params.page) searchParams.append("page", params.page.toString());
    if (params.page_size) searchParams.append("page_size", params.page_size.toString());
    if (params.sort_by) searchParams.append("sort_by", params.sort_by);
    if (params.sort_order) searchParams.append("sort_order", params.sort_order);

    return request<TransactionListResponse>(`/transactions?${searchParams.toString()}`);
  },
  createTransaction: (txn: Partial<Transaction>) =>
    request<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify(txn),
    }),
  updateTransaction: (id: string, txn: Partial<Transaction>) =>
    request<Transaction>(`/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify(txn),
    }),
  deleteTransaction: (id: string) =>
    request<void>(`/transactions/${id}`, { method: "DELETE" }),
  batchCategorize: (data: {
    transaction_ids: string[];
    category_id: string;
    normalized_payee?: string;
    create_rule?: boolean;
    rule_pattern?: string;
  }) =>
    request<{ updated_count: number }>("/transactions/batch-categorize", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  linkTransfer: (source_transaction_id: string, target_transaction_id: string) =>
    request<{ status: string }>("/transactions/link-transfer", {
      method: "POST",
      body: JSON.stringify({ source_transaction_id, target_transaction_id }),
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
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: "DELETE" }),
  testRule: (data: { raw_payee: string; amount: number; account_id?: string }) =>
    request<{
      matched: boolean;
      matched_rule?: CategorizationRule;
      suggested_category_id?: string;
      suggested_payee?: string;
    }>("/rules/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Budgets
  getCurrentBudget: () => request<Budget>("/budgets/current"),
  getBudget: (year: number, month: number) =>
    request<Budget>(`/budgets/${year}/${month}`),
  updateBudget: (id: string, data: Partial<Budget>) =>
    request<Budget>(`/budgets/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Ingestion
  uploadStatementPreview: async (
    accountId: string,
    file: File
  ): Promise<IngestionPreviewResponse> => {
    const formData = new FormData();
    formData.append("account_id", accountId);
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/ingestion/upload-preview`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return res.json();
  },
  commitIngestionBatch: (data: {
    account_id: string;
    statement_file_id?: string | null;
    items: Array<{
      transaction_date: string;
      raw_payee: string;
      normalized_payee: string;
      amount: number;
      category_id?: string | null;
      notes?: string | null;
      import_hash: string;
    }>;
  }) =>
    request<{ committed_count: number; account_id: string; new_account_balance: number }>(
      "/ingestion/commit",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Analytics
  getDashboardAnalytics: (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.append("year", year.toString());
    if (month) params.append("month", month.toString());
    return request<DashboardAnalyticsResponse>(
      `/analytics/dashboard?${params.toString()}`
    );
  },
};
