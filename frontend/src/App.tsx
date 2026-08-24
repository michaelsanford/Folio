import React, { useState, useEffect } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import type { NavTab } from "./components/layout/AppLayout";
import { DashboardView } from "./components/dashboard/DashboardView";
import { IngestionWorkspace } from "./components/ingestion/IngestionWorkspace";
import { LedgerWorkspace } from "./components/ledger/LedgerWorkspace";
import { LoanAmortizationView } from "./components/loans/LoanAmortizationView";
import { BudgetingView } from "./components/budgeting/BudgetingView";
import { RulesManagerView } from "./components/rules/RulesManagerView";
import { AccountsManagerView } from "./components/accounts/AccountsManagerView";
import { LockScreen } from "./components/auth/LockScreen";
import type { Account, Category, DashboardAnalyticsResponse } from "./types";
import { api, setOnUnauthorized } from "./services/api";
import { Sparkles } from "lucide-react";

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab | "accounts">("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Authentication State
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    auth_required: boolean;
    is_loading: boolean;
  }>({
    authenticated: false,
    auth_required: false,
    is_loading: true,
  });

  const checkAuth = async () => {
    try {
      const status = await api.auth.getStatus();
      setAuthStatus({
        authenticated: status.authenticated,
        auth_required: status.auth_required,
        is_loading: false,
      });
      if (status.authenticated || !status.auth_required) {
        loadAllData();
      }
    } catch {
      setAuthStatus({
        authenticated: false,
        auth_required: true,
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
      // Create Checking
      await api.createAccount({
        name: "Main Checking",
        type: "CHECKING",
        institution: "Chase",
        account_number_mask: "*1234",
        current_balance: 4250.0,
      });

      // Create Credit Card
      await api.createAccount({
        name: "Sapphire Reserve",
        type: "CREDIT_CARD",
        institution: "Chase",
        account_number_mask: "*8888",
        current_balance: -840.5,
        credit_limit: 15000.0,
        interest_rate: 21.99,
      });

      // Create Home Mortgage
      await api.createAccount({
        name: "Home Mortgage",
        type: "MORTGAGE",
        institution: "Wells Fargo",
        account_number_mask: "*4567",
        current_balance: 380000.0,
        loan_original_principal: 400000.0,
        interest_rate: 6.25,
        loan_term_months: 360,
        monthly_payment: 2462.82,
        escrow_payment: 475.0,
      });

      // Create Vehicle Loan
      await api.createAccount({
        name: "Vehicle Auto Loan",
        type: "VEHICLE_LOAN",
        institution: "Toyota Financial",
        account_number_mask: "*9012",
        current_balance: 24500.0,
        loan_original_principal: 32000.0,
        interest_rate: 4.99,
        loan_term_months: 60,
        monthly_payment: 603.82,
        escrow_payment: 0.0,
      });

      // Seed Initial Categorization Rules
      await api.createRule({
        category_id: categories.find((c) => c.slug === "coffee")?.id || "",
        pattern: "STARBUCKS",
        pattern_type: "CONTAINS",
        priority: 10,
        normalized_payee_override: "Starbucks Coffee",
      });

      await api.createRule({
        category_id: categories.find((c) => c.slug === "groceries")?.id || "",
        pattern: "WHOLEFDS",
        pattern_type: "STARTS_WITH",
        priority: 10,
        normalized_payee_override: "Whole Foods Market",
      });

      await api.createRule({
        category_id: categories.find((c) => c.slug === "groceries")?.id || "",
        pattern: "TRADER JOE",
        pattern_type: "CONTAINS",
        priority: 10,
        normalized_payee_override: "Trader Joe's",
      });

      await api.createRule({
        category_id: categories.find((c) => c.slug === "restaurants")?.id || "",
        pattern: "CHIPOTLE",
        pattern_type: "CONTAINS",
        priority: 10,
        normalized_payee_override: "Chipotle Mexican Grill",
      });

      await api.createRule({
        category_id: categories.find((c) => c.slug === "mortgage-principal")?.id || "",
        pattern: "WELLS FARGO MORTGAGE",
        pattern_type: "CONTAINS",
        priority: 20,
      });

      await loadAllData();
    } catch (err) {
      console.error("Demo seeding error:", err);
    }
  };

  // Auth Loading
  if (authStatus.is_loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mr-3"></div>
        Authenticating session...
      </div>
    );
  }

  // If Auth Required and Unauthenticated -> Render Lock Screen
  if (authStatus.auth_required && !authStatus.authenticated) {
    return <LockScreen onUnlocked={checkAuth} />;
  }

  return (
    <AppLayout
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab)}
      accounts={accounts}
    >
      {/* Empty State Banner if no accounts configured */}
      {accounts.length === 0 && !isLoading && (
        <div className="mb-6 p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">Welcome to Folio!</div>
              <div className="text-xs text-slate-400">
                Get started by creating your bank accounts or load standard demo accounts.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("accounts")}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Add Custom Account
            </button>
            <button
              onClick={handleSeedDemoData}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20"
            >
              Load Demo Accounts
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Tab Views */}
      {activeTab === "dashboard" && (
        <DashboardView
          analytics={analytics}
          accounts={accounts}
          onNavigate={(tab) => setActiveTab(tab as any)}
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
        <BudgetingView categories={categories} />
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

export default App;
