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
import { GoalsView } from "./components/goals/GoalsView";
import { RulesManagerView } from "./components/rules/RulesManagerView";
import { AccountsManagerView } from "./components/accounts/AccountsManagerView";
import { HouseholdModal } from "./components/household/HouseholdModal";
import { LockScreen } from "./components/auth/LockScreen";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import type { Account, Category, DashboardAnalyticsResponse, HouseholdMember } from "./types";
import { api, setOnUnauthorized } from "./services/api";
import { Landmark, ArrowRight } from "lucide-react";

function AppContent() {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHouseholdModalOpen, setIsHouseholdModalOpen] = useState(false);

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
      const [accs, cats, anl, members] = await Promise.all([
        api.getAccounts(),
        api.getCategories(),
        api.getDashboardAnalytics(),
        api.household.getMembers(),
      ]);
      setAccounts(accs);
      setCategories(cats);
      setAnalytics(anl);
      setHouseholdMembers(members);
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

  // Quick starter seeder for initial Canadian user demo with complete ledger history
  const handleSeedDemoData = async () => {
    try {
      setIsLoading(true);
      await api.seedDemoData(true);
      await loadAllData();
    } catch (err) {
      console.error("Demo seeding error:", err);
    } finally {
      setIsLoading(false);
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
      householdMembers={householdMembers}
      onManageHousehold={() => setIsHouseholdModalOpen(true)}
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
                Get started by creating your financial accounts or load sample Canadian data.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("accounts")}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-default text-sub text-xs font-semibold transition-all cursor-pointer"
            >
              Add Custom Account
            </button>
            <button
              onClick={handleSeedDemoData}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <span>Load Canadian Demo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Tab Views */}
      <ErrorBoundary key={activeTab} fallbackTitle={`Error loading ${activeTab} view`}>
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
          householdMembers={householdMembers}
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

      {activeTab === "goals" && (
        <GoalsView
          accounts={accounts}
          categories={categories}
          householdMembers={householdMembers}
          onDataModified={loadAllData}
        />
      )}

      {activeTab === "investments" && (
        <InvestmentsView accounts={accounts} onDataModified={loadAllData} />
      )}

      {activeTab === "loans" && (
        <LoanAmortizationView accounts={accounts} />
      )}

      {activeTab === "rules" && (
        <RulesManagerView
          categories={categories}
          accounts={accounts}
          onDataModified={loadAllData}
        />
      )}

      {activeTab === "accounts" && (
        <AccountsManagerView
          accounts={accounts}
          householdMembers={householdMembers}
          onAccountsModified={loadAllData}
          onManageHousehold={() => setIsHouseholdModalOpen(true)}
        />
      )}
      </ErrorBoundary>

      {/* Household Management Modal */}
      <HouseholdModal
        isOpen={isHouseholdModalOpen}
        onClose={() => setIsHouseholdModalOpen(false)}
        members={householdMembers}
        onMembersModified={loadAllData}
      />
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
