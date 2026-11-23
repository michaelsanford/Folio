import React, { useState, useRef, useMemo } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Building2,
  AlertCircle,
} from "lucide-react";
import type {
  Account,
  AccountType,
  Category,
  IngestionAccountResolution,
  IngestionPreviewResponse,
  ParsedTransactionItem,
} from "../../types";
import { api } from "../../services/api";
import { Money } from "../common/Money";
import { formatMoney } from "../../utils/format";
import {
  ACCOUNT_CATEGORY_LABELS,
  CANADIAN_ACCOUNT_TYPES,
  type AccountCategoryGroup,
} from "../../constants/canadianAccountTypes";

const selectClass =
  "h-9 px-3 rounded-lg border border-default bg-input text-sm text-main focus:outline-none focus:border-[var(--accent-primary)]";
const compactSelectClass =
  "h-8 px-2 rounded-lg border border-default bg-input text-xs text-main focus:outline-none focus:border-[var(--accent-primary)]";
const compactInputClass =
  "h-8 px-2.5 rounded-lg border border-default bg-input text-xs text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";
const checkboxClass = "rounded border-default bg-input text-accent-main focus:ring-accent-main";
const chip = "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs";

const CATEGORY_ORDER: AccountCategoryGroup[] = [
  "CASH",
  "REGISTERED",
  "INVESTMENT",
  "DEBT",
  "ASSET",
];

interface AccountResolutionDraft {
  mode: "create" | "existing";
  existing_account_id: string;
  name: string;
  type: AccountType;
  institution: string;
  account_number_mask: string;
  currency: string;
}

interface IngestionWorkspaceProps {
  accounts: Account[];
  categories: Category[];
  onCommitSuccess: () => void;
}

function makeRowKey(item: ParsedTransactionItem, idx: number): string {
  return `${item.import_hash}::${idx}`;
}

const GENERIC_BANK_PAYEES = new Set([
  "MISC PAYMENT",
  "MISCELLANEOUS PAYMENT",
  "PAYMENT",
  "PAIEMENT",
  "ONLINE PAYMENT",
  "BILL PAYMENT",
  "BILL PMT",
  "SCHEDULED PAYMENT",
  "TRANSFER",
  "TRANSFERT",
  "VIREMENT",
  "EMAIL TRFS",
  "E-TRANSFER",
  "INTERAC E-TRANSFER",
  "DEPOSIT",
  "DEPOT",
  "DÉPÔT",
  "WITHDRAWAL",
  "RETRAIT",
  "CASH WITHDRAWAL",
  "LOAN",
  "LOAN PMT",
  "LOAN PAYMENT",
  "MORTGAGE",
  "INTEREST PAYMENT",
  "DEBIT",
  "CREDIT",
  "PURCHASE",
  "POS PURCHASE",
  "C-IDP PURCHASE",
  "IDP PURCHASE",
  "BR TO BR",
  "CHEQUE",
  "CHECK",
  "ATM",
  "ABM",
]);

const GENERIC_BANK_PAYEE_PREFIXES = [
  "WWW TRF",
  "WWW TFR",
  "WWW TRANSFER",
  "WWW PMT",
  "BR TO BR",
  "C-IDP PURCHASE",
  "IDP PURCHASE",
  "EMAIL TRF",
  "E-TRANSFER",
];

function isGenericPayee(rawPayee: string | null | undefined): boolean {
  const collapsed = (rawPayee || "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!collapsed) return true;
  const stripped = collapsed
    .replace(/(?:\s*#\s*\d+|\s*-\s*\d+|\s+\d{3,})+$/g, "")
    .replace(/^[\s-]+|[\s-]+$/g, "");
  if (!stripped || GENERIC_BANK_PAYEES.has(collapsed) || GENERIC_BANK_PAYEES.has(stripped)) {
    return true;
  }
  return GENERIC_BANK_PAYEE_PREFIXES.some(
    (prefix) => collapsed.startsWith(prefix) || stripped.startsWith(prefix)
  );
}

function resolveCategoryId(
  suggestedId: string | null | undefined,
  suggestedName: string | null | undefined,
  categories: Category[]
): string {
  if (suggestedId && categories.some((c) => c.id === suggestedId)) {
    return suggestedId;
  }
  if (suggestedName) {
    const targetName = suggestedName.trim().toLowerCase();
    const matched = categories.find((c) => c.name.trim().toLowerCase() === targetName);
    if (matched) {
      return matched.id;
    }
  }
  return suggestedId || "";
}

function getEffectiveCategory(
  rowKey: string,
  item: ParsedTransactionItem,
  rowCategories: Record<string, string>,
  categories: Category[]
): string {
  if (Object.prototype.hasOwnProperty.call(rowCategories, rowKey)) {
    const val = rowCategories[rowKey] ?? "";
    if (!val) return "";
    if (categories.some((c) => c.id === val)) {
      return val;
    }
    return resolveCategoryId(val, item.suggested_category_name, categories);
  }
  return resolveCategoryId(item.suggested_category_id, item.suggested_category_name, categories);
}

export const IngestionWorkspace: React.FC<IngestionWorkspaceProps> = ({
  accounts,
  categories,
  onCommitSuccess,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [preview, setPreview] = useState<IngestionPreviewResponse | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [rowCategories, setRowCategories] = useState<Record<string, string>>({});
  const [accountResolutions, setAccountResolutions] = useState<
    Record<string, AccountResolutionDraft>
  >({});
  const [activeAccountFilter, setActiveAccountFilter] = useState<string>("ALL");
  const [autoDetectTransfers, setAutoDetectTransfers] = useState<boolean>(true);
  const [propagationNote, setPropagationNote] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAccount = accounts.find((a) => a.id === selectedAccountId);
  const detectedAccounts = preview?.detected_accounts ?? [];

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
        groups[meta.category].push({ type: meta.type, name: meta.name });
      }
    );
    return groups;
  }, []);

  const indexedItems = useMemo(() => {
    if (!preview) return [];
    return preview.items.map((item, idx) => ({
      item,
      idx,
      rowKey: makeRowKey(item, idx),
    }));
  }, [preview]);

  const visibleItems = useMemo(() => {
    if (activeAccountFilter === "ALL") return indexedItems;
    return indexedItems.filter(
      ({ item }) => item.source_account_key === activeAccountFilter
    );
  }, [indexedItems, activeAccountFilter]);

  const getResolvedAccountLabel = (item: ParsedTransactionItem): string => {
    if (item.source_account_key && accountResolutions[item.source_account_key]) {
      const draft = accountResolutions[item.source_account_key];
      if (draft.mode === "existing" && draft.existing_account_id) {
        const existing = accounts.find((a) => a.id === draft.existing_account_id);
        if (existing) return existing.name;
      }
      if (draft.name.trim()) return draft.name.trim();
    }
    return item.account_label || activeAccount?.name || "Imported Account";
  };

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    setPropagationNote(null);
    try {
      const resp = await api.uploadStatementPreview(selectedAccountId || null, file);
      setPreview(resp);
      setActiveAccountFilter("ALL");

      const initialSelected = new Set<string>();
      const initialCats: Record<string, string> = {};

      resp.items.forEach((item, idx) => {
        const rk = makeRowKey(item, idx);
        if (!item.is_duplicate) {
          initialSelected.add(rk);
        }
        const resolvedCatId = resolveCategoryId(
          item.suggested_category_id,
          item.suggested_category_name,
          categories
        );
        if (resolvedCatId) {
          initialCats[rk] = resolvedCatId;
        }
      });

      const initialResolutions: Record<string, AccountResolutionDraft> = {};
      (resp.detected_accounts || []).forEach((det) => {
        const matched = Boolean(det.matched_account_id);
        initialResolutions[det.source_account_key] = {
          mode: matched ? "existing" : "create",
          existing_account_id: det.matched_account_id || "",
          name: det.suggested_name,
          type: det.suggested_type,
          institution: det.institution || "",
          account_number_mask: det.account_number_mask || "",
          currency: det.currency || "CAD",
        };
      });

      setSelectedRowKeys(initialSelected);
      setRowCategories(initialCats);
      setAccountResolutions(initialResolutions);
    } catch (err: any) {
      setErrorMessage(`Ingestion failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleToggleSelectAll = () => {
    if (!preview || visibleItems.length === 0) return;
    const allVisibleSelected = visibleItems.every(({ rowKey }) =>
      selectedRowKeys.has(rowKey)
    );
    const next = new Set(selectedRowKeys);
    if (allVisibleSelected) {
      visibleItems.forEach(({ rowKey }) => next.delete(rowKey));
    } else {
      visibleItems.forEach(({ rowKey }) => next.add(rowKey));
    }
    setSelectedRowKeys(next);
  };

  const handleToggleRowKey = (rowKey: string) => {
    const next = new Set(selectedRowKeys);
    if (next.has(rowKey)) {
      next.delete(rowKey);
    } else {
      next.add(rowKey);
    }
    setSelectedRowKeys(next);
  };

  const handleToggleAccountItems = (sourceKey: string) => {
    const accountItems = indexedItems.filter(
      ({ item }) => item.source_account_key === sourceKey
    );
    if (accountItems.length === 0) return;

    const anySelected = accountItems.some(({ rowKey }) =>
      selectedRowKeys.has(rowKey)
    );
    const next = new Set(selectedRowKeys);
    if (anySelected) {
      accountItems.forEach(({ rowKey }) => next.delete(rowKey));
    } else {
      const nonDuplicates = accountItems.filter(({ item }) => !item.is_duplicate);
      const targets = nonDuplicates.length > 0 ? nonDuplicates : accountItems;
      targets.forEach(({ rowKey }) => next.add(rowKey));
    }
    setSelectedRowKeys(next);
  };

  const handleCategoryChange = (rowKey: string, categoryId: string) => {
    const targetEntry = indexedItems.find((entry) => entry.rowKey === rowKey);

    if (!categoryId || !targetEntry) {
      setPropagationNote(null);
      setRowCategories((prev) => ({
        ...prev,
        [rowKey]: categoryId,
      }));
      return;
    }

    const targetRaw = targetEntry.item.raw_payee.trim().toUpperCase();
    const targetNotes = (targetEntry.item.notes || "").trim().toUpperCase();
    const targetNorm = targetEntry.item.normalized_payee.trim().toUpperCase();
    const generic = isGenericPayee(targetRaw);

    const matchingKeys = indexedItems
      .filter((other) => {
        if (other.rowKey === rowKey) return false;
        if (getEffectiveCategory(other.rowKey, other.item, rowCategories, categories)) return false;

        const otherRaw = other.item.raw_payee.trim().toUpperCase();
        const otherNotes = (other.item.notes || "").trim().toUpperCase();
        const otherNorm = other.item.normalized_payee.trim().toUpperCase();

        const sameRawAndNotes =
          otherRaw === targetRaw &&
          otherNotes === targetNotes &&
          (!generic || targetNotes.length > 0);
        const sameNonGenericNormalized =
          !generic && targetNorm.length >= 3 && otherNorm === targetNorm;

        return sameRawAndNotes || sameNonGenericNormalized;
      })
      .map((other) => other.rowKey);

    setRowCategories((prev) => {
      const next: Record<string, string> = {
        ...prev,
        [rowKey]: categoryId,
      };
      for (const matchKey of matchingKeys) {
        next[matchKey] = categoryId;
      }
      return next;
    });

    setPropagationNote(
      matchingKeys.length > 0
        ? `Applied to ${matchingKeys.length + 1} matching rows`
        : null
    );
  };

  const updateAccountResolution = (
    sourceKey: string,
    patch: Partial<AccountResolutionDraft>
  ) => {
    setAccountResolutions((prev) => ({
      ...prev,
      [sourceKey]: {
        ...prev[sourceKey],
        ...patch,
      },
    }));
  };

  const handleCommit = async () => {
    if (!preview || selectedRowKeys.size === 0) return;
    setErrorMessage(null);

    const chosenEntries = indexedItems.filter(({ rowKey }) =>
      selectedRowKeys.has(rowKey)
    );
    if (chosenEntries.length === 0) return;

    const hasDetectedAccounts = detectedAccounts.length > 0;
    const referencedKeys = new Set(
      chosenEntries
        .map(({ item }) => item.source_account_key)
        .filter((k): k is string => Boolean(k))
    );

    let accountsPayload: IngestionAccountResolution[] | undefined;
    if (hasDetectedAccounts) {
      accountsPayload = [];
      for (const det of detectedAccounts) {
        if (!referencedKeys.has(det.source_account_key)) continue;
        const draft = accountResolutions[det.source_account_key];
        if (!draft) continue;

        if (draft.mode === "existing" && draft.existing_account_id) {
          accountsPayload.push({
            source_account_key: det.source_account_key,
            existing_account_id: draft.existing_account_id,
            type: draft.type,
            currency: (draft.currency || "CAD").trim().toUpperCase() || "CAD",
          });
        } else {
          if (!draft.name.trim()) {
            setErrorMessage(
              `Please enter a name for "${det.suggested_name}" before importing.`
            );
            return;
          }
          accountsPayload.push({
            source_account_key: det.source_account_key,
            name: draft.name.trim(),
            type: draft.type,
            institution: draft.institution.trim() || null,
            account_number_mask: draft.account_number_mask || null,
            currency: (draft.currency || "CAD").trim().toUpperCase() || "CAD",
          });
        }
      }
    }

    setIsCommitting(true);
    try {
      const itemsToCommit = chosenEntries.map(({ item, rowKey }) => {
        const effectiveCatId = getEffectiveCategory(
          rowKey,
          item,
          rowCategories,
          categories
        );
        const effectiveCatName = effectiveCatId
          ? categories.find((c) => c.id === effectiveCatId)?.name ||
            item.suggested_category_name ||
            undefined
          : undefined;
        return {
          transaction_date: item.transaction_date,
          raw_payee: item.raw_payee,
          normalized_payee: item.normalized_payee,
          amount: item.amount,
          currency: item.currency,
          category_id: effectiveCatId || undefined,
          category_name: effectiveCatName,
          notes: item.notes || undefined,
          import_hash: item.import_hash,
          source_account_key: item.source_account_key || undefined,
          account_id: hasDetectedAccounts
            ? undefined
            : item.account_id || selectedAccountId || undefined,
        };
      });

      const res = await api.commitIngestionBatch({
        account_id: hasDetectedAccounts
          ? undefined
          : preview.account_id || selectedAccountId || undefined,
        statement_file_id: preview.file_id ?? undefined,
        accounts: accountsPayload,
        auto_detect_transfers: autoDetectTransfers,
        items: itemsToCommit,
      });

      const parts: string[] = [`Imported ${res.committed_count} transactions`];
      if (res.accounts && res.accounts.length > 1) {
        const createdNote =
          res.accounts_created_count > 0
            ? ` (${res.accounts_created_count} created)`
            : "";
        parts.push(`across ${res.accounts.length} accounts${createdNote}`);
      } else if (res.accounts && res.accounts.length === 1) {
        const acc = res.accounts[0];
        const createdNote = acc.created ? " (new account)" : "";
        parts.push(
          `to ${acc.account_name}${createdNote} · new balance ${formatMoney(acc.new_account_balance)}`
        );
      } else if (activeAccount) {
        parts.push(
          `to ${activeAccount.name} · new balance ${formatMoney(res.new_account_balance)}`
        );
      }

      if (res.transfers_linked_count > 0) {
        const label = res.transfers_linked_count === 1 ? "transfer" : "transfers";
        parts.push(`· ${res.transfers_linked_count} ${label} paired`);
      }

      setSuccessMessage(parts.join(" "));
      setPreview(null);
      setSelectedRowKeys(new Set());
      setRowCategories({});
      setAccountResolutions({});
      setActiveAccountFilter("ALL");
      setPropagationNote(null);
      onCommitSuccess();
    } catch (err: any) {
      setErrorMessage(`Commit error: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  const matchedCount = detectedAccounts.filter((det) => {
    const draft = accountResolutions[det.source_account_key];
    return draft ? draft.mode === "existing" && Boolean(draft.existing_account_id) : Boolean(det.matched_account_id);
  }).length;
  const newAccountsCount = detectedAccounts.length - matchedCount;
  const showAccountColumn = detectedAccounts.length > 1;
  const allVisibleChecked =
    visibleItems.length > 0 &&
    visibleItems.every(({ rowKey }) => selectedRowKeys.has(rowKey));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & account selection */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-main">Import statements</h1>
          <p className="mt-1 text-sm text-sub">
            Upload CSV exports, PDF statements, or OFX/QFX downloads. Accounts are detected and
            created automatically when needed.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0 min-w-0">
          <label htmlFor="ingestionAccount" className="text-sm text-sub">
            Account
          </label>
          <select
            id="ingestionAccount"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            disabled={Boolean(preview)}
            className={`w-full sm:w-auto sm:max-w-[260px] truncate ${selectClass} disabled:opacity-60`}
          >
            <option value="">Auto-detect from file</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} · {formatMoney(acc.current_balance)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Error notification */}
      {errorMessage && (
        <div
          role="alert"
          className="px-4 py-3 rounded-xl bg-negative-subtle border border-default flex items-center justify-between gap-3 text-sm animate-in fade-in"
        >
          <div className="flex items-center gap-2 text-main">
            <AlertCircle className="w-4 h-4 text-negative shrink-0" strokeWidth={1.5} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-sub hover:text-main text-sm transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Success notification */}
      {successMessage && (
        <div className="px-4 py-3 rounded-xl bg-positive-subtle flex items-center justify-between gap-3 text-sm animate-in fade-in">
          <div className="flex items-center gap-2 text-main">
            <CheckCircle2 className="w-4 h-4 text-positive shrink-0" strokeWidth={1.5} />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-sub hover:text-main text-sm transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upload dropzone */}
      {!preview && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer border border-dashed rounded-xl p-6 sm:p-12 text-center transition-colors ${
            isDragging ? "border-accent-main bg-accent-subtle" : "border-default bg-surface bg-surface-hover"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".csv,.pdf,.ofx,.qfx,.qbo,.txt"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />

          <div className="flex flex-col items-center justify-center gap-4">
            {isLoading ? (
              <RefreshCw className="w-6 h-6 text-muted animate-spin" strokeWidth={1.5} />
            ) : (
              <UploadCloud className="w-6 h-6 text-muted" strokeWidth={1.5} />
            )}

            <div className="space-y-1">
              <p className="text-base font-medium text-main">
                {isLoading ? "Reading statement…" : "Drop a statement here, or browse"}
              </p>
              <p className="text-sm text-sub">
                Single or multi-account CSV exports, PDF statements, and OFX, QFX or QBO files
              </p>
            </div>

            <p className="text-xs text-muted">
              Missing accounts are detected for review, duplicates are flagged, and transfers can be paired automatically
            </p>
          </div>
        </div>
      )}

      {/* Parse preview table & reconciliation */}
      {preview && (
        <div className="space-y-4 animate-in fade-in">
          {/* Summary strip */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-surface border border-subtle">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
                <span className="text-sm font-medium text-main truncate max-w-[160px] sm:max-w-xs">
                  {preview.filename}
                </span>
                <span className={`${chip} bg-surface-subtle text-sub`}>
                  {preview.file_type.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted">
                <span>
                  <span className="tabular-nums text-main">{preview.total_parsed}</span> parsed
                </span>
                <span>·</span>
                <span>
                  <span className="tabular-nums text-main">{preview.new_count}</span> new
                </span>
                {preview.duplicates_count > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-warning">
                      <span className="tabular-nums">{preview.duplicates_count}</span> duplicates
                    </span>
                  </>
                )}
                {propagationNote && (
                  <>
                    <span>·</span>
                    <span className="text-positive whitespace-normal break-words">
                      {propagationNote}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setErrorMessage(null);
                  setPropagationNote(null);
                }}
                className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={selectedRowKeys.size === 0 || isCommitting}
                className="flex-1 sm:flex-none h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
              >
                {isCommitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} /> Importing…
                  </>
                ) : (
                  <>
                    Import {selectedRowKeys.size} <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Detected accounts review */}
          {detectedAccounts.length > 0 && (
            <section className="p-4 rounded-xl bg-surface border border-subtle space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} />
                  <h2 className="text-sm font-medium text-main">
                    Accounts in this statement
                  </h2>
                  <span className="text-xs text-muted">
                    {detectedAccounts.length} detected
                    {matchedCount > 0 ? ` · ${matchedCount} matched` : ""}
                    {newAccountsCount > 0 ? ` · ${newAccountsCount} new` : ""}
                  </span>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-sub cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDetectTransfers}
                    onChange={(e) => setAutoDetectTransfers(e.target.checked)}
                    className={checkboxClass}
                  />
                  Auto-link offsetting transfers
                </label>
              </div>

              <div className="divide-y divide-subtle border border-subtle rounded-lg overflow-hidden">
                {detectedAccounts.map((det) => {
                  const draft = accountResolutions[det.source_account_key];
                  if (!draft) return null;

                  const accountItems = indexedItems.filter(
                    ({ item }) => item.source_account_key === det.source_account_key
                  );
                  const selectedForAccount = accountItems.filter(({ rowKey }) =>
                    selectedRowKeys.has(rowKey)
                  ).length;

                  return (
                    <div
                      key={det.source_account_key}
                      className="p-3 bg-canvas/40 flex flex-col gap-3"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedForAccount > 0}
                            onChange={() =>
                              handleToggleAccountItems(det.source_account_key)
                            }
                            aria-label={`Include ${det.suggested_name}`}
                            className={checkboxClass}
                          />
                          <span className="text-sm font-medium text-main whitespace-normal break-words">
                            {draft.mode === "existing" && draft.existing_account_id
                              ? accounts.find((a) => a.id === draft.existing_account_id)?.name ||
                                det.suggested_name
                              : draft.name || det.suggested_name}
                          </span>
                          {det.account_number_mask && (
                            <span className={`${chip} bg-surface-subtle text-sub font-mono`}>
                              {det.account_number_mask}
                            </span>
                          )}
                          <span
                            className={`${chip} ${
                              draft.mode === "existing"
                                ? "bg-positive-subtle text-positive"
                                : "bg-accent-subtle text-accent-main"
                            }`}
                          >
                            {draft.mode === "existing" ? "Existing" : "New account"}
                          </span>
                          <span className="text-xs text-muted tabular-nums">
                            {selectedForAccount}/{det.transaction_count} selected
                          </span>
                        </div>

                        <div className="flex items-center gap-2 min-w-0 shrink-0">
                          <label
                            htmlFor={`target-${det.source_account_key}`}
                            className="text-xs text-sub shrink-0"
                          >
                            Destination
                          </label>
                          <select
                            id={`target-${det.source_account_key}`}
                            value={
                              draft.mode === "existing" && draft.existing_account_id
                                ? draft.existing_account_id
                                : "create"
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "create") {
                                updateAccountResolution(det.source_account_key, {
                                  mode: "create",
                                  existing_account_id: "",
                                });
                              } else {
                                updateAccountResolution(det.source_account_key, {
                                  mode: "existing",
                                  existing_account_id: val,
                                });
                              }
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
                      </div>

                      {draft.mode === "create" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pl-0 sm:pl-6">
                          <div>
                            <label className="block text-[11px] text-muted mb-1">
                              Name
                            </label>
                            <input
                              type="text"
                              value={draft.name}
                              maxLength={100}
                              aria-label={`Account name for ${det.suggested_name}`}
                              onChange={(e) =>
                                updateAccountResolution(det.source_account_key, {
                                  name: e.target.value,
                                })
                              }
                              className={`w-full ${compactInputClass}`}
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-muted mb-1">
                              Type
                            </label>
                            <select
                              value={draft.type}
                              aria-label={`Account type for ${det.suggested_name}`}
                              onChange={(e) =>
                                updateAccountResolution(det.source_account_key, {
                                  type: e.target.value as AccountType,
                                })
                              }
                              className={`w-full ${compactSelectClass}`}
                            >
                              {CATEGORY_ORDER.map((group) => (
                                <optgroup
                                  key={group}
                                  label={ACCOUNT_CATEGORY_LABELS[group]}
                                >
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
                            <label className="block text-[11px] text-muted mb-1">
                              Institution
                            </label>
                            <input
                              type="text"
                              value={draft.institution}
                              maxLength={100}
                              placeholder="Optional (e.g. RBC)"
                              aria-label={`Institution for ${det.suggested_name}`}
                              onChange={(e) =>
                                updateAccountResolution(det.source_account_key, {
                                  institution: e.target.value,
                                })
                              }
                              className={`w-full ${compactInputClass}`}
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-muted mb-1">
                              Currency
                            </label>
                            <input
                              type="text"
                              value={draft.currency}
                              maxLength={3}
                              aria-label={`Currency for ${det.suggested_name}`}
                              onChange={(e) =>
                                updateAccountResolution(det.source_account_key, {
                                  currency: e.target.value.toUpperCase(),
                                })
                              }
                              className={`w-full uppercase ${compactInputClass}`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Account filter pills for multi-account previews */}
          {detectedAccounts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveAccountFilter("ALL")}
                className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  activeAccountFilter === "ALL"
                    ? "bg-accent-main text-accent-contrast"
                    : "bg-surface border border-default text-sub hover:text-main"
                }`}
              >
                All ({preview.items.length})
              </button>
              {detectedAccounts.map((det) => {
                const draft = accountResolutions[det.source_account_key];
                const label =
                  draft?.mode === "existing" && draft.existing_account_id
                    ? accounts.find((a) => a.id === draft.existing_account_id)?.name ||
                      det.suggested_name
                    : draft?.name || det.suggested_name;
                return (
                  <button
                    key={det.source_account_key}
                    type="button"
                    onClick={() => setActiveAccountFilter(det.source_account_key)}
                    className={`min-h-8 py-1.5 px-3 max-w-full whitespace-normal break-words text-left rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeAccountFilter === det.source_account_key
                        ? "bg-accent-main text-accent-contrast"
                        : "bg-surface border border-default text-sub hover:text-main"
                    }`}
                  >
                    {label} ({det.transaction_count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Review container */}
          <div className="rounded-xl border border-subtle bg-surface overflow-hidden">
            {/* Mobile & tablet cards feed (< lg) */}
            <div className="block lg:hidden divide-y divide-subtle">
              {visibleItems.map(({ item, rowKey }) => {
                const isChecked = selectedRowKeys.has(rowKey);
                const assignedCat = getEffectiveCategory(rowKey, item, rowCategories, categories);

                return (
                  <div
                    key={rowKey}
                    className={`p-4 flex items-start gap-3 transition-colors ${
                      item.is_duplicate ? "text-muted" : isChecked ? "" : "opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleRowKey(rowKey)}
                      aria-label="Include transaction"
                      className={`mt-1 shrink-0 ${checkboxClass}`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 leading-snug">
                          <div className="text-sm text-main whitespace-normal break-words">
                            {item.normalized_payee}
                          </div>
                          <div className="text-xs text-muted font-mono whitespace-normal break-words">
                            {item.raw_payee}
                          </div>
                          {item.notes && (
                            <div className="text-xs text-sub whitespace-normal break-words">
                              {item.notes}
                            </div>
                          )}
                        </div>
                        <Money
                          value={item.amount}
                          signed
                          className={`text-sm shrink-0 ${
                            item.amount >= 0 ? "text-positive" : "text-main"
                          }`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                        <span className="text-muted tabular-nums">
                          {item.transaction_date}
                        </span>
                        {showAccountColumn && (
                          <>
                            <span className="text-muted">·</span>
                            <span className={`${chip} max-w-full whitespace-normal break-words bg-surface-subtle text-sub`}>
                              {getResolvedAccountLabel(item)}
                            </span>
                          </>
                        )}
                        <span className="text-muted">·</span>

                        <select
                          value={assignedCat}
                          onChange={(e) => handleCategoryChange(rowKey, e.target.value)}
                          aria-label="Category"
                          className={`max-w-[130px] truncate ${compactSelectClass}`}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        {item.is_duplicate ? (
                          <span className={`${chip} bg-warning-subtle text-warning`}>
                            Duplicate
                          </span>
                        ) : (
                          <span className={`${chip} bg-positive-subtle text-positive`}>
                            New
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop flex review list (>= lg) */}
            <div className="hidden lg:block" data-testid="ingestion-desktop-review">
              <div className="flex items-center gap-3 px-3 py-2.5 text-xs text-muted border-b border-subtle">
                <div className="w-6 shrink-0 flex justify-center">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={handleToggleSelectAll}
                    aria-label="Include all transactions"
                    className={checkboxClass}
                  />
                </div>
                <div className="w-[84px] shrink-0">Date</div>
                {showAccountColumn && (
                  <div className="w-[16%] min-w-[120px] shrink-0">Account</div>
                )}
                <div className="flex-1 min-w-0">Payee</div>
                <div className="w-[156px] shrink-0">Category</div>
                <div className="w-[14%] min-w-[84px] shrink-0">Status</div>
                <div className="w-[96px] shrink-0 text-right">Amount</div>
              </div>

              <div className="divide-y divide-subtle">
                {visibleItems.map(({ item, rowKey }) => {
                  const isChecked = selectedRowKeys.has(rowKey);
                  const assignedCat = getEffectiveCategory(rowKey, item, rowCategories, categories);
                  const accountLabel = getResolvedAccountLabel(item);
                  const showDetailLine =
                    item.raw_payee !== item.normalized_payee || Boolean(item.notes);

                  return (
                    <div
                      key={rowKey}
                      className={`flex items-start gap-3 px-3 py-2.5 text-sm transition-colors ${
                        item.is_duplicate
                          ? "text-muted"
                          : isChecked
                          ? "text-main"
                          : "text-muted opacity-60"
                      }`}
                    >
                      <div className="w-6 shrink-0 pt-0.5 flex justify-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleRowKey(rowKey)}
                          aria-label="Include transaction"
                          className={checkboxClass}
                        />
                      </div>

                      <div className="w-[84px] shrink-0 tabular-nums text-xs text-muted pt-0.5">
                        {item.transaction_date}
                      </div>

                      {showAccountColumn && (
                        <div className="w-[16%] min-w-[120px] shrink-0 text-xs text-sub leading-snug whitespace-normal break-words">
                          {accountLabel}
                        </div>
                      )}

                      <div className="flex-1 min-w-0 leading-snug">
                        <div className="text-main whitespace-normal break-words">
                          {item.normalized_payee}
                        </div>
                        {showDetailLine && (
                          <div className="text-xs text-muted whitespace-normal break-words">
                            <span className="font-mono">{item.raw_payee}</span>
                            {item.notes && (
                              <span className="text-sub"> · {item.notes}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="w-[156px] shrink-0">
                        <select
                          value={assignedCat}
                          onChange={(e) => handleCategoryChange(rowKey, e.target.value)}
                          aria-label="Category"
                          className={`w-full ${compactSelectClass}`}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-[14%] min-w-[84px] shrink-0">
                        {item.is_duplicate ? (
                          <span className="inline-block rounded-md px-1.5 py-0.5 text-xs leading-snug whitespace-normal break-words bg-warning-subtle text-warning">
                            Duplicate
                          </span>
                        ) : item.potential_transfer_account_name ? (
                          <span className="inline-block rounded-md px-1.5 py-0.5 text-xs leading-snug whitespace-normal break-words bg-surface-subtle text-sub">
                            Transfer · {item.potential_transfer_account_name}
                          </span>
                        ) : (
                          <span className="inline-block rounded-md px-1.5 py-0.5 text-xs leading-snug whitespace-normal break-words bg-positive-subtle text-positive">
                            New
                          </span>
                        )}
                      </div>

                      <div className="w-[96px] shrink-0 text-right tabular-nums whitespace-nowrap pt-0.5">
                        <Money
                          value={item.amount}
                          signed
                          className={
                            item.amount >= 0 ? "text-positive" : "text-main"
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
