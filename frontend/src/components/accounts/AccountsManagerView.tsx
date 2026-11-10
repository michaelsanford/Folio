import React, { useState } from "react";
import { Plus, Edit2, Trash2, Info, Users, X } from "lucide-react";
import type { Account, AccountType, HouseholdMember } from "../../types";
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
import { Money } from "../common/Money";

const card = "rounded-xl bg-surface border border-subtle";
const fieldLabel = "block text-sm text-sub mb-2";
const inputClass =
  "w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] transition-colors";
const primaryButton =
  "h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer";
const secondaryButton =
  "h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer";
const iconButton =
  "h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer";

interface AccountsManagerViewProps {
  accounts: Account[];
  householdMembers?: HouseholdMember[];
  onAccountsModified: () => void;
  onManageHousehold?: () => void;
}

export const AccountsManagerView: React.FC<AccountsManagerViewProps> = ({
  accounts,
  householdMembers,
  onAccountsModified,
  onManageHousehold,
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
    owner_member_id: string;
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
    owner_member_id: "",
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
      owner_member_id: "",
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
      owner_member_id: acc.owner_member_id || "",
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
          owner_member_id: formData.owner_member_id || undefined,
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
          owner_member_id: formData.owner_member_id || undefined,
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
    { id: "ALL", label: "All accounts", count: accounts.length },
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
      label: "Non-registered investments",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "INVESTMENT"
      ).length,
    },
    {
      id: "CASH",
      label: "Cash and banking",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "CASH"
      ).length,
    },
    {
      id: "DEBT",
      label: "Loans and debt",
      count: accounts.filter(
        (a) => getAccountTypeMeta(a.type).category === "DEBT"
      ).length,
    },
    {
      id: "ASSET",
      label: "Physical assets",
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
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-medium text-main">Accounts</h1>
          <p className="text-sm text-sub mt-1">
            Registered accounts (TFSA, RRSP, FHSA, RESP), deposit accounts, mortgages and loans
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onManageHousehold && (
            <button type="button" onClick={onManageHousehold} className={secondaryButton}>
              <Users className="w-4 h-4 text-muted" strokeWidth={1.5} /> Manage household
            </button>
          )}
          <button onClick={handleOpenCreate} className={primaryButton}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add account
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Assets</div>
          <Money value={totalAssets} className="block mt-2 text-2xl font-medium leading-none text-main" />
        </div>
        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Liabilities and debt</div>
          <Money value={totalLiabilities} className="block mt-2 text-2xl font-medium leading-none text-main" />
        </div>
        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Net position</div>
          <Money
            value={totalAssets - totalLiabilities}
            className={`block mt-2 text-2xl font-medium leading-none ${
              totalAssets - totalLiabilities >= 0 ? "text-main" : "text-negative"
            }`}
          />
        </div>
      </div>

      {/* Filter Category Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2 no-scrollbar border-b border-subtle">
        {filterTabs.map((tab) => {
          const isActive = activeFilterCategory === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveFilterCategory(tab.id)}
              aria-pressed={isActive}
              className={`h-8 px-3 flex items-center gap-2 rounded-lg text-sm whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? "bg-surface-subtle text-main font-medium"
                  : "text-sub hover:text-main bg-surface-hover"
              }`}
            >
              <span>{tab.label}</span>
              <span className="text-xs font-mono font-normal text-muted">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* Accounts Grid */}
      {displayedAccounts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedAccounts.map((acc) => {
            const meta = getAccountTypeMeta(acc.type);
            const isAsset = isAssetAccount(acc.type);

            return (
              <div
                key={acc.id}
                className={`${card} p-5 flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <AccountIcon
                        type={acc.type}
                        icon={acc.icon}
                        color={acc.color}
                        size="lg"
                        editable={true}
                        onClick={() => setDirectCustomizingAccount(acc)}
                        title="Change icon and colour"
                      />
                      <div className="min-w-0">
                        <h3 className="text-base font-medium text-main truncate">
                          {acc.name}
                        </h3>
                        <p className="text-xs text-muted truncate mt-0.5">
                          {acc.institution || meta.shortName}
                          {acc.account_number_mask ? ` ··${acc.account_number_mask}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        title="Canadian rules"
                        aria-label="Canadian rules"
                        onClick={() => setRuleModalType(acc.type)}
                        className={iconButton}
                      >
                        <Info className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        title="Edit account"
                        aria-label="Edit account"
                        onClick={() => handleOpenEdit(acc)}
                        className={iconButton}
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        title="Delete account"
                        aria-label="Delete account"
                        onClick={() => handleDelete(acc.id)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>

                  {/* Badge */}
                  <div className="mt-4 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
                    <span className="rounded-md px-1.5 py-0.5 font-mono bg-surface-subtle text-sub truncate max-w-full">
                      {meta.badge}
                    </span>
                    <span className="text-muted">
                      {ACCOUNT_CATEGORY_LABELS[meta.category]}
                    </span>
                    {(() => {
                      const owner =
                        householdMembers?.find((m) => m.id === acc.owner_member_id) ||
                        acc.owner_member;
                      if (acc.owner_member_id && owner) {
                        const ownerColor = owner.color || "#6b7280";
                        return (
                          <span className="inline-flex items-center gap-1.5 text-sub">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: ownerColor }}
                            />
                            {owner.name}
                          </span>
                        );
                      }
                      return <span className="text-muted">Joint / shared</span>;
                    })()}
                  </div>
                </div>

                {/* Balance & Financial Details */}
                <div className="mt-5 pt-4 border-t border-subtle space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted">Current balance</span>
                    <Money
                      value={acc.current_balance}
                      className={`text-lg font-medium ${
                        isAsset && acc.current_balance < 0 ? "text-negative" : "text-main"
                      }`}
                    />
                  </div>

                  {acc.interest_rate ? (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Interest rate (APR)</span>
                      <span className="font-mono text-sub">{acc.interest_rate}%</span>
                    </div>
                  ) : null}

                  {acc.credit_limit ? (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Credit limit</span>
                      <Money value={acc.credit_limit} cents={false} className="text-sub" />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`${card} p-12 text-center flex flex-col items-center gap-4`}>
          <p className="text-muted text-sm">No accounts in this category</p>
          <button onClick={handleOpenCreate} className={primaryButton}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add account
          </button>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-xl rounded-xl bg-surface border border-default shadow-xl max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-subtle">
              <div>
                <h3 className="text-base font-medium text-main">
                  {editingAccount ? "Edit account" : "Add account"}
                </h3>
                <p className="text-sm text-sub mt-1">
                  Choose the account type and details. Click the icon to change it.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
                className={`${iconButton} shrink-0`}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="p-6 space-y-5 text-sm">
              {/* Account Type Picker */}
              <div>
                <label className={fieldLabel}>Account type</label>
                <AccountTypePicker
                  value={formData.type}
                  onChange={handleTypeChange}
                />
              </div>

              {/* Account Ownership (Household Member) */}
              <div>
                <label className={fieldLabel}>Owner</label>
                <select
                  value={formData.owner_member_id}
                  onChange={(e) =>
                    setFormData({ ...formData, owner_member_id: e.target.value })
                  }
                  className={inputClass}
                >
                  <option value="">Joint / shared household</option>
                  {householdMembers?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role || "Member"})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-2 leading-relaxed">
                  In Canada, registered accounts (TFSA, RRSP, FHSA) are individual legal registrations. Joint ownership applies to chequing, savings and mortgages.
                </p>
              </div>

              {/* Account Name with Integrated Glyph Trigger */}
              <div>
                <label className={fieldLabel}>Name and icon</label>
                <div className="flex items-center gap-3">
                  <AccountIcon
                    type={formData.type}
                    icon={formData.icon}
                    color={formData.color}
                    size="xl"
                    editable={true}
                    onClick={() => setIsIconPickerOpen(true)}
                    title="Change icon and colour"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Account name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={inputClass}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Institution & Account Mask */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fieldLabel}>Institution</label>
                  <InstitutionAutocomplete
                    value={formData.institution}
                    onChange={(val) => setFormData({ ...formData, institution: val })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Account mask</label>
                  <input
                    type="text"
                    placeholder="*1234"
                    value={formData.account_number_mask}
                    onChange={(e) =>
                      setFormData({ ...formData, account_number_mask: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              {/* Balance */}
              <div>
                <label className={fieldLabel}>Current balance</label>
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
                  className={`${inputClass} font-mono`}
                />
              </div>

              {/* Credit Limit for Credit Cards */}
              {formData.type === "CREDIT_CARD" && (
                <div>
                  <label className={fieldLabel}>Credit limit</label>
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
                    className={`${inputClass} font-mono`}
                  />
                </div>
              )}

              {/* Loan / Mortgage Fields */}
              {isLoanAccount(formData.type) && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={fieldLabel}>Interest rate (APR %)</label>
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
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Term (months)</label>
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
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={fieldLabel}>Original principal</label>
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
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Monthly payment</label>
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
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                  </div>

                  {formData.type === "MORTGAGE" && (
                    <div>
                      <label className={fieldLabel}>Escrow payment (taxes and insurance)</label>
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
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                {editingAccount ? "Save changes" : "Create account"}
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
