import React, { useState } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Info,
  Wallet,
} from "lucide-react";
import type { Account, AccountType } from "../../types";
import { api } from "../../services/api";
import {
  getAccountTypeMeta,
  isAssetAccount,
  isLoanAccount,
  ACCOUNT_CATEGORY_LABELS,
  type AccountCategoryGroup,
} from "../../constants/canadianAccountTypes";
import { AccountIcon } from "../common/AccountIcon";
import { AccountTypePicker } from "./AccountTypePicker";
import { AccountIconPickerModal } from "./AccountIconPickerModal";
import { CanadianRulesModal } from "./CanadianRulesModal";

interface AccountsManagerViewProps {
  accounts: Account[];
  onAccountsModified: () => void;
}

export const AccountsManagerView: React.FC<AccountsManagerViewProps> = ({
  accounts,
  onAccountsModified,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [ruleModalType, setRuleModalType] = useState<AccountType | null>(null);
  const [activeFilterCategory, setActiveFilterCategory] = useState<
    AccountCategoryGroup | "ALL" | "ASSETS" | "LIABILITIES"
  >("ALL");

  // State for direct glyph customization from card
  const [directCustomizingAccount, setDirectCustomizingAccount] = useState<Account | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    type: AccountType;
    institution: string;
    account_number_mask: string;
    icon: string;
    color: string;
    current_balance: number;
    credit_limit: number;
    interest_rate: number;
    loan_term_months: number;
    loan_original_principal: number;
    monthly_payment: number;
    escrow_payment: number;
  }>({
    name: "",
    type: "CHECKING",
    institution: "",
    account_number_mask: "",
    icon: "wallet",
    color: "#3B82F6",
    current_balance: 0.0,
    credit_limit: 0.0,
    interest_rate: 0.0,
    loan_term_months: 360,
    loan_original_principal: 0.0,
    monthly_payment: 0.0,
    escrow_payment: 0.0,
  });

  const handleOpenCreate = () => {
    setEditingAccount(null);
    const meta = getAccountTypeMeta("CHECKING");
    setFormData({
      name: "",
      type: "CHECKING",
      institution: "",
      account_number_mask: "",
      icon: meta.defaultIcon,
      color: meta.defaultColor,
      current_balance: 0.0,
      credit_limit: 0.0,
      interest_rate: 0.0,
      loan_term_months: 360,
      loan_original_principal: 0.0,
      monthly_payment: 0.0,
      escrow_payment: 0.0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    const meta = getAccountTypeMeta(acc.type);
    setFormData({
      name: acc.name,
      type: acc.type,
      institution: acc.institution || "",
      account_number_mask: acc.account_number_mask || "",
      icon: acc.icon || meta.defaultIcon,
      color: acc.color || meta.defaultColor,
      current_balance: acc.current_balance,
      credit_limit: acc.credit_limit || 0.0,
      interest_rate: acc.interest_rate || 0.0,
      loan_term_months: acc.loan_term_months || 360,
      loan_original_principal: acc.loan_original_principal || 0.0,
      monthly_payment: acc.monthly_payment || 0.0,
      escrow_payment: acc.escrow_payment || 0.0,
    });
    setIsModalOpen(true);
  };

  const handleTypeChange = (newType: AccountType) => {
    const meta = getAccountTypeMeta(newType);
    setFormData((prev) => ({
      ...prev,
      type: newType,
      icon: meta.defaultIcon,
      color: meta.defaultColor,
    }));
  };

  const handleDirectGlyphSave = async (icon: string, color: string) => {
    if (!directCustomizingAccount) return;
    try {
      await api.updateAccount(directCustomizingAccount.id, { icon, color });
      setDirectCustomizingAccount(null);
      onAccountsModified();
    } catch (err: any) {
      alert(`Failed to update glyph: ${err.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Partial<Account> = {
        name: formData.name,
        type: formData.type,
        institution: formData.institution || undefined,
        account_number_mask: formData.account_number_mask || undefined,
        icon: formData.icon || undefined,
        color: formData.color || undefined,
        current_balance: Number(formData.current_balance),
        credit_limit:
          formData.type === "CREDIT_CARD" ? Number(formData.credit_limit) : undefined,
        interest_rate: Number(formData.interest_rate) || undefined,
        loan_term_months: Number(formData.loan_term_months) || undefined,
        loan_original_principal:
          Number(formData.loan_original_principal) || undefined,
        monthly_payment: Number(formData.monthly_payment) || undefined,
        escrow_payment: Number(formData.escrow_payment) || undefined,
      };

      if (editingAccount) {
        await api.updateAccount(editingAccount.id, payload);
      } else {
        await api.createAccount(payload);
      }

      setIsModalOpen(false);
      onAccountsModified();
    } catch (err: any) {
      alert(`Operation failed: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this account and all associated transactions?"
      )
    )
      return;
    try {
      await api.deleteAccount(id);
      onAccountsModified();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const totalAssets = accounts
    .filter((a) => isAssetAccount(a.type))
    .reduce((sum, a) => sum + a.current_balance, 0);

  const totalLiabilities = accounts
    .filter((a) => !isAssetAccount(a.type))
    .reduce((sum, a) => sum + Math.abs(a.current_balance), 0);

  const filterTabs: Array<{
    id: AccountCategoryGroup | "ALL" | "ASSETS" | "LIABILITIES";
    label: string;
    count: number;
  }> = [
    { id: "ALL", label: "All Accounts", count: accounts.length },
    {
      id: "REGISTERED",
      label: "Registered (CRA)",
      count: accounts.filter((a) => getAccountTypeMeta(a.type).category === "REGISTERED").length,
    },
    {
      id: "CASH",
      label: "Cash & Banking",
      count: accounts.filter((a) => getAccountTypeMeta(a.type).category === "CASH").length,
    },
    {
      id: "INVESTMENT",
      label: "Investments",
      count: accounts.filter((a) => getAccountTypeMeta(a.type).category === "INVESTMENT").length,
    },
    {
      id: "DEBT",
      label: "Loans & Debt",
      count: accounts.filter((a) => getAccountTypeMeta(a.type).category === "DEBT").length,
    },
    {
      id: "ASSET",
      label: "Physical Assets",
      count: accounts.filter((a) => getAccountTypeMeta(a.type).category === "ASSET").length,
    },
  ];

  const displayedAccounts = accounts.filter((a) => {
    if (activeFilterCategory === "ALL") return true;
    if (activeFilterCategory === "ASSETS") return isAssetAccount(a.type);
    if (activeFilterCategory === "LIABILITIES") return !isAssetAccount(a.type);
    return getAccountTypeMeta(a.type).category === activeFilterCategory;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Net Worth Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-indigo-400" />
            Accounts & Portfolios
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage Canadian registered accounts (TFSA, RRSP, FHSA, RESP), deposit accounts, mortgages, and loans.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02]"
        >
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-[11px] text-slate-400 font-medium">Total Assets</span>
          <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
            ${totalAssets.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-[11px] text-slate-400 font-medium">Total Liabilities & Debt</span>
          <div className="text-xl font-bold text-rose-400 font-mono mt-1">
            ${totalLiabilities.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-[11px] text-slate-400 font-medium">Net Position</span>
          <div
            className={`text-xl font-bold font-mono mt-1 ${
              totalAssets - totalLiabilities >= 0 ? "text-indigo-400" : "text-rose-400"
            }`}
          >
            ${(totalAssets - totalLiabilities).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      </div>

      {/* Filter Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar border-b border-slate-800/80">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilterCategory(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeFilterCategory === tab.id
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "bg-slate-900/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeFilterCategory === tab.id
                  ? "bg-indigo-700/80 text-indigo-100"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Accounts Grid */}
      {displayedAccounts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedAccounts.map((acc) => {
            const meta = getAccountTypeMeta(acc.type);
            const isAsset = isAssetAccount(acc.type);
            const effectiveColor = acc.color || meta.defaultColor;

            return (
              <div
                key={acc.id}
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 shadow-lg flex flex-col justify-between transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Built-in Clickable Glyph */}
                      <AccountIcon
                        type={acc.type}
                        icon={acc.icon}
                        color={acc.color}
                        size="lg"
                        editable={true}
                        onClick={() => setDirectCustomizingAccount(acc)}
                        title="Click glyph to customize icon & color"
                      />
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-100 truncate">
                          {acc.name}
                        </h3>
                        <p className="text-xs text-slate-400 truncate">
                          {acc.institution || meta.shortName}{" "}
                          {acc.account_number_mask ? `(${acc.account_number_mask})` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="View Canadian Rules"
                        onClick={() => setRuleModalType(acc.type)}
                        className="p-1 text-slate-400 hover:text-indigo-400 rounded-md transition-colors"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(acc)}
                        className="p-1 text-slate-400 hover:text-indigo-400 rounded-md transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(acc.id)}
                        className="p-1 text-slate-400 hover:text-rose-400 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Badge */}
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold border truncate max-w-full"
                      style={{
                        backgroundColor: `${effectiveColor}15`,
                        color: effectiveColor,
                        borderColor: `${effectiveColor}30`,
                      }}
                    >
                      {meta.badge}
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {ACCOUNT_CATEGORY_LABELS[meta.category]}
                    </span>
                  </div>
                </div>

                {/* Balance & Financial Details */}
                <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Current Balance</span>
                    <span
                      className={`text-lg font-bold font-mono ${
                        isAsset
                          ? "text-emerald-400"
                          : acc.current_balance < 0
                          ? "text-rose-400"
                          : "text-slate-100"
                      }`}
                    >
                      ${acc.current_balance.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>

                  {acc.interest_rate ? (
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Interest Rate (APR)</span>
                      <span className="font-semibold text-amber-400">{acc.interest_rate}%</span>
                    </div>
                  ) : null}

                  {acc.credit_limit ? (
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Credit Limit</span>
                      <span className="font-mono text-slate-300">
                        ${acc.credit_limit.toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <p className="text-slate-400 text-sm">No accounts found in this category.</p>
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create Account
          </button>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
              <div>
                <h3 className="text-base font-bold text-slate-100">
                  {editingAccount ? "Edit Account" : "Add New Account"}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure Canadian account type, details, and click the glyph to customize its palette
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Account Type Picker */}
              <div>
                <label className="block text-slate-400 mb-1.5 font-semibold uppercase tracking-wider text-[10px]">
                  Canadian Account Type
                </label>
                <AccountTypePicker
                  value={formData.type}
                  onChange={handleTypeChange}
                />
              </div>

              {/* Account Name with Integrated Glyph Trigger */}
              <div>
                <label className="block text-slate-400 mb-1.5 font-semibold uppercase tracking-wider text-[10px]">
                  Account Name & Custom Glyph
                </label>
                <div className="flex items-center gap-3">
                  <AccountIcon
                    type={formData.type}
                    icon={formData.icon}
                    color={formData.color}
                    size="xl"
                    editable={true}
                    onClick={() => setIsIconPickerOpen(true)}
                    title="Click glyph to customize icon & color"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="e.g. Wealthsimple TFSA or RBC Chequing"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-100 text-xs focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Institution & Account Mask */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Institution</label>
                  <input
                    type="text"
                    placeholder="e.g. Wealthsimple, RBC, TD"
                    value={formData.institution}
                    onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Account Mask</label>
                  <input
                    type="text"
                    placeholder="*1234"
                    value={formData.account_number_mask}
                    onChange={(e) =>
                      setFormData({ ...formData, account_number_mask: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200"
                  />
                </div>
              </div>

              {/* Balance */}
              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">
                  Current Balance ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.current_balance}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      current_balance: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                />
              </div>

              {/* Credit Limit for Credit Cards */}
              {formData.type === "CREDIT_CARD" && (
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">
                    Credit Limit ($)
                  </label>
                  <input
                    type="number"
                    step="100"
                    placeholder="10000"
                    value={formData.credit_limit}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        credit_limit: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                  />
                </div>
              )}

              {/* Loan / Mortgage Fields */}
              {isLoanAccount(formData.type) && (
                <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">
                        Interest Rate (APR %)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="5.5"
                        value={formData.interest_rate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            interest_rate: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">
                        Loan Term (Months)
                      </label>
                      <input
                        type="number"
                        placeholder="300"
                        value={formData.loan_term_months}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            loan_term_months: parseInt(e.target.value) || 360,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">
                        Original Principal ($)
                      </label>
                      <input
                        type="number"
                        step="1000"
                        placeholder="350000"
                        value={formData.loan_original_principal}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            loan_original_principal: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">
                        Monthly Payment ($)
                      </label>
                      <input
                        type="number"
                        step="10"
                        placeholder="2200"
                        value={formData.monthly_payment}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            monthly_payment: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  {formData.type === "MORTGAGE" && (
                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">
                        Escrow Payment (Taxes & Insurance $)
                      </label>
                      <input
                        type="number"
                        step="10"
                        placeholder="450"
                        value={formData.escrow_payment}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            escrow_payment: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-slate-800/90 border border-slate-700 rounded-xl text-slate-200 font-mono"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all"
              >
                {editingAccount ? "Update Account" : "Create Account"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Form Icon & Color Picker Modal */}
      {isIconPickerOpen && (
        <AccountIconPickerModal
          isOpen={isIconPickerOpen}
          onClose={() => setIsIconPickerOpen(false)}
          accountType={formData.type}
          accountName={formData.name}
          institution={formData.institution}
          balance={formData.current_balance}
          currentIcon={formData.icon}
          currentColor={formData.color}
          onSave={(icon, color) => {
            setFormData((prev) => ({ ...prev, icon, color }));
          }}
        />
      )}

      {/* Direct Card Icon & Color Customizer Modal */}
      {directCustomizingAccount && (
        <AccountIconPickerModal
          isOpen={!!directCustomizingAccount}
          onClose={() => setDirectCustomizingAccount(null)}
          accountType={directCustomizingAccount.type}
          accountName={directCustomizingAccount.name}
          institution={directCustomizingAccount.institution}
          balance={directCustomizingAccount.current_balance}
          currentIcon={directCustomizingAccount.icon}
          currentColor={directCustomizingAccount.color}
          onSave={handleDirectGlyphSave}
        />
      )}

      {/* Canadian Rules & Regulations Modal */}
      {ruleModalType && (
        <CanadianRulesModal
          accountType={ruleModalType}
          isOpen={!!ruleModalType}
          onClose={() => setRuleModalType(null)}
        />
      )}
    </div>
  );
};
