import React, { useState, useEffect } from "react";
import {
  Search,
  Plus,
  Split,
  Trash2,
  Layers,
  Sparkles,
} from "lucide-react";
import type {
  Account,
  Category,
  Transaction,
  TransactionSplit,
  TransactionStatus,
} from "../../types";
import { api } from "../../services/api";

interface LedgerWorkspaceProps {
  accounts: Account[];
  categories: Category[];
  onDataModified: () => void;
}

const PAGE_SIZE = 50;

export const LedgerWorkspace: React.FC<LedgerWorkspaceProps> = ({
  accounts,
  categories,
  onDataModified,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Batch selection
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<string>>(new Set());

  // Split Modal State
  const [splitModalTxn, setSplitModalTxn] = useState<Transaction | null>(null);
  const [modalSplits, setModalSplits] = useState<Array<{ category_id: string; amount: number; memo: string }>>([]);

  // Batch Categorize Toolbar State
  const [batchCategory, setBatchCategory] = useState<string>("");
  const [batchPayee, setBatchPayee] = useState<string>("");
  const [createRuleWithBatch, setCreateRuleWithBatch] = useState(false);

  // New Transaction Modal State
  const [isNewTxnOpen, setIsNewTxnOpen] = useState(false);
  const [newTxn, setNewTxn] = useState({
    account_id: accounts[0]?.id || "",
    transaction_date: new Date().toISOString().split("T")[0],
    raw_payee: "",
    normalized_payee: "",
    amount: 0.0,
    category_id: "",
    notes: "",
  });

  const loadTransactions = async () => {
    setIsLoading(true);
    try {
      const resp = await api.getTransactions({
        account_id: selectedAccountId || undefined,
        category_id: selectedCategoryId || undefined,
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
    // Typing in the search box used to fire one request per keystroke.
    const handle = window.setTimeout(loadTransactions, searchQuery ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [selectedAccountId, selectedCategoryId, searchQuery, page]);

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
    if (selectedTxnIds.size === transactions.length) {
      setSelectedTxnIds(new Set());
    } else {
      setSelectedTxnIds(new Set(transactions.map((t) => t.id)));
    }
  };

  const handleInlineCategoryChange = async (txn: Transaction, categoryId: string) => {
    try {
      await api.updateTransaction(txn.id, {
        splits: [{ category_id: categoryId, amount: txn.amount }],
      });
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const handleExecuteBatchCategorize = async () => {
    if (!batchCategory || selectedTxnIds.size === 0) return;

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

    const totalSplitAmt = modalSplits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const targetAmt = Math.abs(splitModalTxn.amount);

    if (Math.abs(totalSplitAmt - targetAmt) > 0.01) {
      alert(`Split amounts ($${totalSplitAmt.toFixed(2)}) must equal total transaction ($${targetAmt.toFixed(2)})`);
      return;
    }

    const sign = splitModalTxn.amount < 0 ? -1 : 1;
    const splitsPayload = modalSplits.map((s) => ({
      category_id: s.category_id || null,
      amount: sign * Math.abs(Number(s.amount)),
      memo: s.memo || null,
    }));

    try {
      await api.updateTransaction(splitModalTxn.id, {
        splits: splitsPayload,
      });
      setSplitModalTxn(null);
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Failed to save splits: ${err.message}`);
    }
  };

  const handleCreateManualTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createTransaction({
        account_id: newTxn.account_id,
        transaction_date: new Date(newTxn.transaction_date).toISOString(),
        raw_payee: newTxn.raw_payee,
        normalized_payee: newTxn.normalized_payee || newTxn.raw_payee,
        amount: Number(newTxn.amount),
        notes: newTxn.notes || null,
        splits: newTxn.category_id ? [{ category_id: newTxn.category_id, amount: Number(newTxn.amount) }] : [],
      });
      setIsNewTxnOpen(false);
      setNewTxn({
        account_id: accounts[0]?.id || "",
        transaction_date: new Date().toISOString().split("T")[0],
        raw_payee: "",
        normalized_payee: "",
        amount: 0.0,
        category_id: "",
        notes: "",
      });
      loadTransactions();
      onDataModified();
    } catch (err: any) {
      alert(`Failed to create transaction: ${err.message}`);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {loadError && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              loadTransactions();
            }}
            className="px-3 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Filter Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search & Selectors */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 flex-1 w-full">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search payees, notes, amounts..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedAccountId}
              onChange={(e) => {
                setSelectedAccountId(e.target.value);
                setPage(1);
              }}
              className="flex-1 sm:flex-none px-3 py-2 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            >
              <option value="">All Accounts</option>
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
              className="flex-1 sm:flex-none px-3 py-2 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setIsNewTxnOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        </div>
      </div>

      {/* Batch Action Toolbar */}
      {selectedTxnIds.size > 0 && (
        <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 shadow-lg flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 text-xs text-indigo-200">
            <span className="font-bold text-white px-2 py-0.5 rounded bg-indigo-600">
              {selectedTxnIds.size}
            </span>
            <span>transactions selected</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <select
              value={batchCategory}
              onChange={(e) => setBatchCategory(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs"
            >
              <option value="">Choose Category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Override Payee"
              value={batchPayee}
              onChange={(e) => setBatchPayee(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs placeholder:text-slate-500 flex-1 sm:flex-none min-w-[120px]"
            />

            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={createRuleWithBatch}
                onChange={(e) => setCreateRuleWithBatch(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Save as Rule
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExecuteBatchCategorize}
                disabled={!batchCategory}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Apply Batch
              </button>
              <button
                onClick={() => setSelectedTxnIds(new Set())}
                className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions Container */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        {/* Mobile Feed View (< md screen) */}
        <div className="block md:hidden divide-y divide-slate-800/60 font-medium">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mx-auto mb-2"></div>
              Loading ledger...
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No transactions found matching criteria.
            </div>
          ) : (
            transactions.map((txn) => {
              const isChecked = selectedTxnIds.has(txn.id);
              const isSplit = txn.splits && txn.splits.length > 1;
              const matchedAccount = accounts.find((a) => a.id === txn.account_id);

              return (
                <div
                  key={txn.id}
                  className={`p-3.5 flex items-start gap-3 transition-colors ${
                    isChecked ? "bg-slate-800/40" : "hover:bg-slate-800/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleSelectRow(txn.id)}
                    className="mt-1 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-100 truncate">
                          {txn.normalized_payee || txn.raw_payee}
                        </div>
                        {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                          <div className="text-[10px] text-slate-500 font-mono truncate">
                            {txn.raw_payee}
                          </div>
                        )}
                      </div>
                      <div
                        className={`font-mono font-bold text-xs shrink-0 ${
                          txn.amount >= 0 ? "text-emerald-400" : "text-slate-100"
                        }`}
                      >
                        {txn.amount >= 0 ? "+" : ""}${Math.abs(txn.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                      <span className="text-slate-400 font-mono">
                        {txn.transaction_date?.split("T")[0]}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="font-semibold text-slate-300 truncate max-w-[100px]">
                        {matchedAccount?.name || "Account"}
                      </span>
                      <span className="text-slate-600">•</span>

                      {isSplit ? (
                        <button
                          onClick={() => handleOpenSplitModal(txn)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                        >
                          <Layers className="w-2.5 h-2.5" /> Split ({txn.splits.length})
                        </button>
                      ) : (
                        <select
                          value={txn.splits?.[0]?.category_id || ""}
                          onChange={(e) => handleInlineCategoryChange(txn, e.target.value)}
                          className="bg-slate-800 border border-slate-700/80 text-slate-200 text-[10px] rounded px-1.5 py-0.5 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden max-w-[120px] truncate"
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}

                      <button
                        onClick={() => handleOpenSplitModal(txn)}
                        title="Split transaction"
                        className="ml-auto p-1 text-slate-400 hover:text-indigo-400"
                      >
                        <Split className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop High-density Transactions Table (>= md screen) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedTxnIds.size === transactions.length && transactions.length > 0}
                    onChange={handleToggleSelectAll}
                    className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Account</th>
                <th className="p-3.5">Payee / Merchant</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Notes / Memo</th>
                <th className="p-3.5 text-right">Amount</th>
                <th className="p-3.5 text-center">Splits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mx-auto mb-2"></div>
                    Loading ledger...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    No transactions found matching criteria.
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
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isChecked ? "bg-slate-800/30" : ""
                      }`}
                    >
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectRow(txn.id)}
                          className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="p-3.5 font-mono text-[11px] text-slate-300">
                        {txn.transaction_date?.split("T")[0]}
                      </td>
                      <td className="p-3.5 text-slate-300 text-xs font-semibold">
                        {matchedAccount?.name || "Account"}
                      </td>
                      <td className="p-3.5">
                        <div className="text-slate-100 font-semibold">{txn.normalized_payee || txn.raw_payee}</div>
                        {txn.normalized_payee && txn.normalized_payee !== txn.raw_payee && (
                          <div className="text-[10px] text-slate-500 font-mono truncate max-w-xs">{txn.raw_payee}</div>
                        )}
                      </td>
                      <td className="p-3.5">
                        {isSplit ? (
                          <button
                            onClick={() => handleOpenSplitModal(txn)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25"
                          >
                            <Layers className="w-3 h-3" /> Split ({txn.splits.length})
                          </button>
                        ) : (
                          <select
                            value={txn.splits?.[0]?.category_id || ""}
                            onChange={(e) => handleInlineCategoryChange(txn, e.target.value)}
                            className="bg-slate-800 border border-slate-700/80 text-slate-200 text-xs rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                          >
                            <option value="">Uncategorized</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-400 text-xs truncate max-w-[150px]">
                        {txn.notes || "-"}
                      </td>
                      <td
                        className={`p-3.5 text-right font-mono font-bold text-sm ${
                          txn.amount >= 0 ? "text-emerald-400" : "text-slate-100"
                        }`}
                      >
                        {txn.amount >= 0 ? "+" : ""}${Math.abs(txn.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => handleOpenSplitModal(txn)}
                          title="Edit splits or loan breakdown"
                          className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors"
                        >
                          <Split className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-800/80">
          <div className="text-xs text-slate-400">
            {totalCount === 0
              ? "No transactions"
              : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount.toLocaleString()}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800/60"
            >
              Previous
            </button>
            <span className="text-xs text-slate-400 tabular-nums">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800/60"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Split Transaction Modal */}
      {splitModalTxn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100">Split Transaction</h3>
                <p className="text-xs text-slate-400">
                  {splitModalTxn.normalized_payee || splitModalTxn.raw_payee} • Total:{" "}
                  <b className="text-slate-200">${Math.abs(splitModalTxn.amount).toFixed(2)}</b>
                </p>
              </div>
              <button
                onClick={() => setSplitModalTxn(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {modalSplits.map((split, idx) => (
                <div key={idx} className="flex items-center gap-2 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                  <select
                    value={split.category_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setModalSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, category_id: val } : s))
                      );
                    }}
                    className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg"
                  >
                    <option value="">Select Category</option>
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
                    className="w-24 px-2.5 py-1.5 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg font-mono text-right"
                  />

                  {modalSplits.length > 1 && (
                    <button
                      onClick={() => {
                        setModalSplits(modalSplits.filter((_, i) => i !== idx));
                      }}
                      className="p-1 text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  setModalSplits([...modalSplits, { category_id: "", amount: 0, memo: "" }]);
                }}
                className="w-full py-2 border border-dashed border-slate-700 rounded-xl text-xs font-semibold text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 transition-all"
              >
                + Add Another Split
              </button>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="text-xs">
                Total Split:{" "}
                <span className="font-bold text-slate-200">
                  ${modalSplits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0).toFixed(2)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSplitModalTxn(null)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSplits}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  Save Splits
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Transaction Modal */}
      {isNewTxnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <form
            onSubmit={handleCreateManualTxn}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100">Add Manual Transaction</h3>
              <button
                type="button"
                onClick={() => setIsNewTxnOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Account</label>
                <select
                  value={newTxn.account_id}
                  onChange={(e) => setNewTxn({ ...newTxn, account_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
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
                  <label className="block text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={newTxn.transaction_date}
                    onChange={(e) => setNewTxn({ ...newTxn, transaction_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Amount (Negative for expense)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="-50.00"
                    value={newTxn.amount}
                    onChange={(e) => setNewTxn({ ...newTxn, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Payee / Merchant</label>
                <input
                  type="text"
                  placeholder="e.g. Trader Joe's"
                  value={newTxn.raw_payee}
                  onChange={(e) => setNewTxn({ ...newTxn, raw_payee: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category</label>
                <select
                  value={newTxn.category_id}
                  onChange={(e) => setNewTxn({ ...newTxn, category_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="Memo, check number..."
                  value={newTxn.notes}
                  onChange={(e) => setNewTxn({ ...newTxn, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewTxnOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Save Transaction
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
