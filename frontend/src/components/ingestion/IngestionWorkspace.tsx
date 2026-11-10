import React, { useState, useRef } from "react";
import { UploadCloud, FileText, CheckCircle2, ArrowRight, RefreshCw } from "lucide-react";
import type { Account, Category, IngestionPreviewResponse } from "../../types";
import { api } from "../../services/api";
import { Money } from "../common/Money";
import { formatMoney } from "../../utils/format";

const selectClass =
  "h-9 px-3 rounded-lg border border-default bg-input text-sm text-main focus:outline-none focus:border-[var(--accent-primary)]";
const compactSelectClass =
  "h-8 px-2 rounded-lg border border-default bg-input text-xs text-main focus:outline-none focus:border-[var(--accent-primary)]";
const checkboxClass = "rounded border-default bg-input text-accent-main focus:ring-accent-main";
const chip = "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs";

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
      alert("Select an account first");
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
          category_id:
            rowCategories[item.import_hash] || item.suggested_category_id || undefined,
          import_hash: item.import_hash,
        }));

      const res = await api.commitIngestionBatch({
        account_id: selectedAccountId,
        statement_file_id: preview.file_id ?? undefined,
        items: itemsToCommit,
      });

      setSuccessMessage(
        `Imported ${res.committed_count} transactions to ${activeAccount?.name} · new balance ${formatMoney(res.new_account_balance)}`
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
      {/* Header & account selection */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-main">Import statements</h1>
          <p className="mt-1 text-sm text-sub">
            Upload CSV exports, PDF statements, or OFX/QFX downloads. Duplicates are detected
            automatically.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
          <label htmlFor="ingestionAccount" className="text-sm text-sub">
            Account
          </label>
          <select
            id="ingestionAccount"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className={`w-full sm:w-auto ${selectClass}`}
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} · {formatMoney(acc.current_balance)}
              </option>
            ))}
          </select>
        </div>
      </header>

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
              <p className="text-sm text-sub">CSV, PDF statements, and OFX, QFX or QBO files</p>
            </div>

            <p className="text-xs text-muted">
              Duplicates are flagged and categories come from your rules
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
                  <span className="font-mono text-main">{preview.total_parsed}</span> parsed
                </span>
                <span>·</span>
                <span>
                  <span className="font-mono text-main">{preview.new_count}</span> new
                </span>
                {preview.duplicates_count > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-warning">
                      <span className="font-mono">{preview.duplicates_count}</span> duplicates
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="flex-1 sm:flex-none h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={selectedHashes.size === 0 || isCommitting}
                className="flex-1 sm:flex-none h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main disabled:opacity-50 text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
              >
                {isCommitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} /> Importing…
                  </>
                ) : (
                  <>
                    Import {selectedHashes.size} <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Review container */}
          <div className="rounded-xl border border-subtle bg-surface overflow-hidden">
            {/* Mobile cards feed (< md) */}
            <div className="block md:hidden divide-y divide-subtle">
              {preview.items.map((item) => {
                const isChecked = selectedHashes.has(item.import_hash);
                const assignedCat = rowCategories[item.import_hash] || item.suggested_category_id || "";

                return (
                  <div
                    key={item.import_hash}
                    className={`p-4 flex items-start gap-3 transition-colors ${
                      item.is_duplicate ? "text-muted" : isChecked ? "" : "opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleHash(item.import_hash)}
                      aria-label="Include transaction"
                      className={`mt-1 shrink-0 ${checkboxClass}`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-main truncate">{item.normalized_payee}</div>
                          <div className="text-[11px] text-muted font-mono truncate">{item.raw_payee}</div>
                        </div>
                        <Money
                          value={item.amount}
                          signed
                          className={`text-sm shrink-0 ${item.amount >= 0 ? "text-positive" : "text-main"}`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                        <span className="text-muted font-mono">{item.transaction_date}</span>
                        <span className="text-muted">·</span>

                        <select
                          value={assignedCat}
                          onChange={(e) => handleCategoryChange(item.import_hash, e.target.value)}
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
                          <span className={`${chip} bg-warning-subtle text-warning`}>Duplicate</span>
                        ) : (
                          <span className={`${chip} bg-positive-subtle text-positive`}>New</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted border-b border-subtle">
                  <tr>
                    <th className="px-4 py-3 w-10 text-center font-normal">
                      <input
                        type="checkbox"
                        checked={selectedHashes.size === preview.items.length && preview.items.length > 0}
                        onChange={handleToggleSelectAll}
                        aria-label="Include all transactions"
                        className={checkboxClass}
                      />
                    </th>
                    <th className="px-4 py-3 font-normal">Date</th>
                    <th className="px-4 py-3 font-normal">Bank description</th>
                    <th className="px-4 py-3 font-normal">Payee</th>
                    <th className="px-4 py-3 font-normal">Category</th>
                    <th className="px-4 py-3 font-normal">Status</th>
                    <th className="px-4 py-3 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {preview.items.map((item) => {
                    const isChecked = selectedHashes.has(item.import_hash);
                    const assignedCat = rowCategories[item.import_hash] || item.suggested_category_id || "";

                    return (
                      <tr
                        key={item.import_hash}
                        className={`transition-colors ${
                          item.is_duplicate ? "text-muted" : isChecked ? "text-main" : "text-muted opacity-60"
                        }`}
                      >
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleHash(item.import_hash)}
                            aria-label="Include transaction"
                            className={checkboxClass}
                          />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted whitespace-nowrap">
                          {item.transaction_date}
                        </td>
                        <td className="px-4 py-2 text-muted font-mono text-[11px] max-w-xs truncate">
                          {item.raw_payee}
                        </td>
                        <td className="px-4 py-2 text-main">{item.normalized_payee}</td>
                        <td className="px-4 py-2">
                          <select
                            value={assignedCat}
                            onChange={(e) => handleCategoryChange(item.import_hash, e.target.value)}
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
                        </td>
                        <td className="px-4 py-2">
                          {item.is_duplicate ? (
                            <span className={`${chip} bg-warning-subtle text-warning`}>Duplicate</span>
                          ) : item.potential_transfer_account_name ? (
                            <span className={`${chip} bg-surface-subtle text-sub`}>
                              Transfer · {item.potential_transfer_account_name}
                            </span>
                          ) : (
                            <span className={`${chip} bg-positive-subtle text-positive`}>New</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Money
                            value={item.amount}
                            signed
                            className={item.amount >= 0 ? "text-positive" : "text-main"}
                          />
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
