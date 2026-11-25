import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { AppLayout } from "./components/layout/AppLayout";
import type { NavTab } from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { NotificationRegion } from "./components/common/NotificationRegion";
import type { LedgerRefreshScope } from "./components/ledger/LedgerWorkspace";
import type { Account, Category, DashboardAnalyticsResponse, HouseholdMember, ServerLimits } from "./types";
import { api, setOnUnauthorized } from "./services/api";
import { onVaultConflict } from "./services/notifications";
import { ArrowRight } from "lucide-react";
import { usePwaUpdate } from "./hooks/usePwaUpdate";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { useHiddenAccounts } from "./hooks/useHiddenAccounts";
import { setHiddenAccounts } from "./utils/dashboardFilter";
import { takeInitialView } from "./utils/initialView";
import { clearSession, setSession } from "./utils/session";
import { useCanEdit } from "./hooks/useSession";

// Each view is its own chunk, so the first paint only downloads the shell and
// the view the user is looking at.
const DashboardView = lazy(() =>
  import("./components/dashboard/DashboardView").then((m) => ({ default: m.DashboardView }))
);
const IngestionWorkspace = lazy(() =>
  import("./components/ingestion/IngestionWorkspace").then((m) => ({ default: m.IngestionWorkspace }))
);
const LedgerWorkspace = lazy(() =>
  import("./components/ledger/LedgerWorkspace").then((m) => ({ default: m.LedgerWorkspace }))
);
const LoanAmortizationView = lazy(() =>
  import("./components/loans/LoanAmortizationView").then((m) => ({ default: m.LoanAmortizationView }))
);
const InvestmentsView = lazy(() =>
  import("./components/investments/InvestmentsView").then((m) => ({ default: m.InvestmentsView }))
);
const BudgetingView = lazy(() =>
  import("./components/budgeting/BudgetingView").then((m) => ({ default: m.BudgetingView }))
);
const GoalsView = lazy(() =>
  import("./components/goals/GoalsView").then((m) => ({ default: m.GoalsView }))
);
const RulesManagerView = lazy(() =>
  import("./components/rules/RulesManagerView").then((m) => ({ default: m.RulesManagerView }))
);
const AccountsManagerView = lazy(() =>
  import("./components/accounts/AccountsManagerView").then((m) => ({ default: m.AccountsManagerView }))
);
const HouseholdModal = lazy(() =>
  import("./components/household/HouseholdModal").then((m) => ({ default: m.HouseholdModal }))
);
const LockScreen = lazy(() =>
  import("./components/auth/LockScreen").then((m) => ({ default: m.LockScreen }))
);

/** Used when the server does not report a limit (matches the backend default). */
const DEFAULT_LIMITS: ServerLimits = { max_upload_mb: 25 };

const Spinner: React.FC = () => (
  <div className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--border-default)] border-t-[var(--accent-primary)]"></div>
);

const ViewFallback: React.FC = () => (
  <div role="status" className="py-16 flex items-center justify-center gap-3 text-sm text-muted">
    <Spinner />
    Loading…
  </div>
);

function AppContent() {
  const [activeTab, setActiveTab] = useState<NavTab>(takeInitialView);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isHouseholdModalOpen, setIsHouseholdModalOpen] = useState(false);
  const [limits, setLimits] = useState<ServerLimits>(DEFAULT_LIMITS);
  // Set after edits that change analytics; the dashboard refetches when next shown.
  const [isAnalyticsStale, setIsAnalyticsStale] = useState(false);
  // Accounts the dashboard leaves out; read through a ref so loaders stay stable.
  const hiddenAccounts = useHiddenAccounts();
  const hiddenRef = useRef(hiddenAccounts);
  hiddenRef.current = hiddenAccounts;

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

  const { updateReady, applyUpdate } = usePwaUpdate();
  const canEdit = useCanEdit();
  // Appearance settings follow the signed-in user (stored in their profile).
  usePreferencesSync(!authStatus.is_loading && authStatus.authenticated);
  const isLocked = !authStatus.is_loading && authStatus.auth_required && !authStatus.authenticated;
  // On the lock screen there is nothing to lose, so take a waiting update at
  // once: nobody signs in to an outdated build.
  useEffect(() => {
    if (updateReady && isLocked) applyUpdate();
  }, [updateReady, isLocked, applyUpdate]);

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

  const loadAllData = useCallback(async () => {
    try {
      const data = await api.getBootstrap(hiddenRef.current);
      setAccounts(data.accounts);
      setCategories(data.categories);
      setAnalytics(data.analytics);
      setHouseholdMembers(data.household_members);
      setLimits({ ...DEFAULT_LIMITS, ...data.limits });
      setSession(data.me, data.people);
      setIsAnalyticsStale(false);
    } catch (err) {
      console.error("Data load error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * After a ledger edit only balances (accounts) change for the views that are
   * on screen. Categories and members are untouched, and analytics are fetched
   * lazily the next time the dashboard is shown.
   */
  const refreshAfterLedgerEdit = useCallback(
    async (scope: LedgerRefreshScope = "transactions") => {
      if (scope === "all") {
        await loadAllData();
        return;
      }
      setIsAnalyticsStale(true);
      try {
        setAccounts(await api.getAccounts());
      } catch (err) {
        console.error("Balance refresh error:", err);
      }
    },
    [loadAllData]
  );

  // A changed selection makes the figures stale; a short pause lets quick
  // chip taps settle into one request.
  const hiddenKey = hiddenAccounts.join(",");
  const [analyticsKey, setAnalyticsKey] = useState(hiddenKey);
  useEffect(() => {
    if (hiddenKey === analyticsKey) return;
    const timer = window.setTimeout(() => {
      setAnalyticsKey(hiddenKey);
      setIsAnalyticsStale(true);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hiddenKey, analyticsKey]);

  useEffect(() => {
    if (activeTab !== "dashboard" || !isAnalyticsStale) return;
    let cancelled = false;
    api
      .getDashboardAnalytics(hiddenRef.current)
      .then((anl) => {
        if (cancelled) return;
        setAnalytics(anl);
        setIsAnalyticsStale(false);
      })
      .catch((err) => console.error("Analytics refresh error:", err));
    return () => {
      cancelled = true;
    };
    // analyticsKey: a newer selection restarts the fetch and drops the older reply.
  }, [activeTab, isAnalyticsStale, analyticsKey]);

  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthStatus((prev) => ({ ...prev, authenticated: false, auth_required: true }));
    });
    checkAuth();
  }, []);

  // The server has already reloaded the vault; bring every dataset up to date.
  useEffect(() => onVaultConflict(() => void loadAllData()), [loadAllData]);

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

  const handleSignOut = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Clear local session state even if server logout fails
    }
    setAccounts([]);
    setCategories([]);
    setHouseholdMembers([]);
    setAnalytics(null);
    clearSession();
    setAuthStatus((prev) => ({
      ...prev,
      authenticated: false,
      auth_required: true,
    }));
  };

  // Auth Loading
  if (authStatus.is_loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center gap-3 text-sm text-muted">
        <Spinner />
        Checking session…
      </div>
    );
  }

  // If Auth Required and Unauthenticated -> Render Lock Screen
  if (authStatus.auth_required && !authStatus.authenticated) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-canvas flex items-center justify-center gap-3 text-sm text-muted">
            <Spinner />
            Loading…
          </div>
        }
      >
        <LockScreen onUnlocked={checkAuth} authMode={authStatus.auth_mode} />
      </Suspense>
    );
  }

  return (
    <AppLayout
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab)}
      accounts={accounts}
      householdMembers={householdMembers}
      onManageHousehold={() => setIsHouseholdModalOpen(true)}
      onSignOut={authStatus.auth_required ? handleSignOut : undefined}
      updateReady={updateReady}
      onApplyUpdate={applyUpdate}
    >
      {!canEdit && (
        <div role="status" className="mb-4 px-4 py-2.5 rounded-lg bg-surface-subtle text-xs text-sub">
          You have view-only access to this household. Ask an owner if you need to make changes.
        </div>
      )}

      {/* Empty State Banner if no accounts configured */}
      {accounts.length === 0 && !isLoading && canEdit && activeTab !== "ingestion" && (
        <div className="mb-6 p-5 rounded-xl bg-surface border border-default flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="text-base font-medium text-main">Welcome to Folio</div>
            <div className="text-sm text-muted mt-1">
              Import a bank statement to create accounts automatically, add accounts manually, or load sample Canadian data
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab("ingestion")}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
            >
              Import statement
            </button>
            <button
              onClick={() => setActiveTab("accounts")}
              className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
            >
              Add account
            </button>
            <button
              onClick={handleSeedDemoData}
              className="flex-1 sm:flex-none h-9 px-4 flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
            >
              <span>Load demo data</span>
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Tab Views */}
      <ErrorBoundary key={activeTab} fallbackTitle={`Error loading ${activeTab} view`}>
        <Suspense fallback={<ViewFallback />}>
        {activeTab === "dashboard" && (
        <DashboardView
          analytics={analytics}
          accounts={accounts}
          onNavigate={(tab) => setActiveTab(tab as NavTab)}
          hiddenAccountIds={hiddenAccounts}
          onHiddenAccountsChange={setHiddenAccounts}
        />
      )}

      {activeTab === "ledger" && (
        <LedgerWorkspace
          accounts={accounts}
          categories={categories}
          householdMembers={householdMembers}
          onDataModified={refreshAfterLedgerEdit}
        />
      )}

      {activeTab === "ingestion" && (
        <IngestionWorkspace
          accounts={accounts}
          categories={categories}
          onCommitSuccess={loadAllData}
          maxUploadMb={limits.max_upload_mb}
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
        </Suspense>
      </ErrorBoundary>

      {/* Household Management Modal: mounted only while open so its chunk loads on demand */}
      {isHouseholdModalOpen && (
        <Suspense fallback={null}>
          <HouseholdModal
            isOpen={isHouseholdModalOpen}
            onClose={() => setIsHouseholdModalOpen(false)}
            members={householdMembers}
            onMembersModified={loadAllData}
          />
        </Suspense>
      )}

      <NotificationRegion />
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
