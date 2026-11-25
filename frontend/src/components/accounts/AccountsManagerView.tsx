import React, { useState } from "react";
import { Plus, Edit2, Trash2, Info, Users, X } from "lucide-react";
import type { Account, AccountType, HouseholdMember } from "../../types";
import { api } from "../../services/api";
import {
  getAccountTypeMeta,
  isAssetAccount,
  isLoanAccount,
  isRevolvingAccount,
  ACCOUNT_CATEGORY_LABELS,
  type AccountCategoryGroup,
} from "../../constants/canadianAccountTypes";
import { AccountIcon } from "../common/AccountIcon";
import { AccountTypePicker } from "./AccountTypePicker";
import { AccountIconPickerModal } from "./AccountIconPickerModal";
import { CanadianRulesModal } from "./CanadianRulesModal";
import { InstitutionAutocomplete } from "./InstitutionAutocomplete";
import { Money } from "../common/Money";
import { NumberField } from "../common/NumberField";
import { CreditUsage } from "./CreditUsage";
import { formatMoney } from "../../utils/format";

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

/** Number fields are `null` while blank, so a cleared field stays cleared. */
interface AccountForm {
  name: string;
  type: AccountType;
  institution: string;
  account_number_mask: string;
  icon: string;
  color: string;
  owner_member_id: string;
  current_balance: number | null;
  credit_limit: number | null;
  interest_rate: number | null;
  loan_term_months: number | null;
  loan_original_principal: number | null;
  monthly_payment: number | null;
  escrow_payment: number | null;
  /** Revolving lines: interest-only by default, or a percentage of the balance. */
  minimum_payment_mode: MinimumPaymentMode;
  minimum_payment_percent: number | null;
}

type MinimumPaymentMode = "INTEREST" | "PERCENT";

const MINIMUM_PAYMENT_MODES: ReadonlyArray<readonly [MinimumPaymentMode, string]> = [
  ["INTEREST", "Interest only"],
  ["PERCENT", "% of balance"],
];

function emptyForm(type: AccountType): AccountForm {
  const meta = getAccountTypeMeta(type);
  return {
    name: "",
    type,
    institution: "",
    account_number_mask: "",
    icon: meta.defaultIcon,
    color: meta.defaultColor,
    owner_member_id: "",
    current_balance: null,
    credit_limit: null,
    interest_rate: null,
    loan_term_months: null,
    loan_original_principal: null,
    monthly_payment: null,
    escrow_payment: null,
    minimum_payment_mode: "INTEREST",
    minimum_payment_percent: null,
  };
}

/** Mirrors the backend: interest-only, or % of balance but never below the interest. */
function estimateMinimumPayment(form: AccountForm): number {
  const balance = Math.abs(form.current_balance ?? 0);
  const interest = (balance * (form.interest_rate ?? 0)) / 100 / 12;
  if (form.minimum_payment_mode === "PERCENT" && form.minimum_payment_percent) {
    return Math.max(interest, (balance * form.minimum_payment_percent) / 100);
  }
  return interest;
}

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

  const [formData, setFormData] = useState<AccountForm>(() => emptyForm("CHECKING"));
  const estimatedMinimum = estimateMinimumPayment(formData);

  const handleOpenCreate = () => {
    setEditingAccount(null);
    setFormData(emptyForm("CHECKING"));
    setIsModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    const meta = getAccountTypeMeta(acc.type);
    // `|| null` leaves stored zeros blank, so there's no 0 to delete before typing.
    setFormData({
      name: acc.name,
      type: acc.type,
      institution: acc.institution || "",
      account_number_mask: acc.account_number_mask || "",
      icon: acc.icon || meta.defaultIcon,
      color: acc.color || meta.defaultColor,
      owner_member_id: acc.owner_member_id || "",
      current_balance: acc.current_balance || null,
      credit_limit: acc.credit_limit || null,
      interest_rate: acc.interest_rate || null,
      loan_term_months: acc.loan_term_months || null,
      loan_original_principal: acc.loan_original_principal || null,
      monthly_payment: acc.monthly_payment || null,
      escrow_payment: acc.escrow_payment || null,
      minimum_payment_mode: acc.minimum_payment_percent ? "PERCENT" : "INTEREST",
      minimum_payment_percent: acc.minimum_payment_percent || null,
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

  /** Type-specific fields. A blank field is saved as 0; `undefined` leaves it untouched. */
  const typeSpecificFields = (): Partial<Account> => {
    const { type } = formData;
    const loan = isLoanAccount(type);
    const revolving = isRevolvingAccount(type);
    return {
      credit_limit: type === "CREDIT_CARD" ? formData.credit_limit ?? 0 : undefined,
      interest_rate: loan ? formData.interest_rate ?? 0 : undefined,
      // A revolving line has no term, original principal or fixed payment: clear them.
      loan_term_months: revolving ? null : loan ? formData.loan_term_months ?? 0 : undefined,
      loan_original_principal: revolving
        ? null
        : loan
          ? formData.loan_original_principal ?? 0
          : undefined,
      monthly_payment: revolving ? null : loan ? formData.monthly_payment ?? 0 : undefined,
      minimum_payment_percent: revolving
        ? formData.minimum_payment_mode === "PERCENT"
          ? formData.minimum_payment_percent
          : null
        : undefined,
      escrow_payment: type === "MORTGAGE" ? formData.escrow_payment ?? 0 : undefined,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const common = {
      name: formData.name,
      institution: formData.institution || undefined,
      account_number_mask: formData.account_number_mask || undefined,
      owner_member_id: formData.owner_member_id || undefined,
      icon: formData.icon || null,
      color: formData.color || null,
      current_balance: formData.current_balance ?? 0,
      ...typeSpecificFields(),
    };
    try {
      if (editingAccount) {
        await api.updateAccount(editingAccount.id, common);
      } else {
        await api.createAccount({ ...common, type: formData.type, currency: "CAD" });
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
    .reduce((sum, a) => sum + a.current_balance, 0); // owed is positive; a credit is negative

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
          <Money value={totalAssets} className="block mt-2 font-display text-2xl font-medium leading-none text-main" />
        </div>
        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Liabilities and debt</div>
          <Money value={totalLiabilities} className="block mt-2 font-display text-2xl font-medium leading-none text-main" />
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
              <span className="text-xs tabular-nums font-normal text-muted">{tab.count}</span>
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
                    <span className="text-xs text-muted">
                      {isAsset ? "Current balance" : acc.current_balance < 0 ? "In credit" : "Owed"}
                    </span>
                    <Money
                      value={isAsset ? acc.current_balance : Math.abs(acc.current_balance)}
                      className={`text-lg font-medium ${
                        isAsset && acc.current_balance < 0 ? "text-negative" : "text-main"
                      }`}
                    />
                  </div>

                  {acc.type === "CREDIT_CARD" && !acc.credit_limit && (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(acc)}
                      className="text-xs text-muted hover:text-main underline-offset-4 hover:underline cursor-pointer"
                    >
                      Add a credit limit to see credit left
                    </button>
                  )}

                  {acc.interest_rate ? (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Interest rate (APR)</span>
                      <span className="tabular-nums text-sub">{acc.interest_rate}%</span>
                    </div>
                  ) : null}

                  {acc.credit_limit ? (
                    <div className="pt-1">
                      <CreditUsage balance={acc.current_balance} limit={acc.credit_limit} />
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
            className="w-full max-w-xl rounded-xl bg-surface border border-default shadow-xl max-h-[92vh] overflow-y-auto animate-in zoom-in-95"
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
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
              </div>

              {/* Balance */}
              <div>
                <label className={fieldLabel}>
                  {isAssetAccount(formData.type) ? "Current balance" : "Amount owed"}
                </label>
                <NumberField
                  step="0.01"
                  placeholder="0.00"
                  value={formData.current_balance}
                  onValueChange={(v) => setFormData({ ...formData, current_balance: v })}
                  className={`${inputClass} tabular-nums`}
                />
              </div>

              {/* Credit Limit for Credit Cards */}
              {formData.type === "CREDIT_CARD" && (
                <div>
                  <label className={fieldLabel}>Credit limit</label>
                  <NumberField
                    step="0.01"
                    min="0"
                    placeholder="10000"
                    value={formData.credit_limit}
                    onValueChange={(v) => setFormData({ ...formData, credit_limit: v })}
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
              )}

              {/* Revolving line of credit: rate and minimum payment, no term */}
              {isRevolvingAccount(formData.type) && (
                <>
                  <div>
                    <label className={fieldLabel}>Interest rate (APR %)</label>
                    <NumberField
                      step="0.01"
                      placeholder="7.2"
                      value={formData.interest_rate}
                      onValueChange={(v) => setFormData({ ...formData, interest_rate: v })}
                      className={`${inputClass} tabular-nums`}
                    />
                  </div>

                  <div>
                    <span className={fieldLabel} id="min-payment-label">Minimum payment</span>
                    <div className="flex flex-wrap items-center gap-3">
                      <div
                        role="radiogroup"
                        aria-labelledby="min-payment-label"
                        className="inline-flex p-0.5 rounded-lg border border-default bg-input"
                      >
                        {MINIMUM_PAYMENT_MODES.map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={formData.minimum_payment_mode === mode}
                            onClick={() => setFormData({ ...formData, minimum_payment_mode: mode })}
                            className={`h-8 px-3 rounded-md text-sm transition-colors cursor-pointer ${
                              formData.minimum_payment_mode === mode
                                ? "bg-surface-subtle text-main font-medium"
                                : "text-sub hover:text-main"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {formData.minimum_payment_mode === "PERCENT" && (
                        <div className="relative w-28 animate-in fade-in">
                          <NumberField
                            aria-label="Minimum payment, percent of balance"
                            step="any"
                            min="0.01"
                            max="100"
                            placeholder="3"
                            required
                            value={formData.minimum_payment_percent}
                            onValueChange={(v) =>
                              setFormData({ ...formData, minimum_payment_percent: v })
                            }
                            className={`${inputClass} pr-7 tabular-nums`}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
                            %
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-2 leading-relaxed">
                      A line of credit has no term. The balance goes up and down as you draw and repay.
                      {estimatedMinimum > 0 && (
                        <>
                          {" "}At today&apos;s balance the minimum is about{" "}
                          <span className="tabular-nums text-sub">{formatMoney(estimatedMinimum)}</span>{" "}
                          a month.
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}

              {/* Term Loan / Mortgage Fields */}
              {isLoanAccount(formData.type) && !isRevolvingAccount(formData.type) && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={fieldLabel}>Interest rate (APR %)</label>
                      <NumberField
                        step="0.01"
                        placeholder="5.5"
                        value={formData.interest_rate}
                        onValueChange={(v) => setFormData({ ...formData, interest_rate: v })}
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Term (months)</label>
                      <NumberField
                        integer
                        min="1"
                        placeholder="300"
                        value={formData.loan_term_months}
                        onValueChange={(v) => setFormData({ ...formData, loan_term_months: v })}
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={fieldLabel}>Original principal</label>
                      <NumberField
                        step="1000"
                        placeholder="350000"
                        value={formData.loan_original_principal}
                        onValueChange={(v) =>
                          setFormData({ ...formData, loan_original_principal: v })
                        }
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Monthly payment</label>
                      <NumberField
                        step="10"
                        placeholder="2200"
                        value={formData.monthly_payment}
                        onValueChange={(v) => setFormData({ ...formData, monthly_payment: v })}
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                  </div>

                  {formData.type === "MORTGAGE" && (
                    <div>
                      <label className={fieldLabel}>Escrow payment (taxes and insurance)</label>
                      <NumberField
                        step="10"
                        placeholder="450"
                        value={formData.escrow_payment}
                        onValueChange={(v) => setFormData({ ...formData, escrow_payment: v })}
                        className={`${inputClass} tabular-nums`}
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
          balance={formData.current_balance ?? 0}
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
