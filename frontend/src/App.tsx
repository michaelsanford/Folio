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
import type { Account, Category, DashboardAnalyticsResponse } from "./types";
import { api } from "./services/api";
import { Sparkles } from "lucide-react";

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab | "accounts">("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    loadAllData();
  }, []);

  // Quick starter seeder for initial user demo
  const handleSeedDemoData = async () => {
    try {
      // Create Checking
      const chk = await api.createAccount({
        name: "Main Checking",
        type: "CHECKING",
        institution: "Chase",
        account_number_mask: "*1234",
        current_balance: 4250.0,
      });

      // Create Credit Card
      const cc = await api.createAccount({
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
        name: "Auto Loan",
        type: "VEHICLE_LOAN",
        institution: "Credit Union",
        account_number_mask: "*9012",
        current_balance: 24500.0,
        loan_original_principal: 320000.0,
        interest_rate: 4.75,
        loan_term_months: 60,
        monthly_payment: 599.5,
        escrow_payment: 0.0,
      });

      // Add sample transactions
      const nowIso = new Date().toISOString();
      await api.createTransaction({
        account_id: chk.id,
        transaction_date: nowIso,
        raw_payee: "PAYROLL DIRECT DEPOSIT ACME CORP",
        normalized_payee: "Acme Corp Payroll",
        amount: 3850.0,
      });

      await api.createTransaction({
        account_id: chk.id,
        transaction_date: nowIso,
        raw_payee: "WHOLEFDS MKT #10293",
        normalized_payee: "Whole Foods",
        amount: -145.2,
      });

      await api.createTransaction({
        account_id: cc.id,
        transaction_date: nowIso,
        raw_payee: "AMZN MKTP US*1A2B3C",
        normalized_payee: "Amazon",
        amount: -89.99,
      });

      await loadAllData();
    } catch (err: any) {
      alert(`Seeding failed: ${err.message}`);
    }
  };

  return (
    <AppLayout
      activeTab={activeTab as NavTab}
      onTabChange={(tab) => setActiveTab(tab)}
      accounts={accounts}
    >
      {/* Empty State Banner if no accounts */}
      {accounts.length === 0 && !isLoading && (
        <div className="mb-6 p-6 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-600/30 text-indigo-300">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Welcome to Folio!</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Get started by creating your financial accounts, or generate demo accounts with mortgage & credit cards.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
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
