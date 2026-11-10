import React, { useState } from "react";
import {
  LayoutDashboard,
  ReceiptText,
  UploadCloud,
  PiggyBank,
  Sliders,
  Wallet,
  TrendingUp,
  Landmark,
  Target,
  Users,
  Menu,
  X,
  Palette,
  Sun,
  Moon,
  BookOpen,
} from "lucide-react";
import type { Account, HouseholdMember } from "../../types";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useTheme } from "../../context/ThemeContext";
import { ThemePickerModal } from "../common/ThemePickerModal";
import { Money } from "../common/Money";
import { formatMoney } from "../../utils/format";

export type NavTab =
  | "dashboard"
  | "ledger"
  | "budgeting"
  | "goals"
  | "loans"
  | "ingestion"
  | "rules"
  | "investments"
  | "accounts";

interface AppLayoutProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  accounts: Account[];
  householdMembers?: HouseholdMember[];
  onManageHousehold?: () => void;
  children: React.ReactNode;
}

const iconButton =
  "h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer";

const Wordmark: React.FC = () => (
  <div className="flex items-center gap-2">
    <BookOpen className="w-[18px] h-[18px] text-accent-main" strokeWidth={1.5} />
    <span className="text-base font-semibold text-main leading-none">Folio</span>
  </div>
);

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onTabChange,
  accounts,
  householdMembers,
  onManageHousehold,
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
    { id: "goals" as NavTab, label: "Goals", icon: Target },
    { id: "loans" as NavTab, label: "Loans", icon: Landmark },
    { id: "investments" as NavTab, label: "Investments", icon: TrendingUp },
    { id: "ingestion" as NavTab, label: "Import", icon: UploadCloud },
    { id: "rules" as NavTab, label: "Rules", icon: Sliders },
  ];

  const ModeIcon = resolvedMode === "dark" ? Sun : Moon;

  return (
    <div className="flex h-screen bg-canvas text-main overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-subtle bg-sidebar shrink-0 select-none">
        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-4">
          <Wordmark />
          <button
            onClick={() => setIsThemeModalOpen(true)}
            className={iconButton}
            title="Appearance"
            aria-label="Appearance"
          >
            <Palette className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Net worth snapshot */}
        <div className="mx-3 mb-4 p-3 rounded-lg bg-surface border border-subtle">
          <div className="text-xs text-muted">Net worth</div>
          <Money
            value={netWorth}
            className={`block mt-1 text-lg font-medium ${netWorth < 0 ? "text-negative" : "text-main"}`}
          />
          <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-muted">
            <span>Assets {formatMoney(totalAssets, { cents: false })}</span>
            <span>Debt {formatMoney(totalLiabilities, { cents: false })}</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 flex flex-col gap-0.5 overflow-y-auto" aria-label="Main">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`relative w-full h-9 shrink-0 flex items-center gap-2.5 px-3 rounded-lg text-sm transition-colors cursor-pointer ${
                  isActive
                    ? "bg-surface-subtle text-main font-medium"
                    : "text-sub hover:text-main bg-surface-hover"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent-main" />
                )}
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? "text-accent-main" : "text-muted"}`}
                  strokeWidth={1.5}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Household */}
        {householdMembers && (
          <div className="px-3 pt-3">
            <button
              onClick={onManageHousehold}
              className="w-full h-9 flex items-center justify-between gap-2 px-3 rounded-lg text-sm text-sub hover:text-main bg-surface-hover transition-colors cursor-pointer"
              title="Manage household"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Users className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
                <span className="truncate">
                  {householdMembers.length === 0 ? "Add household" : "Household"}
                </span>
              </span>
              <span className="flex -space-x-1 shrink-0">
                {householdMembers.slice(0, 3).map((m) => (
                  <span
                    key={m.id}
                    className="w-5 h-5 rounded-full ring-2 ring-[var(--bg-sidebar)] text-[11px] flex items-center justify-center font-medium text-white"
                    style={{ backgroundColor: m.color || "#6b7280" }}
                    title={m.name}
                  >
                    {m.name.charAt(0)}
                  </span>
                ))}
              </span>
            </button>
          </div>
        )}

        {/* Footer: theme + mode */}
        <div className="p-3 mt-3 border-t border-subtle flex items-center justify-between gap-2">
          <button
            onClick={() => setIsThemeModalOpen(true)}
            className="flex-1 min-w-0 h-8 flex items-center gap-2 px-2 rounded-lg bg-surface-hover text-left transition-colors cursor-pointer"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: activeThemeDef.accentHex }}
            />
            <span className="text-xs text-sub truncate">{activeThemeDef.name}</span>
          </button>
          <button
            onClick={toggleMode}
            className={iconButton}
            title={`Switch to ${resolvedMode === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle colour mode"
          >
            <ModeIcon className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between h-14 px-4 border-b border-subtle bg-sidebar">
          <Wordmark />
          <div className="flex items-center gap-1">
            <button onClick={() => setIsThemeModalOpen(true)} className={iconButton} aria-label="Appearance">
              <Palette className="w-[18px] h-[18px]" strokeWidth={1.5} />
            </button>
            <button onClick={toggleMode} className={iconButton} aria-label="Toggle colour mode">
              <ModeIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={iconButton}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="w-[18px] h-[18px]" strokeWidth={1.5} />
              ) : (
                <Menu className="w-[18px] h-[18px]" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </header>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden p-3 border-b border-subtle bg-sidebar flex flex-col gap-0.5 animate-in fade-in">
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
                  className={`w-full h-10 flex items-center gap-2.5 px-3 rounded-lg text-sm transition-colors ${
                    isActive ? "bg-surface-subtle text-main font-medium" : "text-sub bg-surface-hover"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${isActive ? "text-accent-main" : "text-muted"}`}
                    strokeWidth={1.5}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-24 sm:px-6 md:p-8 max-w-full">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around h-16 px-1 border-t border-subtle bg-sidebar">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-col items-center gap-1 px-2 py-1 text-[11px] transition-colors ${
                  isActive ? "text-main font-medium" : "text-muted"
                }`}
              >
                <Icon
                  className={`w-[18px] h-[18px] ${isActive ? "text-accent-main" : "text-muted"}`}
                  strokeWidth={1.5}
                />
                <span>{item.label}</span>
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
