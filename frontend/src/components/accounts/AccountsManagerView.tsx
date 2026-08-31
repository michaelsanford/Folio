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
import { InstitutionAutocomplete } from "./InstitutionAutocomplete";

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
    color: "#10B981",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingAccount) {
        await api.updateAccount(editingAccount.id, {
          name: formData.name,
          institution: formData.institution || undefined,
          account_number_mask: formData.account_number_mask || undefined,
          icon: formData.icon || null,
          color: formData.color || null,
          current_balance: Number(formData.current_balance),
          credit_limit:
            formData.type === "CREDIT_CARD" ? Number(formData.credit_limit) : undefined,
          interest_rate: isLoanAccount(formData.type)
            ? Number(formData.interest_rate)
            : undefined,
          loan_term_months: isLoanAccount(formData.type)
            ? Number(formData.loan_term_months)
            : undefined,
          loan_original_principal: isLoanAccount(formData.type)
            ? Number(formData.loan_original_principal)
            : undefined,
          monthly_payment: isLoanAccount(formData.type)
            ? Number(formData.monthly_payment)
            : undefined,
          escrow_payment:
            formData.type === "MORTGAGE" ? Number(formData.escrow_payment) : undefined,
        });
      } else {
        await api.createAccount({
          name: formData.name,
          type: formData.type,
          institution: formData.institution || undefined,
          account_number_mask: formData.account_number_mask || undefined,
          currency: "CAD",
          icon: formData.icon || null,
          color: formData.color || null,
          current_balance: Number(formData.current_balance),
          credit_limit:
            formData.type === "CREDIT_CARD" ? Number(formData.credit_limit) : undefined,
          interest_rate: isLoanAccount(formData.type)
            ? Number(formData.interest_rate)
            : undefined,
          loan_term_months: isLoanAccount(formData.type)
            ? Number(formData.loan_term_months)
            : undefined,
          loan_original_principal: isLoanAccount(formData.type)
            ? Number(formData.loan_original_principal)
            : undefined,
          monthly_payment: isLoanAccount(formData.type)
            ? Number(formData.monthly_payment)
            : undefined,
          escrow_payment:
            formData.type === "MORTGAGE" ? Number(formData.escrow_payment) : undefined,
        });
      }
      setIsModalOpen(false);
      onAccountsModified();
    } catch (err: any) {
      alert(`Error saving account: ${err.message}`);
    }
  };

  const handleDirectGlyphSave = async (newIcon: string, newColor: string) => {
    if (!directCustomizingAccount) return;
    try {
      await api.updateAccount(directCustomizingAccount.id, {
        icon: newIcon,
        color: newColor,
      });
      setDirectCustomizingAccount(null);
      onAccountsModified();
    } catch (err: any) {
      alert(`Error saving customized glyph: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this account? Transactions associated may be affected."
      )
    ) {
      return;
    }
    try {
      await api.deleteAccount(id);
      onAccountsModified();
    } catch (err: any) {
      alert(`Failed to delete account: ${err.message}`);
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
      id: "ASSETS",
      label: "Assets",
      count: accounts.filter((a) => isAssetAccount(a.type)).length,
    },
    {
      id: "LIABILITIES",
      label: "Liabilities",
      count: accounts.filter((a) => !isAssetAccount(a.type)).length,
    },
    {
      id: "REGISTERED",
      label: "Registered (TFSA/RRSP)",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "REGISTERED"
      ).length,
    },
    {
      id: "INVESTMENT",
      label: "Non-Reg Investments",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "INVESTMENT"
      ).length,
    },
    {
      id: "CASH",
      label: "Cash & Banking",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "CASH"
      ).length,
    },
    {
      id: "DEBT",
      label: "Loans & Debt",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "DEBT"
      ).length,
    },
    {
      id: "ASSET",
      label: "Physical Assets",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "ASSET"
      ).length,
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-surface border border-default shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-main flex items-center gap-3">
            <Wallet className="w-6 h-6 text-accent-main" />
            Accounts & Portfolios
          </h1>
          <p className="text-sm text-muted mt-1">
            Manage Canadian registered accounts (TFSA, RRSP, FHSA, RESP), deposit accounts, mortgages, and loans.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-semibold shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Total Assets</span>
          <div className="text-2xl font-bold text-positive font-mono mt-1.5">
            ${totalAssets.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Total Liabilities & Debt</span>
          <div className="text-2xl font-bold text-negative font-mono mt-1.5">
            ${totalLiabilities.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Net Position</span>
          <div
            className={`text-2xl font-bold font-mono mt-1.5 ${
              totalAssets - totalLiabilities >= 0 ? "text-positive" : "text-negative"
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
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar border-b border-subtle">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilterCategory(tab.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              activeFilterCategory === tab.id
                ? "bg-accent-subtle text-accent-subtle border border-accent-main/40 shadow-xs"
                : "bg-surface hover:bg-surface-hover text-sub border border-default"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                activeFilterCategory === tab.id
                  ? "bg-accent-main text-accent-contrast"
                  : "bg-surface-subtle text-muted"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Accounts Grid */}
      {displayedAccounts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedAccounts.map((acc) => {
            const meta = getAccountTypeMeta(acc.type);
            const isAsset = isAssetAccount(acc.type);
            const effectiveColor = acc.color || meta.defaultColor;

            return (
              <div
                key={acc.id}
                className="p-5 rounded-2xl bg-surface border border-default hover:border-strong shadow-xs flex flex-col justify-between transition-all group"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3.5 min-w-0">
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
                        <h3 className="text-base font-bold text-main truncate">
                          {acc.name}
                        </h3>
                        <p className="text-xs text-muted truncate mt-0.5">
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
                        className="p-1.5 text-muted hover:text-accent-main rounded-lg transition-colors cursor-pointer"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(acc)}
                        className="p-1.5 text-muted hover:text-accent-main rounded-lg transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(acc.id)}
                        className="p-1.5 text-muted hover:text-negative rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Badge */}
                  <div className="mt-3.5 flex items-center gap-2 flex-wrap">
                    <span
                      className="px-2.5 py-0.5 rounded-md text-xs font-semibold border truncate max-w-full font-mono"
                      style={{
                        backgroundColor: `${effectiveColor}15`,
                        color: effectiveColor,
                        borderColor: `${effectiveColor}30`,
                      }}
                    >
                      {meta.badge}
                    </span>
                    <span className="text-xs text-muted font-medium">
                      {ACCOUNT_CATEGORY_LABELS[meta.category]}
                    </span>
                  </div>
                </div>

                {/* Balance & Financial Details */}
                <div className="mt-5 pt-4 border-t border-subtle space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted font-medium">Current Balance</span>
                    <span
                      className={`text-lg font-bold font-mono ${
                        isAsset
                          ? "text-positive"
                          : acc.current_balance < 0
                          ? "text-negative"
                          : "text-main"
                      }`}
                    >
                      ${acc.current_balance.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>

                  {acc.interest_rate ? (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Interest Rate (APR)</span>
                      <span className="font-semibold font-mono text-accent-main text-xs">{acc.interest_rate}%</span>
                    </div>
                  ) : null}

                  {acc.credit_limit ? (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Credit Limit</span>
                      <span className="font-mono text-sub text-xs font-semibold">
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
        <div className="p-12 rounded-2xl bg-surface border border-default text-center space-y-3">
          <p className="text-muted text-sm">No accounts found in this category.</p>
          <button
            onClick={handleOpenCreate}
            className="px-5 py-2.5 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" /> Create Account
          </button>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-xl rounded-2xl bg-surface border border-default shadow-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-subtle pb-4">
              <div>
                <h3 className="text-lg font-bold text-main">
                  {editingAccount ? "Edit Account" : "Add New Account"}
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Configure Canadian account type, details, and click the glyph to customize its palette
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted hover:text-main p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Account Type Picker */}
              <div>
                <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
                  Canadian Account Type
                </label>
                <AccountTypePicker
                  value={formData.type}
                  onChange={handleTypeChange}
                />
              </div>

              {/* Account Name with Integrated Glyph Trigger */}
              <div>
                <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
                  Account Name & Custom Glyph
                </label>
                <div className="flex items-center gap-3.5">
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
                      className="w-full px-4 py-2.5 bg-input border border-default rounded-xl text-main text-sm focus:outline-hidden focus:ring-1 focus:ring-accent-main"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Institution & Account Mask */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
                    Institution
                  </label>
                  <InstitutionAutocomplete
                    value={formData.institution}
                    onChange={(val) => setFormData({ ...formData, institution: val })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
                    Account Mask
                  </label>
                  <input
                    type="text"
                    placeholder="*1234"
                    value={formData.account_number_mask}
                    onChange={(e) =>
                      setFormData({ ...formData, account_number_mask: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                  />
                </div>
              </div>

              {/* Balance */}
              <div>
                <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                  className="w-full px-4 py-2.5 bg-input border border-default rounded-xl text-main text-sm font-mono"
                />
              </div>

              {/* Credit Limit for Credit Cards */}
              {formData.type === "CREDIT_CARD" && (
                <div>
                  <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                    className="w-full px-4 py-2.5 bg-input border border-default rounded-xl text-main text-sm font-mono"
                  />
                </div>
              )}

              {/* Loan / Mortgage Fields */}
              {isLoanAccount(formData.type) && (
                <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                        className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                        className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                        className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                        className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                      />
                    </div>
                  </div>

                  {formData.type === "MORTGAGE" && (
                    <div>
                      <label className="block text-muted mb-1.5 font-semibold text-xs uppercase tracking-wider">
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
                        className="w-full px-4 py-2 bg-input border border-default rounded-xl text-main text-sm font-mono"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border border-default text-sub text-xs font-semibold hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs transition-all cursor-pointer"
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
