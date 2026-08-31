import React, { useState } from "react";
import {
  LayoutDashboard,
  ReceiptText,
  UploadCloud,
  PiggyBank,
  Sliders,
  Wallet,
  TrendingUp,
  Menu,
  X,
  Palette,
  Sun,
  Moon,
} from "lucide-react";
import type { Account } from "../../types";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useTheme } from "../../context/ThemeContext";
import { ThemePickerModal } from "../common/ThemePickerModal";

export type NavTab =
  | "dashboard"
  | "ledger"
  | "budgeting"
  | "loans"
  | "ingestion"
  | "rules"
  | "investments"
  | "accounts";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const { resolvedMode, toggleMode, activeThemeDef } = useTheme();

  const totalAssets = accounts
    .filter((a) => isAssetAccount(a.type))
    .reduce((sum, a) => sum + a.current_balance, 0);

  const totalLiabilities = accounts
    .filter((a) => !isAssetAccount(a.type))
    .reduce((sum, a) => sum + Math.abs(a.current_balance), 0);

  const netWorth = totalAssets - totalLiabilities;

  const navItems = [
    { id: "dashboard" as NavTab, label: "Dashboard", icon: LayoutDashboard },
    { id: "accounts" as NavTab, label: "Accounts", icon: Wallet },
    { id: "ledger" as NavTab, label: "Ledger", icon: ReceiptText },
    { id: "budgeting" as NavTab, label: "Budget", icon: PiggyBank },
    { id: "investments" as NavTab, label: "Investments", icon: TrendingUp },
    { id: "ingestion" as NavTab, label: "Import", icon: UploadCloud },
    { id: "rules" as NavTab, label: "Auto / Settings", icon: Sliders },
  ];

  return (
    <div className="flex h-screen bg-canvas text-main overflow-hidden transition-colors duration-200">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-default bg-sidebar shrink-0 select-none">
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-main text-accent-contrast flex items-center justify-center shadow-xs">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-main block leading-none">
                Folio
              </span>
              <span className="text-[10px] text-accent-subtle font-semibold tracking-wider uppercase">
                Finance & Ledger
              </span>
            </div>
          </div>

          {/* Quick theme modal trigger */}
          <button
            onClick={() => setIsThemeModalOpen(true)}
            className="p-1.5 rounded-lg border border-subtle bg-surface hover:bg-surface-hover text-muted hover:text-main transition-colors"
            title="Appearance & Theme"
            aria-label="Appearance & Theme"
          >
            <Palette className="w-4 h-4" />
          </button>
        </div>

        {/* Net Worth Snapshot */}
        <div className="px-4 py-3.5 mx-3 my-3 rounded-xl bg-surface border border-default shadow-2xs">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Total Net Worth
          </div>
          <div
            className={`text-lg font-bold font-mono tracking-tight mt-0.5 ${
              netWorth >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            ${netWorth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-muted mt-2 pt-2 border-t border-subtle">
            <span>Assets: ${totalAssets.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span>Debt: ${totalLiabilities.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-100 ${
                  isActive
                    ? "bg-accent-subtle text-accent-subtle border border-accent-main/30 shadow-2xs"
                    : "text-sub hover:text-main hover:bg-surface-hover"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-accent-main" : "text-muted"}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Mode & Theme Info */}
        <div className="p-3 border-t border-subtle bg-surface-subtle/50 flex items-center justify-between gap-2">
          <button
            onClick={() => setIsThemeModalOpen(true)}
            className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-subtle bg-surface hover:bg-surface-hover text-left transition-colors"
          >
            <div
              className="w-3.5 h-3.5 rounded-full border border-subtle shrink-0"
              style={{ backgroundColor: activeThemeDef.accentHex }}
            />
            <span className="text-[11px] font-medium text-sub truncate">
              {activeThemeDef.name}
            </span>
          </button>

          <button
            onClick={toggleMode}
            className="p-1.5 rounded-lg border border-subtle bg-surface hover:bg-surface-hover text-muted hover:text-main transition-colors"
            title={`Switch to ${resolvedMode === "dark" ? "Light" : "Dark"} Mode`}
            aria-label="Toggle Color Mode"
          >
            {resolvedMode === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-default bg-sidebar">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-main text-accent-contrast flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-main">Folio</span>
              <span className="text-[10px] text-muted ml-1.5 font-medium">({activeThemeDef.name})</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsThemeModalOpen(true)}
              className="p-2 text-muted hover:text-main"
              aria-label="Open Theme Settings"
            >
              <Palette className="w-5 h-5" />
            </button>
            <button
              onClick={toggleMode}
              className="p-2 text-muted hover:text-main"
              aria-label="Toggle Color Mode"
            >
              {resolvedMode === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-muted hover:text-main"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5 text-main" />}
            </button>
          </div>
        </header>

        {/* Mobile Dropdown Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden p-4 border-b border-default bg-sidebar space-y-2 animate-in fade-in">
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
                      ? "bg-accent-subtle text-accent-subtle border border-accent-main/30"
                      : "text-sub hover:bg-surface-hover"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-accent-main" : "text-muted"}`} />
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
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-default bg-sidebar py-2 px-1">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-col items-center gap-1 py-1 px-2 text-[10px] font-medium transition-colors ${
                  isActive ? "text-accent-main font-semibold" : "text-muted"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-accent-main" : "text-muted"}`} />
                <span>{item.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Theme Picker Modal */}
      <ThemePickerModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />
    </div>
  );
};
