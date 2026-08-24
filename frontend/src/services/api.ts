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
const TOKEN_KEY = "folio_access_token";

let onUnauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorized(callback: () => void) {
  onUnauthorizedCallback = callback;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const res = await fetch(`${API_BASE}${path}`, {
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
      request<{ authenticated: boolean; auth_required: boolean }>("/auth/status"),
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
      `/accounts/${id}/loan-split${query}`
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
    if (params?.sort_by) query.append("sort_by", params.sort_by);
    if (params?.sort_order) query.append("sort_order", params.sort_order);

    const queryString = query.toString() ? `?${query.toString()}` : "";
    return request<TransactionListResponse>(`/transactions${queryString}`);
  },
  updateTransaction: (id: string, update: Partial<Transaction>) =>
    request<Transaction>(`/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify(update),
    }),
  updateSplits: (
    transactionId: string,
    splits: { category_id: string; amount: number; notes?: string }[]
  ) =>
    request<Transaction>(`/transactions/${transactionId}/splits`, {
      method: "POST",
      body: JSON.stringify(splits),
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
  testRule: (params: { payee: string; amount?: number }) =>
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
  uploadStatement: async (accountId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("account_id", accountId);

    const token = getStoredToken();
    const authHeader: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    const res = await fetch(`${API_BASE}/ingestion/upload`, {
      method: "POST",
      headers: authHeader,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(err.detail || "Upload failed");
    }

    return res.json() as Promise<IngestionPreviewResponse>;
  },
  commitImport: (items: any[]) =>
    request<{
      imported_count: number;
      duplicates_skipped: number;
      account_id: string;
    }>("/ingestion/commit", {
      method: "POST",
      body: JSON.stringify(items),
    }),

  // Budgets
  getBudget: (year: number, month: number) =>
    request<Budget>(`/budgets/${year}/${month}`),
  upsertBudgetItem: (
    year: number,
    month: number,
    item: { category_id: string; planned_amount: number }
  ) =>
    request<Budget>(`/budgets/${year}/${month}/items`, {
      method: "POST",
      body: JSON.stringify(item),
    }),

  // Analytics & Dashboard
  getDashboardAnalytics: () =>
    request<DashboardAnalyticsResponse>("/analytics/dashboard"),
};
