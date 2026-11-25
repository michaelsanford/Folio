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
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  RefreshCw,
} from "lucide-react";
import type { Account, HouseholdMember } from "../../types";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useTheme } from "../../context/ThemeContext";
import { ThemePickerModal } from "../common/ThemePickerModal";
import { Money } from "../common/Money";
import { FolioMark } from "../common/FolioMark";
import { formatMoney } from "../../utils/format";
import { useFormatPrefs } from "../../hooks/useFormatPrefs";

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
  onSignOut?: () => void;
  /** A new build is waiting (see usePwaUpdate); shows the "Update available" item. */
  updateReady?: boolean;
  onApplyUpdate?: () => void;
  children: React.ReactNode;
}

const iconButton =
  "h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer";

const Wordmark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div
    className="flex items-center gap-2.5 shrink-0"
    title={compact ? "Folio" : undefined}
    aria-label={compact ? "Folio" : undefined}
  >
    <FolioMark className="w-7 h-7" />
    {!compact && (
      <span className="text-base font-semibold text-main leading-none">Folio</span>
    )}
  </div>
);

/** Full-width "Update available" item for the expanded sidebar and the mobile menu. */
const UpdateItem: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-accent-main text-accent-contrast text-left transition-[filter,transform] hover:brightness-110 active:scale-[0.98] cursor-pointer"
  >
    <RefreshCw className="w-[22px] h-[22px] shrink-0" strokeWidth={2} aria-hidden="true" />
    <span className="flex flex-col min-w-0 leading-tight">
      <span className="text-sm font-semibold">Update available</span>
      <span className="text-xs opacity-80">Reload to update</span>
    </span>
  </button>
);

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeTab,
  onTabChange,
  accounts,
  householdMembers,
  onManageHousehold,
  onSignOut,
  updateReady = false,
  onApplyUpdate,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const { resolvedMode, toggleMode, activeThemeDef, sidebarCollapsed, setSidebarCollapsed } = useTheme();
  // Views call formatMoney directly (chart axes, tooltips); remount them when number formats change.
  const formatPrefs = useFormatPrefs();
  const formatKey = JSON.stringify(formatPrefs);

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
      <aside
        data-testid="desktop-sidebar"
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`hidden md:flex flex-col border-r border-subtle bg-sidebar shrink-0 select-none overflow-hidden transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? "w-[72px]" : "w-64"
        }`}
      >
        {/* Brand & collapse toggle */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center pt-3 pb-2 px-2 gap-2">
            <Wordmark compact />
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className={iconButton}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              aria-expanded={false}
            >
              <PanelLeftOpen className="w-5 h-5" strokeWidth={1.75} />
            </button>
            <div aria-live="polite" className="contents">
              {updateReady && (
                <button
                  type="button"
                  onClick={onApplyUpdate}
                  className="w-12 h-11 flex items-center justify-center rounded-lg bg-accent-main text-accent-contrast transition-[filter,transform] hover:brightness-110 active:scale-[0.98] cursor-pointer"
                  title="Update available. Reload"
                  aria-label="Update available. Reload"
                >
                  <RefreshCw className="w-6 h-6" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between h-14 px-4 gap-2">
            <Wordmark />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsThemeModalOpen(true)}
                className={iconButton}
                title="Appearance"
                aria-label="Appearance"
              >
                <Palette className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className={iconButton}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                aria-expanded={true}
              >
                <PanelLeftClose className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        {/* New build waiting */}
        {!sidebarCollapsed && (
          <div aria-live="polite" className={updateReady ? "mx-3 mb-3" : undefined}>
            {updateReady && <UpdateItem onClick={onApplyUpdate} />}
          </div>
        )}

        {/* Net worth snapshot */}
        {!sidebarCollapsed && (
          <div className="mx-3 mb-4 p-3 rounded-lg bg-surface border border-subtle">
            <div className="text-xs text-muted">Net worth</div>
            <Money
              value={netWorth}
              className={`block mt-1 text-lg font-medium ${netWorth < 0 ? "text-negative" : "text-main"}`}
            />
            <div className="flex items-center justify-between mt-2 text-xs tabular-nums text-muted">
              <span>Assets {formatMoney(totalAssets, { cents: false })}</span>
              <span>Debt {formatMoney(totalLiabilities, { cents: false })}</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav
          className={`flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden ${
            sidebarCollapsed ? "px-2 items-center" : "px-3"
          }`}
          aria-label="Main"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                className={`relative shrink-0 flex items-center rounded-lg transition-colors cursor-pointer ${
                  sidebarCollapsed
                    ? "w-12 h-11 justify-center"
                    : "w-full h-10 gap-3 px-3 text-sm"
                } ${
                  isActive
                    ? "bg-surface-subtle text-main font-medium"
                    : "text-sub hover:text-main bg-surface-hover"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent-main" />
                )}
                <Icon
                  className={`${
                    sidebarCollapsed ? "w-6 h-6" : "w-[22px] h-[22px]"
                  } shrink-0 ${isActive ? "text-accent-main" : "text-muted"}`}
                  strokeWidth={1.75}
                />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Household */}
        {householdMembers && (
          <div className={sidebarCollapsed ? "px-2 pt-2 flex justify-center" : "px-3 pt-3"}>
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={onManageHousehold}
                className="relative w-12 h-11 flex items-center justify-center rounded-lg text-sub hover:text-main bg-surface-hover transition-colors cursor-pointer"
                title={householdMembers.length === 0 ? "Add household" : "Manage household"}
                aria-label={householdMembers.length === 0 ? "Add household" : "Manage household"}
              >
                <Users className="w-6 h-6 text-muted shrink-0" strokeWidth={1.75} />
                {householdMembers.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent-main" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={onManageHousehold}
                className="w-full h-10 flex items-center justify-between gap-2 px-3 rounded-lg text-sm text-sub hover:text-main bg-surface-hover transition-colors cursor-pointer"
                title="Manage household"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Users className="w-[22px] h-[22px] text-muted shrink-0" strokeWidth={1.75} />
                  <span className="truncate">
                    {householdMembers.length === 0 ? "Add household" : "Household"}
                  </span>
                </span>
                <span className="flex -space-x-1 shrink-0">
                  {householdMembers.slice(0, 3).map((m) => (
                    <span
                      key={m.id}
                      className="w-5 h-5 rounded-full ring-2 ring-[var(--bg-sidebar)] text-xs flex items-center justify-center font-medium text-white"
                      style={{ backgroundColor: m.color || "#6b7280" }}
                      title={m.name}
                    >
                      {m.name.charAt(0)}
                    </span>
                  ))}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Footer: theme + mode */}
        {sidebarCollapsed ? (
          <div className="p-2 mt-2 border-t border-subtle flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsThemeModalOpen(true)}
              className="w-11 h-10 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
              title={`Appearance (${activeThemeDef.name})`}
              aria-label="Appearance"
            >
              <Palette
                className="w-5 h-5 shrink-0"
                style={{ color: activeThemeDef.accentHex }}
                strokeWidth={1.75}
              />
            </button>
            <button
              type="button"
              onClick={toggleMode}
              className="w-11 h-10 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
              title={`Switch to ${resolvedMode === "dark" ? "light" : "dark"} mode`}
              aria-label="Toggle colour mode"
            >
              <ModeIcon className="w-5 h-5" strokeWidth={1.75} />
            </button>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="w-11 h-10 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-5 h-5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        ) : (
          <div className="p-3 mt-3 border-t border-subtle flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => setIsThemeModalOpen(true)}
              className="flex-1 min-w-0 h-9 flex items-center gap-2 px-2 rounded-lg bg-surface-hover text-left transition-colors cursor-pointer"
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: activeThemeDef.accentHex }}
              />
              <span className="text-xs text-sub truncate">{activeThemeDef.name}</span>
            </button>
            <button
              type="button"
              onClick={toggleMode}
              className={iconButton}
              title={`Switch to ${resolvedMode === "dark" ? "light" : "dark"} mode`}
              aria-label="Toggle colour mode"
            >
              <ModeIcon className="w-5 h-5" strokeWidth={1.75} />
            </button>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className={iconButton}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-5 h-5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 border-b border-subtle bg-sidebar">
          <Wordmark />
          <div className="flex items-center gap-1">
            {updateReady && (
              <button
                type="button"
                onClick={onApplyUpdate}
                className="h-9 w-9 flex items-center justify-center rounded-lg bg-accent-main text-accent-contrast cursor-pointer"
                title="Update available. Reload"
                aria-label="Update available. Reload"
              >
                <RefreshCw className="w-5 h-5" strokeWidth={2} />
              </button>
            )}
            <button onClick={() => setIsThemeModalOpen(true)} className={iconButton} aria-label="Appearance">
              <Palette className="w-5 h-5" strokeWidth={1.75} />
            </button>
            <button onClick={toggleMode} className={iconButton} aria-label="Toggle colour mode">
              <ModeIcon className="w-5 h-5" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={iconButton}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" strokeWidth={1.75} />
              ) : (
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </header>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden p-3 border-b border-subtle bg-sidebar flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1">
            {updateReady && (
              <div className="mb-2">
                <UpdateItem
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onApplyUpdate?.();
                  }}
                />
              </div>
            )}
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
                  className={`w-full h-10 flex items-center gap-3 px-3 rounded-lg text-sm transition-colors ${
                    isActive ? "bg-surface-subtle text-main font-medium" : "text-sub bg-surface-hover"
                  }`}
                >
                  <Icon
                    className={`w-[22px] h-[22px] ${isActive ? "text-accent-main" : "text-muted"}`}
                    strokeWidth={1.75}
                  />
                  {item.label}
                </button>
              );
            })}
            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onSignOut();
                }}
                className="w-full h-10 mt-1 pt-1 border-t border-subtle flex items-center gap-3 px-3 rounded-lg text-sm text-sub bg-surface-hover transition-colors"
              >
                <LogOut className="w-[22px] h-[22px] text-muted" strokeWidth={1.75} />
                Sign out
              </button>
            )}
          </div>
        )}

        {/* Main Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:p-8 max-w-full">
          <React.Fragment key={formatKey}>{children}</React.Fragment>
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] px-1 border-t border-subtle bg-sidebar">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-col items-center gap-1 px-2 py-1 text-xs transition-colors ${
                  isActive ? "text-main font-medium" : "text-muted"
                }`}
              >
                <Icon
                  className={`w-[22px] h-[22px] ${isActive ? "text-accent-main" : "text-muted"}`}
                  strokeWidth={1.75}
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
