import React, { useState, useEffect, useRef } from "react";
import { Search, Plus, Split, Trash2, Layers, Sparkles, Edit2, CheckCircle2, X, Lock, ListChecks, ChevronRight } from "lucide-react";
import type {
  Account,
  Category,
  HouseholdMember,
  Transaction,
  TransactionSplit,
  TransactionStatus,
} from "../../types";
import { api } from "../../services/api";
import { onWriteConflict } from "../../services/notifications";
import { useIsPhone } from "../../hooks/useMediaQuery";
import {
  checkboxClass,
  compactSelectClass,
  fieldLabel,
  dangerIconButton,
  iconButton,
  hairline,
  inputClass,
  loneText,
  modalOverlay,
  modalPanel,
  pageStack,
  primaryButton,
  scrollList,
  secondaryButton,
  section,
  sectionSub,
  sectionTitle,
} from "../common/ui";
import { ActionSheet, DetailList } from "../common/ActionSheet";
import { Money } from "../common/Money";
import { NumberField } from "../common/NumberField";
import { formatMoney, formatNumber } from "../../utils/format";
import { useCanEdit, useSession } from "../../hooks/useSession";
import { attributionLine, getSession, isClosedDate } from "../../utils/session";
import { ClosedYearsModal } from "./ClosedYearsModal";


/**
 * What a ledger change touched. "transactions" (the default) means balances and
 * analytics may have moved but categories and members did not; "all" (sample
 * data load) means everything should be reloaded.
 */
export type LedgerRefreshScope = "transactions" | "all";

interface LedgerWorkspaceProps {
  accounts: Account[];
  categories: Category[];
  householdMembers?: HouseholdMember[];
  onDataModified: (scope?: LedgerRefreshScope) => void;
}

const PAGE_SIZE = 50;

export const LedgerWorkspace: React.FC<LedgerWorkspaceProps> = ({
  accounts,
  categories,
  householdMembers,
  onDataModified,
}) => {
  const canEdit = useCanEdit();
  const session = useSession();
  // A row can change when you may edit and its year is not closed.
  const isRowLocked = (txn: Transaction) => isClosedDate(txn.transaction_date, session);
  const canEditRow = (txn: Transaction) => canEdit && !isRowLocked(txn);
  const [isClosedYearsOpen, setIsClosedYearsOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);
  // Only one layout is mounted: a read-only feed on phones (below `md`), the
  // table on tablets and desktops.
  const isPhone = useIsPhone();
  // Phones: the row opens a sheet; checkboxes appear only in select mode.
  const [sheetTxnId, setSheetTxnId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  // Looked up by id so the sheet shows the row as reloaded after a change.
  const sheetTxn = sheetTxnId ? transactions.find((t) => t.id === sheetTxnId) ?? null : null;
  const sheetMember = sheetTxn
    ? householdMembers?.find((m) => m.id === sheetTxn.assigned_member_id) || sheetTxn.assigned_member
    : undefined;

  const handleSeedLedger = async () => {
    try {
      setIsSeedingDemo(true);
      await api.seedDemoData(false);
      await loadTransactions();
      onDataModified("all");
    } catch (err) {
      console.error("Failed to seed demo transactions:", err);
    } finally {
      setIsSeedingDemo(false);
    }
  };

  // Batch selection
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set());

  // Split Modal State
  const [splitModalTxn, setSplitModalTxn] = useState<Transaction | null>(null);
  const [modalSplits, setModalSplits] = useState<Array<{ category_id: string; amount: number | null; memo: string }>>([]);

  // Batch Categorize Toolbar State
  const [batchCategory, setBatchCategory] = useState<string>("");
  const [batchPayee, setBatchPayee] = useState<string>("");
  const [createRuleWithBatch, setCreateRuleWithBatch] = useState(false);

  // Transaction Modal State (Create / Edit)
  const [isTxnModalOpen, setIsTxnModalOpen] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);

  // Auto-Classify Uncategorized State
  const [autoClassifyModalOpen, setAutoClassifyModalOpen] = useState(false);
  const [autoClassifyMinConfidence, setAutoClassifyMinConfidence] = useState(0.75);
  const [autoClassifyEnableBedrock, setAutoClassifyEnableBedrock] = useState(false);
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [autoClassifySummary, setAutoClassifySummary] = useState<string | null>(null);

  const handleConfirmAutoClassify = async () => {
    setIsAutoClassifying(true);
    setAutoClassifySummary(null);
    try {
      const res = await api.classification.autoClassifyUncategorized({
        min_confidence: autoClassifyMinConfidence,
        enable_bedrock: autoClassifyEnableBedrock,
        dry_run: false,
      });
      const classified = res.classified_count ?? res.updated_count ?? 0;
      const remaining = res.remaining_count ?? 0;
      setAutoClassifySummary(`${classified} transactions classified, ${remaining} remaining uncategorized`);
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Auto-classification error: ${err.message}`);
    } finally {
      setIsAutoClassifying(false);
    }
  };

  const renderConfidenceBadge = (txn: Transaction) => {
    const confidence = txn.confidence_score;
    const tier = txn.classification_tier;
    const reason = txn.classification_reason;

    if (confidence === undefined || confidence === null) {
      if (!tier) return null;
    }

    const score = confidence ?? 0.85;
    const isHigh = score >= 0.85;
    const isMed = score >= 0.65 && score < 0.85;

    let dotColor: string;
    let label: string;

    if (tier === "BEDROCK_AI") {
      dotColor = "bg-accent-main";
      label = "AI";
    } else if (isHigh) {
      dotColor = "bg-positive";
      label = "High confidence";
    } else if (isMed) {
      dotColor = "bg-warning";
      label = "Medium confidence";
    } else {
      dotColor = "bg-[var(--text-muted)]";
      label = "Low confidence";
    }

    const tooltip = reason
      ? `${label} (${Math.round(score * 100)}%): ${reason}`
      : `${label} (${Math.round(score * 100)}% confidence)`;

    return (
      <span
        className="inline-flex items-center gap-1 text-sm tabular-nums text-sub cursor-help shrink-0"
        title={tooltip}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span>{Math.round(score * 100)}%</span>
      </span>
    );
  };
  const [txnFormData, setTxnFormData] = useState<{
    account_id: string;
    transaction_date: string;
    raw_payee: string;
    normalized_payee: string;
    amount: number | null;
    category_id: string;
    notes: string;
    assigned_member_id: string;
  }>({
    account_id: accounts[0]?.id || "",
    transaction_date: new Date().toISOString().split("T")[0],
    raw_payee: "",
    normalized_payee: "",
    amount: null,
    category_id: "",
    notes: "",
    assigned_member_id: "",
  });

  const handleOpenCreateTxn = () => {
    setEditingTxn(null);
    setTxnFormData({
      account_id: accounts[0]?.id || "",
      transaction_date: new Date().toISOString().split("T")[0],
      raw_payee: "",
      normalized_payee: "",
      amount: null,
      category_id: "",
      notes: "",
      // New entries are yours, when you have linked yourself to a member.
      assigned_member_id: getSession().me?.member_id ?? "",
    });
    setIsTxnModalOpen(true);
  };

  const handleOpenEditTxn = (txn: Transaction) => {
    setEditingTxn(txn);
    setTxnFormData({
      account_id: txn.account_id,
      transaction_date: txn.transaction_date
        ? txn.transaction_date.split("T")[0]
        : new Date().toISOString().split("T")[0],
      raw_payee: txn.raw_payee,
      normalized_payee: txn.normalized_payee || "",
      amount: txn.amount,
      category_id: txn.splits?.[0]?.category_id || "",
      notes: txn.notes || "",
      assigned_member_id: txn.assigned_member_id || "",
    });
    setIsTxnModalOpen(true);
  };

  // The in-flight list request. A newer load aborts it, so a slow response for an
  // old search or filter can never overwrite the results of a newer one.
  const loadControllerRef = useRef<AbortController | null>(null);

  const loadTransactions = async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setIsLoading(true);
    try {
      const resp = await api.getTransactions({
        account_id: selectedAccountId || undefined,
        category_id: selectedCategoryId || undefined,
        assigned_member_id: selectedMemberId || undefined,
        search: searchQuery || undefined,
        page,
        page_size: PAGE_SIZE,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setTransactions(resp.items);
      setTotalCount(resp.total);
      setLoadError(null);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error(err);
      setLoadError(err?.message || "Could not load transactions.");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(loadTransactions, searchQuery ? 300 : 0);
    return () => {
      window.clearTimeout(handle);
      // The filters changed: the in-flight response is already stale.
      loadControllerRef.current?.abort();
    };
  }, [selectedAccountId, selectedCategoryId, selectedMemberId, searchQuery, page]);

  // Reload after a write conflict (the server has the newer data) and abort any
  // in-flight request on unmount. The ref keeps the handler on the latest filters.
  const loadTransactionsRef = useRef(loadTransactions);
  loadTransactionsRef.current = loadTransactions;
  useEffect(() => {
    const unsubscribe = onWriteConflict(() => void loadTransactionsRef.current());
    return () => {
      unsubscribe();
      loadControllerRef.current?.abort();
    };
  }, []);

  const handleToggleSelectRow = (id: string) => {
    const next = new Set(selectedTxnIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedTxnIds(next);
  };

  const handleToggleSelectAll = () => {
    if (selectedTxnIds.size === transactions.length && transactions.length > 0) {
      setSelectedTxnIds(new Set());
    } else {
      setSelectedTxnIds(new Set(transactions.map((t) => t.id)));
    }
  };

  const handleInlineCategoryChange = async (txn: Transaction, categoryId: string) => {
    try {
      await api.updateTransaction(txn.id, {
        splits: categoryId ? [{ category_id: categoryId, amount: txn.amount }] : [],
      });
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Failed to update category: ${err.message}`);
    }
  };

  const handleExecuteBatchCategorize = async () => {
    if (!batchCategory) return;
    try {
      await api.batchCategorize({
        transaction_ids: Array.from(selectedTxnIds),
        category_id: batchCategory,
        normalized_payee: batchPayee || undefined,
        create_rule: createRuleWithBatch,
      });
      setSelectedTxnIds(new Set());
      setBatchCategory("");
      setBatchPayee("");
      setCreateRuleWithBatch(false);
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Batch update failed: ${err.message}`);
    }
  };

  const handleOpenSplitModal = (txn: Transaction) => {
    setSplitModalTxn(txn);
    if (txn.splits && txn.splits.length > 0) {
      setModalSplits(
        txn.splits.map((s) => ({
          category_id: s.category_id || "",
          amount: Math.abs(s.amount),
          memo: s.memo || "",
        }))
      );
    } else {
      setModalSplits([
        {
          category_id: "",
          amount: Math.abs(txn.amount),
          memo: "",
        },
      ]);
    }
  };

  const handleSaveSplits = async () => {
    if (!splitModalTxn) return;
    const totalSplit = modalSplits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    const expected = Math.abs(splitModalTxn.amount);

    if (Math.abs(totalSplit - expected) > 0.009) {
      alert(
        `Splits total ${formatMoney(totalSplit)} but the transaction is ${formatMoney(expected)}. They must match.`
      );
      return;
    }

    try {
      const isNeg = splitModalTxn.amount < 0;
      await api.updateTransaction(splitModalTxn.id, {
        splits: modalSplits.map((s) => ({
          category_id: s.category_id,
          amount: isNeg ? -Math.abs(s.amount ?? 0) : Math.abs(s.amount ?? 0),
          memo: s.memo || undefined,
        })),
      });
      setSplitModalTxn(null);
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Failed to save splits: ${err.message}`);
    }
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTxn) {
        await api.updateTransaction(editingTxn.id, {
          account_id: txnFormData.account_id,
          transaction_date: txnFormData.transaction_date,
          raw_payee: txnFormData.raw_payee,
          normalized_payee: txnFormData.normalized_payee || txnFormData.raw_payee,
          amount: (txnFormData.amount ?? 0),
          notes: txnFormData.notes || null,
          assigned_member_id: txnFormData.assigned_member_id || null,
          splits: txnFormData.category_id
            ? [{ category_id: txnFormData.category_id, amount: (txnFormData.amount ?? 0) }]
            : undefined,
        });
      } else {
        await api.createTransaction({
          account_id: txnFormData.account_id,
          transaction_date: txnFormData.transaction_date,
          raw_payee: txnFormData.raw_payee,
          normalized_payee: txnFormData.normalized_payee || txnFormData.raw_payee,
          amount: (txnFormData.amount ?? 0),
          notes: txnFormData.notes || null,
          assigned_member_id: txnFormData.assigned_member_id || undefined,
          splits: txnFormData.category_id
            ? [{ category_id: txnFormData.category_id, amount: (txnFormData.amount ?? 0) }]
            : [],
        });
      }
      setIsTxnModalOpen(false);
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Failed to save transaction: ${err.message}`);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasNoFilters = !searchQuery && !selectedAccountId && !selectedCategoryId && !selectedMemberId;
  const isLedgerEmpty = totalCount === 0 && hasNoFilters;

  const renderMemberTag = (txn: Transaction) => {
    const member =
      householdMembers?.find((m) => m.id === txn.assigned_member_id) || txn.assigned_member;
    if (!member) return null;
    const memberColor = member.color || "var(--text-muted)";
    return (
      <span
        className="inline-flex items-center gap-1 text-sm text-sub shrink-0"
        title={`Assigned to ${member.name}`}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: memberColor }} />
        <span>{member.name}</span>
      </span>
    );
  };

  const spinner = (
    <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mx-auto mb-3"></div>
  );

  const closeAutoClassify = () => {
    setAutoClassifyModalOpen(false);
    setAutoClassifySummary(null);
  };

  return (
    <div className={`max-w-7xl mx-auto ${pageStack}`}>
      {loadError && (
        <div className="px-4 py-3 rounded-lg bg-negative-subtle text-base text-negative flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              loadTransactions();
            }}
            className={secondaryButton}
          >
            Retry
          </button>
        </div>
      )}

      {/* Top filter bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Search & selectors */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 flex-1 w-full">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search
              className="w-4 h-4 text-sub absolute left-3 top-1/2 -translate-y-1/2"
              strokeWidth={1.5}
            />
            <input
              type="text"
              placeholder="Search"
              aria-label="Search payees, notes and amounts"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className={`w-full pl-9 ${inputClass}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-[2]">
            <select
              value={selectedAccountId}
              onChange={(e) => {
                setSelectedAccountId(e.target.value);
                setPage(1);
              }}
              aria-label="Account"
              className={`${inputClass} flex-1 basis-40 min-w-0 sm:w-auto`}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={selectedCategoryId}
              onChange={(e) => {
                setSelectedCategoryId(e.target.value);
                setPage(1);
              }}
              aria-label="Category"
              className={`${inputClass} flex-1 basis-40 min-w-0 sm:w-auto`}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {householdMembers && householdMembers.length > 0 && (
              <select
                value={selectedMemberId}
                onChange={(e) => {
                  setSelectedMemberId(e.target.value);
                  setPage(1);
                }}
                aria-label="Household member"
                className={`${inputClass} flex-1 basis-40 min-w-0 sm:w-auto`}
              >
                <option value="">All members</option>
                {householdMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="unassigned">Joint / unassigned</option>
              </select>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2 w-full xl:w-auto xl:shrink-0">
          <button
            type="button"
            onClick={() => setIsClosedYearsOpen(true)}
            className={`w-full sm:w-auto ${secondaryButton}`}
            title="Lock finished years and keep an archived copy"
          >
            <Lock className="w-4 h-4" strokeWidth={1.5} />
            <span>Closed years</span>
          </button>
          {canEdit && (<>
          {isPhone && (
            <button
              type="button"
              onClick={() => {
                if (selectMode) setSelectedTxnIds(new Set());
                setSelectMode(!selectMode);
              }}
              aria-pressed={selectMode}
              className={`w-full ${secondaryButton}`}
            >
              <ListChecks className="w-4 h-4" strokeWidth={1.5} />
              <span>{selectMode ? "Done selecting" : "Select"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setAutoClassifyModalOpen(true)}
            className={`w-full sm:w-auto ${secondaryButton}`}
            title="Auto-classify all uncategorized transactions using the multi-tier engine"
          >
            <Sparkles className="w-4 h-4" strokeWidth={1.5} />
            <span>Auto-classify uncategorized</span>
          </button>

          <button onClick={handleOpenCreateTxn} className={`w-full sm:w-auto ${primaryButton}`}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add transaction
          </button>
          </>)}
        </div>
      </div>

      {/* Batch action toolbar */}
      {selectedTxnIds.size > 0 && (
        <div className="p-4 rounded-lg bg-accent-subtle flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-4 animate-in fade-in">
          <div className="text-base text-sub">
            <span className="tabular-nums text-main">{selectedTxnIds.size}</span> selected
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <select
              value={batchCategory}
              onChange={(e) => setBatchCategory(e.target.value)}
              aria-label="Category for selected transactions"
              className={inputClass}
            >
              <option value="">Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Payee override"
              value={batchPayee}
              onChange={(e) => setBatchPayee(e.target.value)}
              className={`flex-1 sm:flex-none min-w-0 sm:min-w-[120px] ${inputClass}`}
            />

            <label className="flex items-center gap-2 text-sm text-sub cursor-pointer">
              <input
                type="checkbox"
                checked={createRuleWithBatch}
                onChange={(e) => setCreateRuleWithBatch(e.target.checked)}
                className={checkboxClass}
              />
              Save as rule
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExecuteBatchCategorize}
                disabled={!batchCategory}
                className={primaryButton}
              >
                Apply
              </button>
              <button
                onClick={() => setSelectedTxnIds(new Set())}
                className={secondaryButton}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions */}
      <section className={section}>
        {/* Phone feed (< md): read-only rows; a tap opens the details sheet */}
        {isPhone && (
        <div className="border-y border-subtle divide-y divide-subtle">
          {isLoading ? (
            <div role="status" className={`p-8 text-center ${loneText}`}>
              {spinner}
              Loading…
            </div>
          ) : transactions.length === 0 ? (
            isLedgerEmpty ? (
              <div className="px-4 py-12 text-center max-w-md mx-auto">
                <div className="text-lg font-semibold text-main">No transactions yet</div>
                <div className={`mt-1 ${loneText}`}>
                  Load Canadian sample entries to try categorization, analytics and budgeting
                </div>
                <button
                  type="button"
                  onClick={handleSeedLedger}
                  disabled={isSeedingDemo}
                  className={`mt-4 ${primaryButton}`}
                >
                  {isSeedingDemo ? "Loading sample…" : "Load sample ledger"}
                </button>
              </div>
            ) : (
              <div className={`px-4 py-12 text-center ${loneText}`}>No transactions match these filters</div>
            )
          ) : (
            transactions.map((txn) => {
              const isChecked = selectedTxnIds.has(txn.id);
              const isSplit = txn.splits && txn.splits.length > 1;
              const matchedAccount = accounts.find((a) => a.id === txn.account_id);
              const payee = txn.normalized_payee || txn.raw_payee;
              const categoryLabel = isSplit
                ? `${txn.splits.length} splits`
                : categories.find((c) => c.id === txn.splits?.[0]?.category_id)?.name || "Uncategorized";
              const selecting = selectMode && canEditRow(txn);

              return (
                <div key={txn.id} className={`flex items-stretch ${isChecked ? "bg-accent-subtle" : ""}`}>
                  {selecting && (
                    <label className="flex items-center pl-1 pr-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleSelectRow(txn.id)}
                        aria-label="Select transaction"
                        className={checkboxClass}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => (selecting ? handleToggleSelectRow(txn.id) : setSheetTxnId(txn.id))}
                    aria-label={selecting ? undefined : `${payee}, details and actions`}
                    tabIndex={selecting ? -1 : undefined}
                    className="flex-1 min-w-0 px-1 py-3.5 flex items-start gap-3 text-left bg-surface-hover transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-base text-main break-words">{payee}</div>
                          {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                            <div className="text-sm text-sub font-mono break-all">{txn.raw_payee}</div>
                          )}
                        </div>
                        <Money
                          value={txn.amount}
                          signed
                          className={`text-base shrink-0 whitespace-nowrap ${txn.amount >= 0 ? "text-positive" : "text-main"}`}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm">
                        <span className="text-sub tabular-nums whitespace-nowrap">{txn.transaction_date?.split("T")[0]}</span>
                        <span className="text-sub" aria-hidden="true">·</span>
                        <span className="text-sub break-words">{matchedAccount?.name || "Account"}</span>
                        <span className="text-sub" aria-hidden="true">·</span>
                        <span className={`break-words ${categoryLabel === "Uncategorized" ? "text-warning" : "text-sub"}`}>
                          {categoryLabel}
                        </span>
                        {renderConfidenceBadge(txn)}
                        {renderMemberTag(txn)}
                        {isRowLocked(txn) && (
                          <Lock className="w-4 h-4 text-sub" strokeWidth={1.5} aria-label="In a closed year" />
                        )}
                      </div>
                    </div>
                    {!selecting && (
                      <ChevronRight className="w-5 h-5 mt-0.5 text-sub shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* Table (tablet and desktop, >= md) */}
        {!isPhone && (
        <div className="border-b border-subtle">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-sm text-sub border-y border-subtle">
              <tr>
                <th className="px-2.5 py-3 w-10 text-center font-normal">
                  <input
                    type="checkbox"
                    checked={selectedTxnIds.size === transactions.length && transactions.length > 0}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all transactions"
                    className={checkboxClass}
                  />
                </th>
                <th className="hidden lg:table-cell px-2 py-3 w-[104px] font-normal">Date</th>
                <th className="hidden xl:table-cell px-2 py-3 w-[140px] font-normal">Account</th>
                <th className="px-2 py-3 font-normal">Payee</th>
                <th className="px-2 py-3 w-[128px] lg:w-[160px] xl:w-[176px] font-normal">Category</th>
                <th className="hidden xl:table-cell px-2 py-3 w-[132px] font-normal">Notes</th>
                <th className="px-2 py-3 w-[96px] xl:w-[112px] text-right font-normal">Amount</th>
                <th className="px-2 py-3 w-[88px] text-center font-normal">Splits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading ? (
                <tr>
                  <td colSpan={8} role="status" className={`text-center py-12 ${loneText}`}>
                    {spinner}
                    Loading…
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className={`text-center px-4 py-12 ${loneText}`}>
                    {isLedgerEmpty ? (
                      <div className="max-w-md mx-auto">
                        <div className="text-lg font-semibold text-main">No transactions yet</div>
                        <div className="mt-1">
                          Load Canadian household sample entries to try auto-classification, budget
                          tracking and cash flow forecasting
                        </div>
                        <button
                          type="button"
                          onClick={handleSeedLedger}
                          disabled={isSeedingDemo}
                          className={`mt-4 ${primaryButton}`}
                        >
                          {isSeedingDemo ? "Loading sample…" : "Load Canadian sample ledger"}
                        </button>
                      </div>
                    ) : (
                      "No transactions match these filters"
                    )}
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => {
                  const isChecked = selectedTxnIds.has(txn.id);
                  const isSplit = txn.splits && txn.splits.length > 1;
                  const matchedAccount = accounts.find((a) => a.id === txn.account_id);
                  const accountLabel = matchedAccount?.name || "Account";
                  const payeeLabel = txn.normalized_payee || txn.raw_payee;

                  return (
                    <tr
                      key={txn.id}
                      className={`transition-colors ${isChecked ? "bg-accent-subtle" : "bg-surface-hover"}`}
                    >
                      <td className="px-2.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectRow(txn.id)}
                          aria-label="Select transaction"
                          className={checkboxClass}
                        />
                      </td>
                      <td className="hidden lg:table-cell px-2 py-2 tabular-nums text-sub whitespace-nowrap">
                        {txn.transaction_date?.split("T")[0]}
                      </td>
                      <td className="hidden xl:table-cell px-2 py-2 text-sub leading-snug whitespace-normal break-words">
                        {accountLabel}
                      </td>
                      <td className="px-2 py-2 min-w-0 leading-snug">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-main whitespace-normal break-words">
                            {payeeLabel}
                          </span>
                          {renderMemberTag(txn)}
                        </div>
                        {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                          <div className="text-sm text-sub font-mono whitespace-normal break-words">
                            {txn.raw_payee}
                          </div>
                        )}
                        <div className="xl:hidden text-sm text-sub whitespace-normal break-words">
                          <span className="lg:hidden tabular-nums">{txn.transaction_date?.split("T")[0]} · </span>
                          {accountLabel}
                          {txn.notes ? ` · ${txn.notes}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {isSplit ? (
                          <button
                            onClick={() => handleOpenSplitModal(txn)}
                            className="inline-flex items-center gap-1 h-9 px-2 rounded-lg bg-surface-subtle text-sm text-sub bg-surface-hover transition-colors cursor-pointer"
                          >
                            <Layers className="w-4 h-4" strokeWidth={1.5} /> {txn.splits.length}{" "}
                            splits
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <select
                              value={txn.splits?.[0]?.category_id || ""}
                              onChange={(e) => handleInlineCategoryChange(txn, e.target.value)}
                            disabled={!canEditRow(txn)}
                              aria-label="Category"
                              className={`min-w-0 flex-1 max-w-full truncate ${compactSelectClass}`}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            {renderConfidenceBadge(txn)}
                          </div>
                        )}
                      </td>
                      <td className="hidden xl:table-cell px-2 py-2 text-sub text-sm leading-snug whitespace-normal break-words">
                        {txn.notes || "—"}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <Money
                          value={txn.amount}
                          signed
                          className={txn.amount >= 0 ? "text-positive" : "text-main"}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isRowLocked(txn) && (
                            <span title="In a closed year" aria-label="In a closed year" className="h-8 w-8 flex items-center justify-center text-sub">
                              <Lock className="w-4 h-4" strokeWidth={1.5} />
                            </span>
                          )}
                          {canEditRow(txn) && (<>
                          <button
                            type="button"
                            onClick={() => handleOpenEditTxn(txn)}
                            title="Edit transaction"
                            aria-label="Edit transaction"
                            className={iconButton}
                          >
                            <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenSplitModal(txn)}
                            title="Edit splits or loan breakdown"
                            aria-label="Edit splits"
                            className={iconButton}
                          >
                            <Split className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <div className="text-sm text-sub tabular-nums">
            {totalCount === 0
              ? "No transactions"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${formatNumber(totalCount)}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className={`${secondaryButton} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Previous
            </button>
            <span className="text-sm text-sub tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className={`${secondaryButton} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* Split transaction modal */}
      {splitModalTxn && (
        <div className={modalOverlay}>
          <div className={`md:max-w-lg space-y-5 ${modalPanel}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className={sectionTitle}>Split transaction</h3>
                <p className={`${sectionSub} break-words`}>

                  {splitModalTxn.normalized_payee || splitModalTxn.raw_payee} · Total{" "}
                  <Money value={Math.abs(splitModalTxn.amount)} className="text-main" />
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSplitModalTxn(null)}
                aria-label="Close"
                className={iconButton}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className={`space-y-3 max-h-72 overflow-y-auto ${scrollList}`}>
              {modalSplits.map((split, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={split.category_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setModalSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, category_id: val } : s))
                      );
                    }}
                    aria-label="Category"
                    className={`flex-1 min-w-0 ${inputClass}`}
                  >
                    <option value="">Category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <NumberField
                    step="0.01"
                    placeholder="Amount"
                    value={split.amount}
                    onValueChange={(val) => {
                      setModalSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, amount: val } : s))
                      );
                    }}
                    className={`w-28 shrink-0 tabular-nums text-right ${inputClass}`}
                  />

                  {modalSplits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalSplits(modalSplits.filter((_, i) => i !== idx));
                      }}
                      aria-label="Remove split"
                      className={dangerIconButton}
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  setModalSplits([...modalSplits, { category_id: "", amount: null, memo: "" }]);
                }}
                className={`${secondaryButton} -ml-4`}
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} /> Add split
              </button>
            </div>

            <div className={`flex flex-wrap items-center justify-between gap-3 pt-4 ${hairline}`}>
              <div className="text-base md:text-sm text-sub">
                Split total{" "}
                <Money
                  value={modalSplits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0)}
                  className="text-main"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSplitModalTxn(null)} className={secondaryButton}>
                  Cancel
                </button>
                <button type="button" onClick={handleSaveSplits} className={primaryButton}>
                  Save splits
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction create / edit modal */}
      {isTxnModalOpen && (
        <div className={modalOverlay}>
          <form onSubmit={handleSaveTransaction} className={`md:max-w-md space-y-4 ${modalPanel}`}>
            <div className="flex items-start justify-between gap-4">
              <h3 className={`${sectionTitle} min-w-0`}>
                {editingTxn ? "Edit transaction" : "Add transaction"}
                {editingTxn && attributionLine(editingTxn.created_by, editingTxn.updated_by) && (
                  <span className="block font-sans text-sm font-normal text-sub mt-1">
                    {attributionLine(editingTxn.created_by, editingTxn.updated_by)}
                  </span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setIsTxnModalOpen(false)}
                aria-label="Close"
                className={iconButton}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={fieldLabel}>Account</label>
                <select
                  value={txnFormData.account_id}
                  onChange={(e) => setTxnFormData({ ...txnFormData, account_id: e.target.value })}
                  className={`w-full ${inputClass}`}
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institution})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel}>Date</label>
                  <input
                    type="date"
                    value={txnFormData.transaction_date}
                    onChange={(e) =>
                      setTxnFormData({ ...txnFormData, transaction_date: e.target.value })
                    }
                    className={`w-full ${inputClass}`}
                    required
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Amount, negative for expenses</label>
                  <NumberField
                    step="0.01"
                    placeholder="-50.00"
                    value={txnFormData.amount}
                    onValueChange={(v) => setTxnFormData({ ...txnFormData, amount: v })}
                    className={`w-full tabular-nums ${inputClass}`}
                    required
                  />
                </div>
              </div>

              <div>
                <label className={fieldLabel}>Payee</label>
                <input
                  type="text"
                  placeholder="Tim Hortons"
                  value={txnFormData.raw_payee}
                  onChange={(e) => setTxnFormData({ ...txnFormData, raw_payee: e.target.value })}
                  className={`w-full ${inputClass}`}
                  required
                />
              </div>

              <div>
                <label className={fieldLabel}>Category</label>
                <select
                  value={txnFormData.category_id}
                  onChange={(e) => setTxnFormData({ ...txnFormData, category_id: e.target.value })}
                  className={`w-full ${inputClass}`}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Household member assignment */}
              <div>
                <label className={fieldLabel}>Household member</label>
                <select
                  value={txnFormData.assigned_member_id}
                  onChange={(e) =>
                    setTxnFormData({ ...txnFormData, assigned_member_id: e.target.value })
                  }
                  className={`w-full ${inputClass}`}
                >
                  <option value="">Joint / unassigned</option>
                  {householdMembers?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role || "Member"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={fieldLabel}>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="Memo"
                  value={txnFormData.notes}
                  onChange={(e) => setTxnFormData({ ...txnFormData, notes: e.target.value })}
                  className={`w-full ${inputClass}`}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setIsTxnModalOpen(false)} className={secondaryButton}>
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                {editingTxn ? "Save changes" : "Save transaction"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Phone: a transaction's full details and its actions */}
      {isPhone && sheetTxn && (
        <ActionSheet
          open
          onClose={() => setSheetTxnId(null)}
          title={sheetTxn.normalized_payee || sheetTxn.raw_payee}
          subtitle={
            sheetTxn.normalized_payee && sheetTxn.normalized_payee !== sheetTxn.raw_payee ? (
              <span className="font-mono break-all">{sheetTxn.raw_payee}</span>
            ) : undefined
          }
          actions={
            canEditRow(sheetTxn)
              ? [
                  { label: "Edit transaction", icon: Edit2, onSelect: () => handleOpenEditTxn(sheetTxn) },
                  {
                    label: sheetTxn.splits && sheetTxn.splits.length > 1 ? "Edit splits" : "Split transaction",
                    icon: Split,
                    onSelect: () => handleOpenSplitModal(sheetTxn),
                  },
                ]
              : []
          }
        >
          <DetailList
            items={[
              [
                "Amount",
                <Money
                  value={sheetTxn.amount}
                  signed
                  className={sheetTxn.amount >= 0 ? "text-positive" : "text-main"}
                />,
              ],
              ["Date", <span className="tabular-nums">{sheetTxn.transaction_date?.split("T")[0]}</span>],
              ["Account", accounts.find((a) => a.id === sheetTxn.account_id)?.name || "Account"],
              sheetMember ? ["Member", sheetMember.name] : null,
              !!sheetTxn.notes && ["Notes", sheetTxn.notes],
              sheetTxn.splits &&
                sheetTxn.splits.length > 1 && [
                  "Splits",
                  <span className="block space-y-0.5">
                    {sheetTxn.splits.map((sp, i) => (
                      <span key={i} className="block">
                        {categories.find((c) => c.id === sp.category_id)?.name || "Uncategorized"}{" "}
                        <Money value={sp.amount} className="text-sub" />
                      </span>
                    ))}
                  </span>,
                ],
              isRowLocked(sheetTxn) && ["Status", "In a closed year"],
            ]}
          />
          {!(sheetTxn.splits && sheetTxn.splits.length > 1) && (
            <div className="mt-4">
              <label htmlFor="sheet-category" className={fieldLabel}>
                Category
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="sheet-category"
                  value={sheetTxn.splits?.[0]?.category_id || ""}
                  onChange={(e) => handleInlineCategoryChange(sheetTxn, e.target.value)}
                  disabled={!canEditRow(sheetTxn)}
                  className={inputClass}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {renderConfidenceBadge(sheetTxn)}
              </div>
            </div>
          )}
        </ActionSheet>
      )}

      {/* Auto-classify uncategorized confirmation modal */}
      {isClosedYearsOpen && (
        <ClosedYearsModal onClose={() => setIsClosedYearsOpen(false)} onChanged={() => onDataModified("all")} />
      )}

      {autoClassifyModalOpen && (
        <div className={modalOverlay}>
          <div className={`md:max-w-md space-y-4 ${modalPanel}`}>
            <div className="flex items-start justify-between gap-4">
              <h3 className={`${sectionTitle} min-w-0`}>Auto-classify uncategorized</h3>
              <button type="button" onClick={closeAutoClassify} aria-label="Close" className={iconButton}>
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {autoClassifySummary ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-positive-subtle flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 mt-0.5 text-positive shrink-0" strokeWidth={1.5} />
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-positive">Auto-classification complete</div>
                    <div className="mt-1 text-sm text-main break-words">{autoClassifySummary}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={closeAutoClassify} className={primaryButton}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-base text-sub leading-relaxed">
                  Folio checks every uncategorized transaction against the four-tier engine (rules,
                  history, heuristics, then AI) and assigns categories that meet the threshold
                </p>

                <div className={`pt-4 ${hairline} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <label htmlFor="confirmMinConfidence" className="text-base md:text-sm text-main">
                      Confidence threshold
                    </label>
                    <span className="text-base md:text-sm tabular-nums text-main">
                      {Math.round(autoClassifyMinConfidence * 100)}%
                    </span>
                  </div>
                  <input
                    id="confirmMinConfidence"
                    type="range"
                    min="0.50"
                    max="0.95"
                    step="0.05"
                    value={autoClassifyMinConfidence}
                    onChange={(e) => setAutoClassifyMinConfidence(parseFloat(e.target.value))}
                    className="w-full accent-accent-main cursor-pointer"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="confirmEnableBedrock"
                      checked={autoClassifyEnableBedrock}
                      onChange={(e) => setAutoClassifyEnableBedrock(e.target.checked)}
                      className={checkboxClass}
                    />
                    <label htmlFor="confirmEnableBedrock" className="text-base md:text-sm text-sub cursor-pointer select-none">
                      Use AI for ambiguous items
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAutoClassifyModalOpen(false)}
                    disabled={isAutoClassifying}
                    className={secondaryButton}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAutoClassify}
                    disabled={isAutoClassifying}
                    className={primaryButton}
                  >
                    {isAutoClassifying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                        <span>Classifying…</span>
                      </>
                    ) : (
                      <span>Classify uncategorized</span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
