import React from "react";
import {
  LayoutDashboard,
  ReceiptText,
  UploadCloud,
  PiggyBank,
  Landmark,
  Sliders,
  Wallet,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import type { Account } from "../../types";

export type NavTab =
  | "dashboard"
  | "ledger"
  | "ingestion"
  | "budgeting"
  | "loans"
  | "rules";

interface AppLayoutProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  accounts: Account[];
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onTabChange,
  accounts,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const totalAssets = accounts
    .filter((a) => ["CHECKING", "SAVINGS", "INVESTMENT", "OTHER_ASSET"].includes(a.type))
    .reduce((sum, a) => sum + a.current_balance, 0);

  const totalLiabilities = accounts
    .filter((a) => ["CREDIT_CARD", "MORTGAGE", "VEHICLE_LOAN", "OTHER_LIABILITY"].includes(a.type))
    .reduce((sum, a) => sum + Math.abs(a.current_balance), 0);

  const netWorth = totalAssets - totalLiabilities;

  const navItems = [
    { id: "dashboard" as NavTab, label: "Dashboard", icon: LayoutDashboard },
    { id: "ledger" as NavTab, label: "Ledger", icon: ReceiptText },
    { id: "ingestion" as NavTab, label: "Import Statements", icon: UploadCloud },
    { id: "budgeting" as NavTab, label: "Budget", icon: PiggyBank },
    { id: "loans" as NavTab, label: "Loans & Mortgages", icon: Landmark },
    { id: "rules" as NavTab, label: "Auto-Rules", icon: Sliders },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-800/80 bg-slate-900/50 backdrop-blur-xl shrink-0">
        {/* Brand */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Folio
              </span>
              <span className="block text-[10px] text-indigo-400 font-medium tracking-wider uppercase">
                Finance Suite
              </span>
            </div>
          </div>
        </div>

        {/* Net Worth Snapshot */}
        <div className="px-5 py-4 mx-3 my-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
          <div className="text-xs font-medium text-slate-400">Total Net Worth</div>
          <div className={`text-xl font-bold mt-0.5 ${netWorth >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            ${netWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-700/40">
            <span>Assets: ${totalAssets.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span>Debt: ${totalLiabilities.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* System & Sync Status */}
        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>SQLite + Litestream</span>
          </div>
          <ShieldCheck className="w-4 h-4 text-emerald-400/80" />
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">Folio</span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-400 hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6 text-slate-300" />}
          </button>
        </header>

        {/* Mobile Dropdown Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden p-4 border-b border-slate-800 bg-slate-900/95 backdrop-blur-xl space-y-2 animate-in fade-in">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onTabChange(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold ${
                    isActive
                      ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                      : "text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-8 pb-24 md:pb-8 max-w-full">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-slate-800 bg-slate-900/95 backdrop-blur-xl py-2 px-1">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-col items-center gap-1 py-1 px-3 text-[10px] font-medium transition-colors ${
                  isActive ? "text-indigo-400 font-semibold" : "text-slate-400"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                <span>{item.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
