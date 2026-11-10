import React, { useState, useEffect } from "react";
import { Search, Plus, Split, Trash2, Layers, Sparkles, Edit2, CheckCircle2, X } from "lucide-react";
import type {
  Account,
  Category,
  HouseholdMember,
  Transaction,
  TransactionSplit,
  TransactionStatus,
} from "../../types";
import { api } from "../../services/api";
import { Money } from "../common/Money";
import { formatMoney } from "../../utils/format";

const inputClass =
  "h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";
const compactSelectClass =
  "h-8 px-2 rounded-lg border border-default bg-input text-xs text-main focus:outline-none focus:border-[var(--accent-primary)]";
const primaryButton =
  "h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer";
const secondaryButton =
  "h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer";
const iconButton =
  "w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer";
const checkboxClass = "rounded border-default bg-input text-accent-main focus:ring-accent-main";
const modalOverlay = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in";
const modalPanel = "w-full rounded-xl bg-surface border border-default shadow-xl p-6";
const fieldLabel = "block text-xs text-sub mb-1";

interface LedgerWorkspaceProps {
  accounts: Account[];
  categories: Category[];
  householdMembers?: HouseholdMember[];
  onDataModified: () => void;
}

const PAGE_SIZE = 50;

export const LedgerWorkspace: React.FC<LedgerWorkspaceProps> = ({
  accounts,
  categories,
  householdMembers,
  onDataModified,
}) => {
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

  const handleSeedLedger = async () => {
    try {
      setIsSeedingDemo(true);
      await api.seedDemoData(false);
      await loadTransactions();
      if (onDataModified) onDataModified();
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
  const [modalSplits, setModalSplits] = useState<Array<{ category_id: string; amount: number; memo: string }>>([]);

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
      label = "Bedrock AI";
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
        className="inline-flex items-center gap-1 text-[11px] font-mono text-muted cursor-help shrink-0"
        title={tooltip}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span>{Math.round(score * 100)}%</span>
      </span>
    );
  };
  const [txnFormData, setTxnFormData] = useState({
    account_id: accounts[0]?.id || "",
    transaction_date: new Date().toISOString().split("T")[0],
    raw_payee: "",
    normalized_payee: "",
    amount: 0.0,
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
      amount: 0.0,
      category_id: "",
      notes: "",
      assigned_member_id: "",
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

  const loadTransactions = async () => {
    setIsLoading(true);
    try {
      const resp = await api.getTransactions({
        account_id: selectedAccountId || undefined,
        category_id: selectedCategoryId || undefined,
        assigned_member_id: selectedMemberId || undefined,
        search: searchQuery || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setTransactions(resp.items);
      setTotalCount(resp.total);
      setLoadError(null);
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message || "Could not load transactions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(loadTransactions, searchQuery ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [selectedAccountId, selectedCategoryId, selectedMemberId, searchQuery, page]);

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
          amount: isNeg ? -Math.abs(s.amount) : Math.abs(s.amount),
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
          amount: Number(txnFormData.amount),
          notes: txnFormData.notes || null,
          assigned_member_id: txnFormData.assigned_member_id || null,
          splits: txnFormData.category_id
            ? [{ category_id: txnFormData.category_id, amount: Number(txnFormData.amount) }]
            : undefined,
        });
      } else {
        await api.createTransaction({
          account_id: txnFormData.account_id,
          transaction_date: txnFormData.transaction_date,
          raw_payee: txnFormData.raw_payee,
          normalized_payee: txnFormData.normalized_payee || txnFormData.raw_payee,
          amount: Number(txnFormData.amount),
          notes: txnFormData.notes || null,
          assigned_member_id: txnFormData.assigned_member_id || undefined,
          splits: txnFormData.category_id
            ? [{ category_id: txnFormData.category_id, amount: Number(txnFormData.amount) }]
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
        className="inline-flex items-center gap-1 text-xs text-sub shrink-0"
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {loadError && (
        <div className="px-4 py-3 rounded-xl bg-negative-subtle border border-negative/30 text-sm text-negative flex items-center justify-between gap-3">
          <span>{loadError}</span>
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
      <div className="p-4 rounded-xl bg-surface border border-subtle flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search & selectors */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 flex-1 w-full">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search
              className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2"
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

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedAccountId}
              onChange={(e) => {
                setSelectedAccountId(e.target.value);
                setPage(1);
              }}
              aria-label="Account"
              className={`flex-1 sm:flex-none ${inputClass}`}
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
              className={`flex-1 sm:flex-none ${inputClass}`}
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
                className={`flex-1 sm:flex-none ${inputClass}`}
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
        <div className="flex items-center justify-end gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setAutoClassifyModalOpen(true)}
            className={`w-full sm:w-auto ${secondaryButton}`}
            title="Auto-classify all uncategorized transactions using the multi-tier engine"
          >
            <Sparkles className="w-4 h-4 text-muted" strokeWidth={1.5} />
            <span>Auto-classify uncategorized</span>
          </button>

          <button onClick={handleOpenCreateTxn} className={`w-full sm:w-auto ${primaryButton}`}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add transaction
          </button>
        </div>
      </div>

      {/* Batch action toolbar */}
      {selectedTxnIds.size > 0 && (
        <div className="p-4 rounded-xl bg-surface border border-accent-main/30 flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-4 animate-in fade-in">
          <div className="text-sm text-sub">
            <span className="font-mono text-main">{selectedTxnIds.size}</span> selected
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
              className={`flex-1 sm:flex-none min-w-[120px] ${inputClass}`}
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
                className="h-9 px-3 rounded-lg text-sm text-sub hover:text-main bg-surface-hover transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions */}
      <div className="rounded-xl border border-subtle bg-surface overflow-hidden">
        {/* Mobile feed (< md) */}
        <div className="block md:hidden divide-y divide-subtle">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted">
              {spinner}
              Loading…
            </div>
          ) : transactions.length === 0 ? (
            isLedgerEmpty ? (
              <div className="p-8 text-center max-w-sm mx-auto">
                <div className="text-sm font-medium text-main">No transactions yet</div>
                <div className="mt-1 text-xs text-muted">
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
              <div className="p-8 text-center text-muted text-sm">No transactions match these filters</div>
            )
          ) : (
            transactions.map((txn) => {
              const isChecked = selectedTxnIds.has(txn.id);
              const isSplit = txn.splits && txn.splits.length > 1;
              const matchedAccount = accounts.find((a) => a.id === txn.account_id);

              return (
                <div
                  key={txn.id}
                  className={`p-4 flex items-start gap-3 transition-colors ${
                    isChecked ? "bg-accent-subtle" : "bg-surface-hover"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleSelectRow(txn.id)}
                    aria-label="Select transaction"
                    className={`mt-1 shrink-0 ${checkboxClass}`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-main truncate">
                            {txn.normalized_payee || txn.raw_payee}
                          </span>
                          {renderMemberTag(txn)}
                        </div>
                        {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                          <div className="text-[11px] text-muted font-mono truncate">{txn.raw_payee}</div>
                        )}
                      </div>
                      <Money
                        value={txn.amount}
                        signed
                        className={`text-sm shrink-0 ${txn.amount >= 0 ? "text-positive" : "text-main"}`}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      <span className="text-muted font-mono">{txn.transaction_date?.split("T")[0]}</span>
                      <span className="text-muted">·</span>
                      <span className="text-sub truncate max-w-[100px]">
                        {matchedAccount?.name || "Account"}
                      </span>

                      {isSplit ? (
                        <button
                          onClick={() => handleOpenSplitModal(txn)}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-default text-xs text-sub bg-surface-hover transition-colors"
                        >
                          <Layers className="w-4 h-4 text-muted" strokeWidth={1.5} /> {txn.splits.length} splits
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <select
                            value={txn.splits?.[0]?.category_id || ""}
                            onChange={(e) => handleInlineCategoryChange(txn, e.target.value)}
                            aria-label="Category"
                            className={`max-w-[120px] truncate ${compactSelectClass}`}
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

                      <div className="ml-auto flex items-center gap-1">
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
                          title="Split transaction"
                          aria-label="Split transaction"
                          className={iconButton}
                        >
                          <Split className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted border-b border-subtle">
              <tr>
                <th className="px-4 py-3 w-10 text-center font-normal">
                  <input
                    type="checkbox"
                    checked={selectedTxnIds.size === transactions.length && transactions.length > 0}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all transactions"
                    className={checkboxClass}
                  />
                </th>
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 font-normal">Account</th>
                <th className="px-4 py-3 font-normal">Payee</th>
                <th className="px-4 py-3 font-normal">Category</th>
                <th className="px-4 py-3 font-normal">Notes</th>
                <th className="px-4 py-3 text-right font-normal">Amount</th>
                <th className="px-4 py-3 text-center font-normal">Splits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted">
                    {spinner}
                    Loading…
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted">
                    {isLedgerEmpty ? (
                      <div className="max-w-md mx-auto">
                        <div className="text-base font-medium text-main">No transactions yet</div>
                        <div className="mt-1 text-sm text-muted">
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

                  return (
                    <tr
                      key={txn.id}
                      className={`transition-colors ${isChecked ? "bg-accent-subtle" : "bg-surface-hover"}`}
                    >
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectRow(txn.id)}
                          aria-label="Select transaction"
                          className={checkboxClass}
                        />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted whitespace-nowrap">
                        {txn.transaction_date?.split("T")[0]}
                      </td>
                      <td className="px-4 py-2 text-sub">{matchedAccount?.name || "Account"}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-main">{txn.normalized_payee || txn.raw_payee}</span>
                          {renderMemberTag(txn)}
                        </div>
                        {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                          <div className="text-[11px] text-muted font-mono truncate max-w-xs">
                            {txn.raw_payee}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isSplit ? (
                          <button
                            onClick={() => handleOpenSplitModal(txn)}
                            className="inline-flex items-center gap-1 h-8 px-2 rounded-lg border border-default text-xs text-sub bg-surface-hover transition-colors cursor-pointer"
                          >
                            <Layers className="w-4 h-4 text-muted" strokeWidth={1.5} /> {txn.splits.length}{" "}
                            splits
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              value={txn.splits?.[0]?.category_id || ""}
                              onChange={(e) => handleInlineCategoryChange(txn, e.target.value)}
                              aria-label="Category"
                              className={compactSelectClass}
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
                      <td className="px-4 py-2 text-muted text-xs truncate max-w-[150px]">
                        {txn.notes || "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Money
                          value={txn.amount}
                          signed
                          className={txn.amount >= 0 ? "text-positive" : "text-main"}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
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
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-subtle">
          <div className="text-xs text-muted font-mono">
            {totalCount === 0
              ? "No transactions"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount.toLocaleString("en-CA")}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="h-8 px-3 rounded-lg border border-default bg-surface bg-surface-hover text-sub text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-xs text-muted font-mono">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="h-8 px-3 rounded-lg border border-default bg-surface bg-surface-hover text-sub text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Split transaction modal */}
      {splitModalTxn && (
        <div className={modalOverlay}>
          <div className={`max-w-lg space-y-5 ${modalPanel}`}>
            <div className="flex items-start justify-between gap-4 border-b border-subtle pb-4">
              <div>
                <h3 className="text-base font-medium text-main">Split transaction</h3>
                <p className="mt-1 text-xs text-muted">
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

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {modalSplits.map((split, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-surface-subtle">
                  <select
                    value={split.category_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setModalSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, category_id: val } : s))
                      );
                    }}
                    aria-label="Category"
                    className={`flex-1 ${inputClass}`}
                  >
                    <option value="">Category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={split.amount}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setModalSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, amount: val } : s))
                      );
                    }}
                    className={`w-28 font-mono text-right ${inputClass}`}
                  />

                  {modalSplits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalSplits(modalSplits.filter((_, i) => i !== idx));
                      }}
                      aria-label="Remove split"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  setModalSplits([...modalSplits, { category_id: "", amount: 0, memo: "" }]);
                }}
                className="w-full h-9 inline-flex items-center justify-center gap-2 border border-dashed border-default rounded-lg text-sm text-sub hover:text-main bg-surface-hover transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-muted" strokeWidth={1.5} /> Add split
              </button>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-subtle">
              <div className="text-xs text-muted">
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
          <form onSubmit={handleSaveTransaction} className={`max-w-md space-y-4 ${modalPanel}`}>
            <div className="flex items-center justify-between border-b border-subtle pb-4">
              <h3 className="text-base font-medium text-main">
                {editingTxn ? "Edit transaction" : "Add transaction"}
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
                  <input
                    type="number"
                    step="0.01"
                    placeholder="-50.00"
                    value={txnFormData.amount}
                    onChange={(e) =>
                      setTxnFormData({
                        ...txnFormData,
                        amount: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={`w-full font-mono ${inputClass}`}
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

            <div className="flex justify-end gap-2 pt-4 border-t border-subtle">
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

      {/* Auto-classify uncategorized confirmation modal */}
      {autoClassifyModalOpen && (
        <div className={modalOverlay}>
          <div className={`max-w-md space-y-4 ${modalPanel}`}>
            <div className="flex items-center justify-between border-b border-subtle pb-4">
              <h3 className="text-base font-medium text-main">Auto-classify uncategorized</h3>
              <button type="button" onClick={closeAutoClassify} aria-label="Close" className={iconButton}>
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {autoClassifySummary ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-positive-subtle flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-positive shrink-0" strokeWidth={1.5} />
                  <div>
                    <div className="text-sm font-medium text-positive">Auto-classification complete</div>
                    <div className="mt-1 text-xs text-main">{autoClassifySummary}</div>
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
                <p className="text-sm text-sub leading-relaxed">
                  Folio checks every uncategorized transaction against the four-tier engine (rules,
                  history, heuristics, then Bedrock AI) and assigns categories that meet the threshold
                </p>

                <div className="p-4 rounded-lg bg-surface-subtle space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="confirmMinConfidence" className="text-sm text-main">
                      Confidence threshold
                    </label>
                    <span className="text-sm font-mono text-main">
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
                    <label htmlFor="confirmEnableBedrock" className="text-sm text-sub cursor-pointer select-none">
                      Use Bedrock AI for ambiguous items
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-subtle">
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
