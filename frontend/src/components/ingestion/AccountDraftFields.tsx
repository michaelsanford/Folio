import React, { useMemo } from "react";
import type { Account, AccountType } from "../../types";
import {
  ACCOUNT_CATEGORY_LABELS,
  CANADIAN_ACCOUNT_TYPES,
  type AccountCategoryGroup,
} from "../../constants/canadianAccountTypes";

export const compactSelectClass =
  "h-8 px-2 rounded-lg border border-default bg-input text-xs text-main focus:outline-none focus:border-[var(--accent-primary)]";
export const compactInputClass =
  "h-8 px-2.5 rounded-lg border border-default bg-input text-xs text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";

const CATEGORY_ORDER: AccountCategoryGroup[] = ["CASH", "REGISTERED", "INVESTMENT", "DEBT", "ASSET"];

/** Where an imported account's rows go: an existing account, or a new one described here. */
export interface AccountResolutionDraft {
  mode: "create" | "existing";
  existing_account_id: string;
  name: string;
  type: AccountType;
  institution: string;
  account_number_mask: string;
  currency: string;
}

interface DestinationSelectProps {
  id: string;
  draft: AccountResolutionDraft;
  accounts: Account[];
  onChange: (patch: Partial<AccountResolutionDraft>) => void;
}

/** "Create new account" or one of `accounts`. */
export const DestinationSelect: React.FC<DestinationSelectProps> = ({ id, draft, accounts, onChange }) => (
  <div className="flex items-center gap-2 min-w-0 shrink-0">
    <label htmlFor={id} className="text-xs text-sub shrink-0">
      Destination
    </label>
    <select
      id={id}
      value={draft.mode === "existing" && draft.existing_account_id ? draft.existing_account_id : "create"}
      onChange={(e) => {
        const val = e.target.value;
        onChange(
          val === "create"
            ? { mode: "create", existing_account_id: "" }
            : { mode: "existing", existing_account_id: val }
        );
      }}
      className={`max-w-full truncate ${compactSelectClass}`}
    >
      <option value="create">Create new account</option>
      {accounts.map((acc) => (
        <option key={acc.id} value={acc.id}>
          {acc.name}
          {acc.account_number_mask ? ` (${acc.account_number_mask})` : ""}
        </option>
      ))}
    </select>
  </div>
);

interface NewAccountFieldsProps {
  draft: AccountResolutionDraft;
  /** Names the account in the fields' accessible labels. */
  label: string;
  onChange: (patch: Partial<AccountResolutionDraft>) => void;
  /** Limit the type list, e.g. to investment and registered accounts. */
  allowedTypes?: (type: AccountType) => boolean;
}

/** Name, type, institution and currency for an account the import will create. */
export const NewAccountFields: React.FC<NewAccountFieldsProps> = ({ draft, label, onChange, allowedTypes }) => {
  const groupedAccountTypes = useMemo(() => {
    const groups: Record<AccountCategoryGroup, { type: AccountType; name: string }[]> = {
      CASH: [],
      REGISTERED: [],
      INVESTMENT: [],
      DEBT: [],
      ASSET: [],
    };
    (Object.values(CANADIAN_ACCOUNT_TYPES) as Array<(typeof CANADIAN_ACCOUNT_TYPES)[AccountType]>).forEach(
      (meta) => {
        if (!allowedTypes || allowedTypes(meta.type)) {
          groups[meta.category].push({ type: meta.type, name: meta.name });
        }
      }
    );
    return groups;
  }, [allowedTypes]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pl-0 sm:pl-6">
      <div>
        <label className="block text-[11px] text-muted mb-1">Name</label>
        <input
          type="text"
          value={draft.name}
          maxLength={100}
          aria-label={`Account name for ${label}`}
          onChange={(e) => onChange({ name: e.target.value })}
          className={`w-full ${compactInputClass}`}
        />
      </div>

      <div>
        <label className="block text-[11px] text-muted mb-1">Type</label>
        <select
          value={draft.type}
          aria-label={`Account type for ${label}`}
          onChange={(e) => onChange({ type: e.target.value as AccountType })}
          className={`w-full ${compactSelectClass}`}
        >
          {CATEGORY_ORDER.filter((group) => groupedAccountTypes[group].length > 0).map((group) => (
            <optgroup key={group} label={ACCOUNT_CATEGORY_LABELS[group]}>
              {groupedAccountTypes[group].map((opt) => (
                <option key={opt.type} value={opt.type}>
                  {opt.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] text-muted mb-1">Institution</label>
        <input
          type="text"
          value={draft.institution}
          maxLength={100}
          placeholder="Optional (e.g. RBC)"
          aria-label={`Institution for ${label}`}
          onChange={(e) => onChange({ institution: e.target.value })}
          className={`w-full ${compactInputClass}`}
        />
      </div>

      <div>
        <label className="block text-[11px] text-muted mb-1">Currency</label>
        <input
          type="text"
          value={draft.currency}
          maxLength={3}
          aria-label={`Currency for ${label}`}
          onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
          className={`w-full uppercase ${compactInputClass}`}
        />
      </div>
    </div>
  );
};
