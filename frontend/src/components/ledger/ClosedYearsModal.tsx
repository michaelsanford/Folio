import React, { useCallback, useEffect, useState } from "react";
import { Download, Lock, LockOpen, X } from "lucide-react";
import type { PeriodsResponse, YearClosure } from "../../types";
import { api } from "../../services/api";
import { useSession } from "../../hooks/useSession";

interface ClosedYearsModalProps {
  onClose: () => void;
  /** Reload the app's data after the lock moved. */
  onChanged: () => void;
}

const button =
  "h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default";

const formatBytes = (n?: number | null) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

/**
 * Close a finished year: its transactions are locked and a read-only archive
 * is kept in long-term storage. Owners close and reopen; everyone can see
 * which years are closed and download an archive.
 */
export const ClosedYearsModal: React.FC<ClosedYearsModalProps> = ({ onClose, onChanged }) => {
  const { me } = useSession();
  const isOwner = me?.is_owner ?? true;
  const [data, setData] = useState<PeriodsResponse | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.periods.list());
    } catch (err: any) {
      setError(err?.message || "Couldn’t load closed years");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (year: number, action: () => Promise<unknown>, done: string) => {
    setBusy(year);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      await load();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "That didn’t work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const close = (year: number) => {
    if (
      !confirm(
        `Close ${year}? Its transactions can no longer be added, changed or deleted, and a read-only copy is archived. An owner can reopen it later.`
      )
    )
      return;
    void act(year, () => api.periods.close(year), `${year} is closed and archived.`);
  };

  const download = async (c: YearClosure) => {
    setBusy(c.year);
    setError(null);
    try {
      const blob = await api.periods.downloadArchive(c.year);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `folio-${c.year}.db.zst`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Couldn’t download the archive");
    } finally {
      setBusy(null);
    }
  };

  const active = data?.closures.filter((c) => c.is_active) ?? [];
  const reopened = data?.closures.filter((c) => !c.is_active) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="closed-years-title"
        className="relative w-full max-w-lg bg-surface border border-default rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-subtle">
          <div>
            <h2 id="closed-years-title" className="text-base font-medium text-main">
              Closed years
            </h2>
            <p className="text-xs text-muted mt-1">
              {data?.closed_through_year != null
                ? `Transactions up to Dec 31, ${data.closed_through_year} are locked.`
                : "Close a finished year to lock its transactions and keep an archived copy."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {error && (
            <div role="alert" className="p-3 rounded-lg bg-negative-subtle text-xs text-negative">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="p-3 rounded-lg bg-surface-subtle text-xs text-sub">
              {notice}
            </div>
          )}

          {isOwner && data && data.closable_years.length > 0 && (
            <section aria-labelledby="closable-heading" className="space-y-2">
              <h3 id="closable-heading" className="text-sm font-medium text-main">
                Ready to close
              </h3>
              <ul className="space-y-2">
                {data.closable_years.map((year) => (
                  <li key={year} className="flex items-center justify-between p-3 rounded-lg border border-default">
                    <span className="text-sm text-main tabular-nums">{year}</span>
                    <button className={button} disabled={busy !== null} onClick={() => close(year)}>
                      <Lock className="w-3.5 h-3.5" strokeWidth={1.5} />
                      {busy === year ? "Closing…" : `Close ${year}`}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Closing a year also locks every year before it.
              </p>
            </section>
          )}

          <section aria-labelledby="closed-heading" className="space-y-2">
            <h3 id="closed-heading" className="text-sm font-medium text-main">
              Closed
            </h3>
            {data && active.length === 0 && <p className="text-sm text-muted">No years are closed.</p>}
            <ul className="space-y-2">
              {[...active, ...reopened].map((c) => (
                <li key={c.year} className="p-3 rounded-lg border border-default flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-main">
                      {c.is_active ? (
                        <Lock className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} aria-hidden="true" />
                      ) : (
                        <LockOpen className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} aria-hidden="true" />
                      )}
                      <span className="tabular-nums">{c.year}</span>
                      {!c.is_active && <span className="text-xs text-muted">reopened</span>}
                    </div>
                    <div className="text-xs text-muted">
                      Closed {formatDate(c.closed_at)}
                      {c.closed_by_name ? ` by ${c.closed_by_name}` : ""}
                      {c.row_counts?.transactions != null ? ` · ${c.row_counts.transactions} transactions` : ""}
                      {c.archive_bytes ? ` · ${formatBytes(c.archive_bytes)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.archive_available && (
                      <button
                        className={button}
                        disabled={busy !== null}
                        onClick={() => void download(c)}
                        aria-label={`Download the ${c.year} archive`}
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Archive
                      </button>
                    )}
                    {/* Only the latest closed year can reopen: earlier ones stay locked behind it. */}
                    {isOwner && c.is_active && c.year === data?.closed_through_year && (
                      <button
                        className={button}
                        disabled={busy !== null}
                        onClick={() => void act(c.year, () => api.periods.reopen(c.year), `${c.year} is open for changes again.`)}
                      >
                        <LockOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted">
            Archives are compressed SQLite files (.db.zst) kept in long-term storage. Imports skip rows dated in a closed
            year.
          </p>
        </div>
      </div>
    </div>
  );
};
