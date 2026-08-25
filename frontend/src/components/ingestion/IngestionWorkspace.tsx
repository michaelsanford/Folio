import React, { useState, useRef } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type { Account, Category, IngestionPreviewResponse, ParsedTransactionItem } from "../../types";
import { api } from "../../services/api";

interface IngestionWorkspaceProps {
  accounts: Account[];
  categories: Category[];
  onCommitSuccess: () => void;
}

export const IngestionWorkspace: React.FC<IngestionWorkspaceProps> = ({
  accounts,
  categories,
  onCommitSuccess,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    accounts[0]?.id || ""
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [preview, setPreview] = useState<IngestionPreviewResponse | null>(null);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [rowCategories, setRowCategories] = useState<{ [hash: string]: string }>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAccount = accounts.find((a) => a.id === selectedAccountId);

  const handleFileUpload = async (file: File) => {
    if (!selectedAccountId) {
      alert("Please select a target account first.");
      return;
    }

    setIsLoading(true);
    setSuccessMessage(null);
    try {
      const resp = await api.uploadStatementPreview(selectedAccountId, file);
      setPreview(resp);

      // Pre-select all non-duplicate items
      const initialSelected = new Set<string>();
      const initialCats: { [hash: string]: string } = {};

      resp.items.forEach((item) => {
        if (!item.is_duplicate) {
          initialSelected.add(item.import_hash);
        }
        if (item.suggested_category_id) {
          initialCats[item.import_hash] = item.suggested_category_id;
        }
      });

      setSelectedHashes(initialSelected);
      setRowCategories(initialCats);
    } catch (err: any) {
      alert(`Ingestion failed: ${err.message}`);
    } finally {
      setIsLoading(false);
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
    if (!preview) return;
    if (selectedHashes.size === preview.items.length) {
      setSelectedHashes(new Set());
    } else {
      setSelectedHashes(new Set(preview.items.map((i) => i.import_hash)));
    }
  };

  const handleToggleHash = (hash: string) => {
    const next = new Set(selectedHashes);
    if (next.has(hash)) {
      next.delete(hash);
    } else {
      next.add(hash);
    }
    setSelectedHashes(next);
  };

  const handleCategoryChange = (hash: string, categoryId: string) => {
    setRowCategories((prev) => ({
      ...prev,
      [hash]: categoryId,
    }));
  };

  const handleCommit = async () => {
    if (!preview || selectedHashes.size === 0) return;

    setIsCommitting(true);
    try {
      const itemsToCommit = preview.items
        .filter((item) => selectedHashes.has(item.import_hash))
        .map((item) => ({
          transaction_date: item.transaction_date,
          raw_payee: item.raw_payee,
          normalized_payee: item.normalized_payee,
          amount: item.amount,
          category_id: rowCategories[item.import_hash] || item.suggested_category_id || null,
          import_hash: item.import_hash,
        }));

      const res = await api.commitIngestionBatch({
        account_id: selectedAccountId,
        statement_file_id: preview.file_id,
        items: itemsToCommit,
      });

      setSuccessMessage(
        `Successfully imported ${res.committed_count} transactions to ${activeAccount?.name}! New balance: $${res.new_account_balance.toLocaleString()}`
      );
      setPreview(null);
      setSelectedHashes(new Set());
      onCommitSuccess();
    } catch (err: any) {
      alert(`Commit error: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Account Selection */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-100">Statement Ingestion Engine</h1>
          <p className="text-xs text-slate-400 mt-1">
            Upload CSV bank exports, PDF statements, or OFX/QFX downloads with intelligent deduplication.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 shrink-0">
          <label className="text-xs font-semibold text-slate-300">Target Account:</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full sm:w-auto px-3.5 py-2 bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} (${acc.current_balance.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-emerald-300 text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold">{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upload Dropzone */}
      {!preview && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer border-2 border-dashed rounded-3xl p-6 sm:p-12 text-center transition-all duration-200 ${
            isDragging
              ? "border-indigo-500 bg-indigo-500/10 scale-[1.01]"
              : "border-slate-800 hover:border-slate-700 bg-slate-900/40"
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

          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/10">
              {isLoading ? (
                <RefreshCw className="w-7 h-7 sm:w-8 sm:h-8 animate-spin" />
              ) : (
                <UploadCloud className="w-7 h-7 sm:w-8 sm:h-8" />
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm sm:text-base font-semibold text-slate-200">
                {isLoading ? "Parsing bank statement..." : "Drop your statement file here, or browse"}
              </p>
              <p className="text-xs text-slate-400">
                Supports <span className="text-indigo-400 font-medium">CSV</span>,{" "}
                <span className="text-indigo-400 font-medium">PDF Statements</span>, and{" "}
                <span className="text-indigo-400 font-medium">OFX / QFX / QBO</span>.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Auto Deduplication
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-indigo-400" /> AI / Rule Categorization
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Parse Preview Table & Reconciliation */}
      {preview && (
        <div className="space-y-4 animate-in fade-in">
          {/* Summary Strip */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span className="text-xs sm:text-sm font-semibold text-slate-200 truncate max-w-[160px] sm:max-w-xs">{preview.filename}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                  {preview.file_type}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">Total: <b className="text-slate-200">{preview.total_parsed}</b></span>
                <span className="text-emerald-400">New: <b>{preview.new_count}</b></span>
                {preview.duplicates_count > 0 && (
                  <span className="text-amber-400">Dupes: <b>{preview.duplicates_count}</b></span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              <button
                onClick={() => setPreview(null)}
                className="flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={selectedHashes.size === 0 || isCommitting}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition-all"
              >
                {isCommitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Committing...
                  </>
                ) : (
                  <>
                    Commit ({selectedHashes.size}) <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Review Container */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
            {/* Mobile Cards Feed (< md) */}
            <div className="block md:hidden divide-y divide-slate-800/60 font-medium">
              {preview.items.map((item) => {
                const isChecked = selectedHashes.has(item.import_hash);
                const assignedCat = rowCategories[item.import_hash] || item.suggested_category_id || "";

                return (
                  <div
                    key={item.import_hash}
                    className={`p-3.5 flex items-start gap-3 transition-colors ${
                      item.is_duplicate
                        ? "bg-rose-950/10 text-slate-400"
                        : isChecked
                        ? "bg-slate-800/30"
                        : "opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleHash(item.import_hash)}
                      className="mt-1 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 shrink-0"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-100 truncate">
                            {item.normalized_payee}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono truncate">
                            {item.raw_payee}
                          </div>
                        </div>
                        <div
                          className={`font-mono font-bold text-xs shrink-0 ${
                            item.amount >= 0 ? "text-emerald-400" : "text-slate-100"
                          }`}
                        >
                          {item.amount >= 0 ? "+" : ""}${Math.abs(item.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                        <span className="text-slate-400 font-mono">{item.transaction_date}</span>
                        <span className="text-slate-600">•</span>

                        <select
                          value={assignedCat}
                          onChange={(e) => handleCategoryChange(item.import_hash, e.target.value)}
                          className="bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-1.5 py-0.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none max-w-[130px] truncate"
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        {item.is_duplicate ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <AlertTriangle className="w-2.5 h-2.5" /> Dupe
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-2.5 h-2.5" /> New
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedHashes.size === preview.items.length && preview.items.length > 0}
                        onChange={handleToggleSelectAll}
                        className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Raw Bank Payee</th>
                    <th className="p-3.5">Clean Merchant</th>
                    <th className="p-3.5">Category Assignment</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {preview.items.map((item) => {
                    const isChecked = selectedHashes.has(item.import_hash);
                    const assignedCat = rowCategories[item.import_hash] || item.suggested_category_id || "";

                    return (
                      <tr
                        key={item.import_hash}
                        className={`transition-colors ${
                          item.is_duplicate
                            ? "bg-rose-950/10 text-slate-400"
                            : isChecked
                            ? "bg-slate-800/30 text-slate-200"
                            : "text-slate-400 opacity-60"
                        }`}
                      >
                        <td className="p-3.5 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleHash(item.import_hash)}
                            className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-3.5 font-mono text-[11px] text-slate-300">
                          {item.transaction_date}
                        </td>
                        <td className="p-3.5 text-slate-400 font-mono text-[11px] max-w-xs truncate">
                          {item.raw_payee}
                        </td>
                        <td className="p-3.5 text-slate-200 font-semibold">
                          {item.normalized_payee}
                        </td>
                        <td className="p-3.5">
                          <select
                            value={assignedCat}
                            onChange={(e) => handleCategoryChange(item.import_hash, e.target.value)}
                            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          >
                            <option value="">Uncategorized</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3.5">
                          {item.is_duplicate ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              <AlertTriangle className="w-3 h-3" /> Duplicate
                            </span>
                          ) : item.potential_transfer_account_name ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              Transfer: {item.potential_transfer_account_name}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> New
                            </span>
                          )}
                        </td>
                        <td className={`p-3.5 text-right font-mono font-bold text-sm ${
                          item.amount >= 0 ? "text-emerald-400" : "text-slate-100"
                        }`}>
                          {item.amount >= 0 ? "+" : ""}${Math.abs(item.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
