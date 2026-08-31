import React, { useState, useEffect } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { AppLayout } from "./components/layout/AppLayout";
import type { NavTab } from "./components/layout/AppLayout";
import { DashboardView } from "./components/dashboard/DashboardView";
import { IngestionWorkspace } from "./components/ingestion/IngestionWorkspace";
import { LedgerWorkspace } from "./components/ledger/LedgerWorkspace";
import { LoanAmortizationView } from "./components/loans/LoanAmortizationView";
import { InvestmentsView } from "./components/investments/InvestmentsView";
import { BudgetingView } from "./components/budgeting/BudgetingView";
import { RulesManagerView } from "./components/rules/RulesManagerView";
import { AccountsManagerView } from "./components/accounts/AccountsManagerView";
import { LockScreen } from "./components/auth/LockScreen";
import type { Account, Category, DashboardAnalyticsResponse } from "./types";
import { api, setOnUnauthorized } from "./services/api";
import { Landmark, ArrowRight } from "lucide-react";

function AppContent() {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Authentication State
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    auth_required: boolean;
    auth_mode: "cognito" | "master_password" | "unconfigured";
    is_loading: boolean;
  }>({
    authenticated: false,
    auth_required: false,
    auth_mode: "master_password",
    is_loading: true,
  });

  const checkAuth = async () => {
    try {
      const status = await api.auth.getStatus();
      setAuthStatus({
        authenticated: status.authenticated,
        auth_required: status.auth_required,
        auth_mode: status.auth_mode || "master_password",
        is_loading: false,
      });
      if (status.authenticated || !status.auth_required) {
        loadAllData();
      }
    } catch {
      setAuthStatus({
        authenticated: false,
        auth_required: true,
        auth_mode: "master_password",
        is_loading: false,
      });
    }
  };

  const loadAllData = async () => {
    try {
      const [accs, cats, anl] = await Promise.all([
        api.getAccounts(),
        api.getCategories(),
        api.getDashboardAnalytics(),
      ]);
      setAccounts(accs);
      setCategories(cats);
      setAnalytics(anl);
    } catch (err) {
      console.error("Data load error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthStatus((prev) => ({ ...prev, authenticated: false, auth_required: true }));
    });
    checkAuth();
  }, []);

  // Quick starter seeder for initial user demo
  const handleSeedDemoData = async () => {
    try {
      await api.createAccount({
        name: "Chequing",
        type: "CHECKING",
        institution: "RBC",
        account_number_mask: "*1234",
        currency: "CAD",
        current_balance: 4250.0,
      });

      await api.createAccount({
        name: "Visa Infinite",
        type: "CREDIT_CARD",
        institution: "RBC",
        account_number_mask: "*8888",
        currency: "CAD",
        current_balance: -840.5,
        credit_limit: 15000.0,
        interest_rate: 20.99,
      });

      await api.createAccount({
        name: "Home Mortgage",
        type: "MORTGAGE",
        institution: "Desjardins",
        account_number_mask: "*4567",
        currency: "CAD",
        current_balance: 380000.0,
        loan_original_principal: 400000.0,
        interest_rate: 4.79,
        loan_term_months: 300,
        monthly_payment: 2278.0,
        escrow_payment: 375.0,
      });

      await api.createAccount({
        name: "Vehicle Loan",
        type: "VEHICLE_LOAN",
        institution: "Toyota Financial",
        account_number_mask: "*9012",
        currency: "CAD",
        current_balance: 24500.0,
        loan_original_principal: 32000.0,
        interest_rate: 4.99,
        loan_term_months: 60,
        monthly_payment: 603.82,
        escrow_payment: 0.0,
      });

      const demoRules: Array<{
        slug: string;
        pattern: string;
        pattern_type: "CONTAINS" | "STARTS_WITH";
        priority: number;
        normalized_payee_override?: string;
      }> = [
        { slug: "groceries", pattern: "METRO", pattern_type: "CONTAINS", priority: 10, normalized_payee_override: "Metro" },
        { slug: "groceries", pattern: "PROVIGO", pattern_type: "CONTAINS", priority: 10, normalized_payee_override: "Provigo" },
        { slug: "coffee-shops", pattern: "TIM HORTONS", pattern_type: "CONTAINS", priority: 10, normalized_payee_override: "Tim Hortons" },
        { slug: "restaurants", pattern: "ST-HUBERT", pattern_type: "CONTAINS", priority: 10, normalized_payee_override: "St-Hubert" },
        { slug: "fuel", pattern: "PETRO-CANADA", pattern_type: "CONTAINS", priority: 10, normalized_payee_override: "Petro-Canada" },
        { slug: "utilities", pattern: "HYDRO", pattern_type: "STARTS_WITH", priority: 15, normalized_payee_override: "Hydro-Quebec" },
      ];

      for (const rule of demoRules) {
        const category = categories.find((c) => c.slug === rule.slug);
        if (!category) {
          console.warn(`Skipping demo rule for unknown category slug: ${rule.slug}`);
          continue;
        }
        await api.createRule({
          category_id: category.id,
          pattern: rule.pattern,
          pattern_type: rule.pattern_type,
          priority: rule.priority,
          normalized_payee_override: rule.normalized_payee_override,
        });
      }

      await loadAllData();
    } catch (err) {
      console.error("Demo seeding error:", err);
    }
  };

  // Auth Loading
  if (authStatus.is_loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center text-muted">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main mr-3"></div>
        Authenticating session...
      </div>
    );
  }

  // If Auth Required and Unauthenticated -> Render Lock Screen
  if (authStatus.auth_required && !authStatus.authenticated) {
    return <LockScreen onUnlocked={checkAuth} authMode={authStatus.auth_mode} />;
  }

  return (
    <AppLayout
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab)}
      accounts={accounts}
    >
      {/* Empty State Banner if no accounts configured */}
      {accounts.length === 0 && !isLoading && (
        <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-subtle text-accent-subtle">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-main">Welcome to Folio</div>
              <div className="text-xs text-muted mt-0.5">
                Get started by creating your financial accounts or load sample data.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("accounts")}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-default text-sub text-xs font-semibold transition-all"
            >
              Add Custom Account
            </button>
            <button
              onClick={handleSeedDemoData}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs transition-all"
            >
              <span>Load Demo Accounts</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Tab Views */}
      {activeTab === "dashboard" && (
        <DashboardView
          analytics={analytics}
          accounts={accounts}
          onNavigate={(tab) => setActiveTab(tab as NavTab)}
        />
      )}

      {activeTab === "ledger" && (
        <LedgerWorkspace
          accounts={accounts}
          categories={categories}
          onDataModified={loadAllData}
        />
      )}

      {activeTab === "ingestion" && (
        <IngestionWorkspace
          accounts={accounts}
          categories={categories}
          onCommitSuccess={loadAllData}
        />
      )}

      {activeTab === "budgeting" && (
        <BudgetingView categories={categories} onCategoriesModified={loadAllData} />
      )}

      {activeTab === "investments" && (
        <InvestmentsView accounts={accounts} onDataModified={loadAllData} />
      )}

      {activeTab === "loans" && (
        <LoanAmortizationView accounts={accounts} />
      )}

      {activeTab === "rules" && (
        <RulesManagerView categories={categories} />
      )}

      {activeTab === "accounts" && (
        <AccountsManagerView
          accounts={accounts}
          onAccountsModified={loadAllData}
        />
      )}
    </AppLayout>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
