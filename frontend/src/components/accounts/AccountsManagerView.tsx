import React, { useState } from "react";
import { Plus, Edit2, Trash2, Info, Users, X, Lock, EyeOff, MoreHorizontal, Palette } from "lucide-react";
import type { Account, AccountType, AccountVisibility, HouseholdMember } from "../../types";
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
import { useCanEdit, useSession } from "../../hooks/useSession";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { ActionSheet, type SheetAction } from "../common/ActionSheet";
import {
  chipTab,
  dangerIconButton,
  iconButton,
  inputClass,
  labelText,
  loneText,
  modalOverlay,
  modalPanel,
  pageStack,
  primaryButton,
  secondaryButton,
  section,
} from "../common/ui";

const fieldLabel = "block text-sm text-sub mb-2";

/** Number fields are `null` while blank, so a cleared field stays cleared. */
interface AccountForm {
  name: string;
  type: AccountType;
  institution: string;
  account_number_mask: string;
  icon: string;
  color: string;
  owner_member_ids: string[];
  visibility: AccountVisibility;
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

const VISIBILITY_OPTIONS: ReadonlyArray<{ value: AccountVisibility; label: string; hint: string }> = [
  { value: "HOUSEHOLD", label: "Household", hint: "Everyone sees it and its transactions." },
  {
    value: "TOTALS",
    label: "Totals only",
    hint: "Others see it in household totals, not its name, details or transactions.",
  },
  { value: "PRIVATE", label: "Private", hint: "Only its owners know it exists." },
];

/** Who owns the account, for its card. */
function ownerLabel(acc: Account, members: HouseholdMember[] | undefined): string {
  const names =
    acc.owner_names && acc.owner_names.length > 0
      ? acc.owner_names
      : (acc.owner_member_ids ?? []).map((id) => members?.find((m) => m.id === id)?.name).filter(Boolean);
  return names.length > 0 ? names.join(" & ") : "Shared";
}

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
    owner_member_ids: [],
    visibility: "HOUSEHOLD",
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
  const canEdit = useCanEdit();
  const { me } = useSession();
  const myMemberId = me?.member_id ?? null;
  const sharedHousehold = !!me?.shared_household;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [ruleModalType, setRuleModalType] = useState<AccountType | null>(null);
  const [activeFilterCategory, setActiveFilterCategory] = useState<
    AccountCategoryGroup | "ALL" | "ASSETS" | "LIABILITIES"
  >("ALL");

  const [directCustomizingAccount, setDirectCustomizingAccount] = useState<Account | null>(null);
  const isPhone = useIsPhone();
  const [sheetAccount, setSheetAccount] = useState<Account | null>(null);

  const [formData, setFormData] = useState<AccountForm>(() => emptyForm("CHECKING"));
  const estimatedMinimum = estimateMinimumPayment(formData);

  const handleOpenCreate = () => {
    setEditingAccount(null);
    setFormData({ ...emptyForm("CHECKING"), owner_member_ids: myMemberId ? [myMemberId] : [] });
    setIsModalOpen(true);
  };

  // Mirrors the server: only an account's owners decide who sees it.
  const canChangeVisibility =
    !editingAccount ||
    (editingAccount.owner_member_ids ?? []).length === 0 ||
    (!!myMemberId && (editingAccount.owner_member_ids ?? []).includes(myMemberId));
  const hidingNeedsMe =
    formData.visibility !== "HOUSEHOLD" && (!myMemberId || !formData.owner_member_ids.includes(myMemberId));

  const toggleOwner = (memberId: string) =>
    setFormData((prev) => ({
      ...prev,
      owner_member_ids: prev.owner_member_ids.includes(memberId)
        ? prev.owner_member_ids.filter((id) => id !== memberId)
        : [...prev.owner_member_ids, memberId],
    }));

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
      owner_member_ids: acc.owner_member_ids ?? [],
      visibility: acc.visibility ?? "HOUSEHOLD",
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
      owner_member_ids: formData.owner_member_ids,
      ...(sharedHousehold && canChangeVisibility ? { visibility: formData.visibility } : {}),
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
    <div className={`max-w-7xl mx-auto ${pageStack}`}>
      {/* Header */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl leading-tight font-semibold text-main">Accounts</h1>
          <p className="text-sm text-sub mt-1">
            Registered accounts (TFSA, RRSP, FHSA, RESP), deposit accounts, mortgages and loans
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onManageHousehold && (
            <button type="button" onClick={onManageHousehold} className={secondaryButton}>
              <Users className="w-4 h-4" strokeWidth={1.5} /> Manage household
            </button>
          )}
          {canEdit && (
          <button onClick={handleOpenCreate} className={primaryButton}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add account
          </button>
          )}
        </div>
      </header>

      {/* Totals, set straight on the page */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-8">
        <div className="min-w-0">
          <div className={labelText}>Assets</div>
          <Money value={totalAssets} className="block mt-2 font-display text-2xl md:text-3xl font-medium leading-none text-main" />
        </div>
        <div className="min-w-0">
          <div className={labelText}>Liabilities and debt</div>
          <Money value={totalLiabilities} className="block mt-2 font-display text-2xl md:text-3xl font-medium leading-none text-main" />
        </div>
        <div className="min-w-0">
          <div className={labelText}>Net position</div>
          <Money
            value={totalAssets - totalLiabilities}
            className={`block mt-2 font-display text-2xl md:text-3xl font-medium leading-none ${
              totalAssets - totalLiabilities >= 0 ? "text-main" : "text-negative"
            }`}
          />
        </div>
      </div>

      <section className={section}>
      {/* Filter Category Tabs */}
      <div className="flex flex-wrap items-center gap-x-1 border-b border-subtle">
        {filterTabs.map((tab) => {
          const isActive = activeFilterCategory === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveFilterCategory(tab.id)}
              aria-pressed={isActive}
              className={chipTab(isActive)}
            >
              <span>{tab.label}</span>
              <span className="text-sm tabular-nums font-normal text-sub">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* Accounts, as a ruled grid of open items */}
      {displayedAccounts.length > 0 ? (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10">
          {displayedAccounts.map((acc) => {
            const meta = getAccountTypeMeta(acc.type);
            const isAsset = isAssetAccount(acc.type);

            if (acc.redacted) {
              return (
                <div key={acc.id} className="min-w-0 py-6 border-b border-subtle flex flex-col justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-10 w-10 shrink-0 rounded-lg bg-surface-subtle flex items-center justify-center">
                      <Lock className="w-4 h-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-lg font-medium text-main break-words">{acc.name}</h3>
                      <p className="text-sm text-sub break-words mt-0.5">
                        {meta.shortName} · shared as totals only
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm text-sub">{isAsset ? "Current balance" : "Owed"}</span>
                    <Money
                      value={isAsset ? acc.current_balance : Math.abs(acc.current_balance)}
                      className="text-lg font-medium text-main"
                    />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={acc.id}
                className="min-w-0 py-6 border-b border-subtle flex flex-col justify-between"
                onClick={
                  isPhone
                    ? (e) => {
                        // Tapping the card opens its sheet; its own controls still work.
                        if (!(e.target as HTMLElement).closest("button, a, input, select")) setSheetAccount(acc);
                      }
                    : undefined
                }
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <AccountIcon
                        type={acc.type}
                        icon={acc.icon}
                        color={acc.color}
                        size="lg"
                        editable={!isPhone}
                        onClick={isPhone ? undefined : () => setDirectCustomizingAccount(acc)}
                        title={isPhone ? undefined : "Change icon and colour"}
                      />
                      <div className="min-w-0">
                        <h3 className="text-lg font-medium text-main break-words">
                          {acc.name}
                        </h3>
                        <p className="text-sm text-sub break-words mt-0.5">
                          {acc.institution || meta.shortName}
                          {acc.account_number_mask ? ` ··${acc.account_number_mask}` : ""}
                        </p>
                      </div>
                    </div>

                    {isPhone ? (
                      <button
                        type="button"
                        aria-label={`${acc.name}: details and actions`}
                        onClick={() => setSheetAccount(acc)}
                        className={iconButton}
                      >
                        <MoreHorizontal className="w-5 h-5" strokeWidth={1.75} />
                      </button>
                    ) : (
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
                      {canEdit && (<>
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
                        className={dangerIconButton}
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      </>)}
                    </div>
                    )}
                  </div>

                  {/* Badge */}
                  <div className="mt-4 flex items-center gap-x-3 gap-y-1 flex-wrap text-sm">
                    <span className="rounded-md px-1.5 py-0.5 text-xs font-mono bg-surface-subtle text-sub break-words max-w-full">
                      {meta.badge}
                    </span>
                    <span className="text-sub">
                      {ACCOUNT_CATEGORY_LABELS[meta.category]}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sub">
                      {(acc.owner_member_ids ?? []).map((id) => {
                        const owner = householdMembers?.find((m) => m.id === id);
                        return (
                          <span
                            key={id}
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: owner?.color || "#6b7280" }}
                          />
                        );
                      })}
                      {ownerLabel(acc, householdMembers)}
                    </span>
                    {acc.visibility === "TOTALS" && (
                      <span className="inline-flex items-center gap-1 text-sub" title="Others see it in totals only">
                        <EyeOff className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" /> Totals only
                      </span>
                    )}
                    {acc.visibility === "PRIVATE" && (
                      <span className="inline-flex items-center gap-1 text-sub" title="Only its owners see it">
                        <Lock className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" /> Private
                      </span>
                    )}
                  </div>
                </div>

                {/* Balance & Financial Details */}
                <div className="mt-5 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm text-sub">
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
                      className="min-h-11 md:min-h-0 text-left text-sm text-sub hover:text-main underline-offset-4 hover:underline cursor-pointer"
                    >
                      Add a credit limit to see credit left
                    </button>
                  )}

                  {acc.interest_rate ? (
                    <div className="flex flex-wrap items-center justify-between gap-x-2 text-sm text-sub">
                      <span>Interest rate (APR)</span>
                      <span className="tabular-nums text-main">{acc.interest_rate}%</span>
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
        <div className={`py-16 px-4 text-center flex flex-col items-center gap-6 ${loneText}`}>
          <p>No accounts in this category</p>
          {canEdit && (
          <button onClick={handleOpenCreate} className={primaryButton}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add account
          </button>
          )}
        </div>
      )}
      </section>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className={modalOverlay}>
          <form
            onSubmit={handleSubmit}
            className={`${modalPanel} md:max-w-xl`}
          >
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="min-w-0">
                <h3 className="font-display text-xl md:text-2xl font-semibold text-main">
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
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-6 text-base">
              {/* Account Type Picker */}
              <div>
                <label className={fieldLabel}>Account type</label>
                <AccountTypePicker
                  value={formData.type}
                  onChange={handleTypeChange}
                />
              </div>

              {/* Owners (household members) */}
              <fieldset>
                <legend className={fieldLabel}>Owners</legend>
                {householdMembers && householdMembers.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {householdMembers.map((m) => {
                      const selected = formData.owner_member_ids.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleOwner(m.id)}
                          className={`min-h-11 md:min-h-9 px-4 py-1 inline-flex items-center gap-2 rounded-full text-base md:text-sm transition-colors cursor-pointer ${
                            selected
                              ? "bg-accent-subtle text-accent-subtle font-semibold"
                              : "bg-surface-subtle text-sub hover:text-main"
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color || "#6b7280" }} />
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-sub">Add household members to record who owns each account.</p>
                )}
                <p className="text-sm text-sub mt-2 leading-relaxed">
                  None selected means shared. In Canada, registered accounts (TFSA, RRSP, FHSA) are individual legal registrations. Joint ownership applies to chequing, savings and mortgages.
                </p>
              </fieldset>

              {sharedHousehold && (
                <fieldset disabled={!canChangeVisibility}>
                  <legend className={fieldLabel}>Who can see it</legend>
                  <div className="space-y-2">
                    {VISIBILITY_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                          formData.visibility === opt.value ? "bg-accent-subtle" : "bg-surface-hover"
                        } ${canChangeVisibility ? "" : "opacity-60 cursor-default"}`}
                      >
                        <input
                          type="radio"
                          name="account-visibility"
                          value={opt.value}
                          checked={formData.visibility === opt.value}
                          onChange={() => setFormData({ ...formData, visibility: opt.value })}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block text-base md:text-sm font-medium text-main break-words">{opt.label}</span>
                          <span className="block text-sm text-sub break-words">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {!canChangeVisibility && (
                    <p className="text-sm text-sub mt-2">Only this account&rsquo;s owners can change who sees it.</p>
                  )}
                  {canChangeVisibility && hidingNeedsMe && (
                    <p role="alert" className="text-sm text-negative mt-2">
                      Add yourself as an owner to hide it from others.
                    </p>
                  )}
                </fieldset>
              )}

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
                  <div className="flex-1 min-w-0">
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
                        className="inline-flex flex-wrap gap-1 p-1 rounded-lg bg-surface-subtle"
                      >
                        {MINIMUM_PAYMENT_MODES.map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={formData.minimum_payment_mode === mode}
                            onClick={() => setFormData({ ...formData, minimum_payment_mode: mode })}
                            className={`min-h-11 md:min-h-9 px-3 rounded-md text-base md:text-sm transition-colors cursor-pointer ${
                              formData.minimum_payment_mode === mode
                                ? "bg-accent-subtle text-accent-subtle font-semibold"
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
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-sub pointer-events-none">
                            %
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-sub mt-2 leading-relaxed">
                      A line of credit has no term. The balance goes up and down as you draw and repay.
                      {estimatedMinimum > 0 && (
                        <>
                          {" "}At today&apos;s balance the minimum is about{" "}
                          <span className="tabular-nums text-main">{formatMoney(estimatedMinimum)}</span>{" "}
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

            <div className="flex flex-wrap justify-end gap-2 mt-8">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${primaryButton} disabled:opacity-50 disabled:cursor-default`}
                disabled={sharedHousehold && canChangeVisibility && hidingNeedsMe}
              >
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

      {/* Phone: a card's details and actions */}
      {sheetAccount && (
        <ActionSheet
          open
          onClose={() => setSheetAccount(null)}
          title={sheetAccount.name}
          subtitle={[
            sheetAccount.institution || getAccountTypeMeta(sheetAccount.type).shortName,
            sheetAccount.account_number_mask ? `··${sheetAccount.account_number_mask}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          actions={[
            { label: "Canadian rules", icon: Info, onSelect: () => setRuleModalType(sheetAccount.type) },
            ...(canEdit
              ? ([
                  { label: "Change icon and colour", icon: Palette, onSelect: () => setDirectCustomizingAccount(sheetAccount) },
                  { label: "Edit account", icon: Edit2, onSelect: () => handleOpenEdit(sheetAccount) },
                  { label: "Delete account", icon: Trash2, destructive: true, onSelect: () => handleDelete(sheetAccount.id) },
                ] satisfies SheetAction[])
              : []),
          ]}
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
