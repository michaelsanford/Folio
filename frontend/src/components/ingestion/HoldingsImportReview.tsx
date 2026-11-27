import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, FileText, RefreshCw, Wallet } from "lucide-react";
import type {
  Account,
  HoldingsCommitPosition,
  HoldingsCommitResponse,
  HoldingsComparison,
  HoldingsImportPreview,
  HoldingsPositionPreview,
  IngestionAccountResolution,
} from "../../types";
import { api } from "../../services/api";
import { formatMoney, formatNumber } from "../../utils/format";
import { isInvestmentAccount } from "../../constants/canadianAccountTypes";
import { type AccountResolutionDraft, DestinationSelect, NewAccountFields } from "./AccountDraftFields";
import {
  checkboxClass,
  pageStack,
  primaryButton,
  secondaryButton,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
} from "../common/ui";

const chip = "inline-flex items-center rounded-md px-2 py-0.5 text-sm";

interface HoldingsImportReviewProps {
  holdings: HoldingsImportPreview;
  filename: string;
  fileId?: string | null;
  accounts: Account[];
  onCancel: () => void;
  onCommitted: (message: string) => void;
  onError: (message: string) => void;
}

const quantityText = (q: string | number) => {
  const n = Number(q);
  return Number.isFinite(n) ? formatNumber(n, 8) : String(q);
};

const formatAsOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
};

function toCommitPositions(positions: HoldingsPositionPreview[]): HoldingsCommitPosition[] {
  return positions.map((p) => ({
    symbol: p.symbol,
    name: p.name,
    asset_class: p.asset_class,
    currency: p.currency,
    quantity: String(p.quantity),
    book_cost: p.book_cost,
    last_price: p.last_price,
    previous_close: p.previous_close,
    market_value: p.market_value,
  }));
}

const StatusChip: React.FC<{ position: HoldingsPositionPreview }> = ({ position }) => {
  if (position.status === "UNCHANGED") {
    return <span className={`${chip} bg-surface-subtle text-sub`}>Unchanged</span>;
  }
  if (position.status === "CHANGED") {
    const was = position.current_quantity != null ? ` · was ${quantityText(position.current_quantity)} units` : "";
    return <span className={`${chip} bg-warning-subtle text-warning`}>Changed{was}</span>;
  }
  return <span className={`${chip} bg-accent-subtle text-accent-main`}>New</span>;
};

/**
 * Review of a broker holdings export before it replaces an account's positions:
 * where it goes, what is new or changed, the cash, and which positions Folio
 * holds that the file no longer lists (removed only when ticked).
 */
export const HoldingsImportReview: React.FC<HoldingsImportReviewProps> = ({
  holdings,
  filename,
  fileId,
  accounts,
  onCancel,
  onCommitted,
  onError,
}) => {
  const investmentAccounts = useMemo(() => accounts.filter((a) => isInvestmentAccount(a.type)), [accounts]);
  const det = holdings.account;
  const [draft, setDraft] = useState<AccountResolutionDraft>(() => ({
    mode: det.matched_account_id ? "existing" : "create",
    existing_account_id: det.matched_account_id || "",
    name: det.suggested_name,
    type: det.suggested_type,
    institution: det.institution || "",
    account_number_mask: det.account_number_mask || "",
    currency: det.currency || "CAD",
  }));
  const [comparison, setComparison] = useState<HoldingsComparison>(holdings);
  const [isComparing, setIsComparing] = useState(false);
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const [isCommitting, setIsCommitting] = useState(false);

  const commitPositions = useMemo(() => toCommitPositions(holdings.positions), [holdings.positions]);

  // Line the file up again whenever the destination (or a new account's currency) changes.
  const destinationKey =
    draft.mode === "existing" ? `existing:${draft.existing_account_id}` : `create:${draft.currency.toUpperCase()}`;
  const firstKey = useRef(destinationKey);
  useEffect(() => {
    if (destinationKey === firstKey.current) {
      setComparison(holdings);
      return;
    }
    if (draft.mode === "create" && draft.currency.trim().length !== 3) return;
    let cancelled = false;
    setIsComparing(true);
    api
      .compareHoldingsImport({
        account_id: draft.mode === "existing" ? draft.existing_account_id : null,
        currency: (draft.currency || "CAD").toUpperCase(),
        positions: commitPositions,
        cash: holdings.cash,
        file_total: holdings.file_total,
      })
      .then((res) => {
        if (cancelled) return;
        setComparison(res);
        setRemoveIds(new Set());
      })
      .catch((err: any) => !cancelled && onError(`Could not compare with that account: ${err.message}`))
      .finally(() => !cancelled && setIsComparing(false));
    return () => {
      cancelled = true;
    };
  }, [destinationKey]);

  const currency = comparison.account_currency || "CAD";
  const money = (v: number) => formatMoney(v, { currency });
  const counts = comparison.positions.reduce(
    (acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }),
    {} as Record<string, number>
  );
  const difference =
    comparison.file_total != null ? Math.round((comparison.import_total - comparison.file_total) * 100) / 100 : null;
  const accountLabel =
    draft.mode === "existing"
      ? investmentAccounts.find((a) => a.id === draft.existing_account_id)?.name || det.suggested_name
      : draft.name || det.suggested_name;

  const toggleRemove = (id: string) =>
    setRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCommit = async () => {
    if (draft.mode === "create" && !draft.name.trim()) {
      onError(`Please enter a name for "${det.suggested_name}" before importing.`);
      return;
    }
    const account: IngestionAccountResolution =
      draft.mode === "existing" && draft.existing_account_id
        ? {
            source_account_key: det.source_account_key,
            existing_account_id: draft.existing_account_id,
            type: draft.type,
            currency: (draft.currency || "CAD").toUpperCase(),
          }
        : {
            source_account_key: det.source_account_key,
            name: draft.name.trim(),
            type: draft.type,
            institution: draft.institution.trim() || null,
            account_number_mask: draft.account_number_mask || null,
            currency: (draft.currency || "CAD").trim().toUpperCase() || "CAD",
          };
    setIsCommitting(true);
    try {
      const res: HoldingsCommitResponse = await api.commitHoldingsImport({
        statement_file_id: fileId ?? null,
        account,
        as_of_date: holdings.as_of_date,
        positions: commitPositions,
        cash_total: comparison.cash_total,
        remove_holding_ids: comparison.missing.filter((m) => removeIds.has(m.holding_id)).map((m) => m.holding_id),
      });
      const parts: string[] = [];
      if (res.added_count) parts.push(`${res.added_count} new`);
      if (res.updated_count) parts.push(`${res.updated_count} changed`);
      if (res.unchanged_count) parts.push(`${res.unchanged_count} unchanged`);
      if (res.removed_count) parts.push(`${res.removed_count} removed`);
      if (res.cash_total) parts.push(`cash ${money(res.cash_total)}`);
      onCommitted(
        `${res.account_name}${res.created ? " (new account)" : ""} updated: ${parts.join(", ")}. ` +
          `Balance ${money(res.new_account_balance)}`
      );
    } catch (err: any) {
      onError(`Import error: ${err.message}`);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className={`${pageStack} animate-in fade-in`}>
      {/* Summary strip */}
      <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-5 h-5 text-sub shrink-0" strokeWidth={1.5} />
            <span className="text-base font-medium text-main break-all md:break-words min-w-0">{filename}</span>
            <span className={`${chip} bg-surface-subtle text-sub`}>Holdings</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
            <span>As of {formatAsOf(holdings.as_of_date)}</span>
            <span>·</span>
            <span>
              <span className="tabular-nums text-main">{comparison.positions.length}</span> positions
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onCancel}
            className={`flex-1 sm:flex-none ${secondaryButton}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={isCommitting || isComparing}
            className={`flex-1 sm:flex-none ${primaryButton}`}
          >
            {isCommitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} /> Importing…
              </>
            ) : (
              <>
                Import holdings <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Destination */}
      <section className={`${section} space-y-4`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Building2 className="w-5 h-5 text-sub shrink-0" strokeWidth={1.5} />
            <span className="text-base font-medium text-main whitespace-normal break-words">{accountLabel}</span>
            {det.account_number_mask && (
              <span className={`${chip} bg-surface-subtle text-sub font-mono`}>{det.account_number_mask}</span>
            )}
            <span
              className={`${chip} ${
                draft.mode === "existing" ? "bg-positive-subtle text-positive" : "bg-accent-subtle text-accent-main"
              }`}
            >
              {draft.mode === "existing" ? "Existing" : "New account"}
            </span>
          </div>
          <DestinationSelect
            id="holdings-destination"
            draft={draft}
            accounts={investmentAccounts}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
        </div>
        {draft.mode === "create" && (
          <NewAccountFields
            draft={draft}
            label={det.suggested_name}
            allowedTypes={isInvestmentAccount}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
        )}
      </section>

      {/* Positions */}
      <section
        aria-label="Positions in this file"
        aria-busy={isComparing}
        className={`${section} ${isComparing ? "opacity-60" : ""}`}
      >
        <div className={`${sectionHeader} flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-sub`}>
          <h2 className={sectionTitle}>Positions</h2>
          {counts.NEW ? <span>{counts.NEW} new</span> : null}
          {counts.CHANGED ? <span>{counts.CHANGED} changed</span> : null}
          {counts.UNCHANGED ? <span>{counts.UNCHANGED} unchanged</span> : null}
        </div>

        {/* Phone rows */}
        <ul className="md:hidden border-y border-subtle divide-y divide-subtle">
          {comparison.positions.map((p) => (
            <li key={p.symbol} className="py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base text-main break-all">{p.symbol}</span>
                <span className="tabular-nums text-base text-main">{money(p.market_value)}</span>
              </div>
              {p.name && <div className="text-sm text-sub break-words">{p.name}</div>}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-sub">
                <span className="tabular-nums">
                  {quantityText(p.quantity)} units · cost {money(p.book_cost)}
                </span>
                <StatusChip position={p} />
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop table */}
        {/* Quantity and book cost fold under the name below lg */}
        <table className="hidden md:table w-full table-fixed text-sm" data-testid="holdings-review-table">
          <thead>
            <tr className="text-left text-sm text-sub border-y border-subtle">
              <th className="px-4 py-2 w-[96px] font-normal">Symbol</th>
              <th className="px-4 py-2 font-normal">Name</th>
              <th className="hidden lg:table-cell px-4 py-2 w-[104px] font-normal text-right">Quantity</th>
              <th className="hidden lg:table-cell px-4 py-2 w-[128px] font-normal text-right">Book cost</th>
              <th className="px-4 py-2 w-[128px] font-normal text-right">Market value</th>
              <th className="px-4 py-2 w-[136px] lg:w-[168px] font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {comparison.positions.map((p) => (
              <tr key={p.symbol}>
                <td className="px-4 py-2 font-mono text-main break-words">{p.symbol}</td>
                <td className="px-4 py-2 text-sub break-words">
                  {p.name}
                  <div className="lg:hidden text-sm text-sub tabular-nums">
                    {quantityText(p.quantity)} units · cost {money(p.book_cost)}
                  </div>
                </td>
                <td className="hidden lg:table-cell px-4 py-2 text-right tabular-nums text-main">{quantityText(p.quantity)}</td>
                <td className="hidden lg:table-cell px-4 py-2 text-right tabular-nums text-sub">{money(p.book_cost)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-main">{money(p.market_value)}</td>
                <td className="px-4 py-2">
                  <StatusChip position={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Cash */}
        <div className="md:px-4 py-3 border-t border-subtle flex flex-wrap items-center justify-between gap-2 text-base md:text-sm">
          <div className="flex items-center gap-2 text-main">
            <Wallet className="w-4 h-4 text-sub shrink-0" strokeWidth={1.5} />
            <span>Cash</span>
            {comparison.cash.length > 0 && (
              <span className="text-sm text-sub">
                {comparison.cash
                  .map((c) =>
                    c.currency === currency
                      ? formatMoney(c.amount, { currency: c.currency })
                      : `${formatMoney(c.amount, { currency: c.currency })} at ${formatNumber(c.rate_to_account, 5)}`
                  )
                  .join(" + ")}
              </span>
            )}
          </div>
          <span className="tabular-nums text-main">{money(comparison.cash_total)}</span>
        </div>

        {/* Total and check against the file */}
        <div className="md:px-4 py-3 border-t border-subtle flex flex-wrap items-center justify-between gap-2 text-base md:text-sm">
          <span className="font-medium text-main">Total</span>
          <span className="flex flex-wrap items-center gap-2">
            {difference === null ? null : difference === 0 ? (
              <span className="inline-flex items-center gap-1 text-sm text-positive">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Matches the file
              </span>
            ) : (
              <span className="text-sm text-sub">
                File says {money(comparison.file_total!)}; Folio keeps prices to the cent
              </span>
            )}
            <span className="tabular-nums font-medium text-main">{money(comparison.import_total)}</span>
          </span>
        </div>
      </section>

      {/* Held in Folio but not in the file */}
      {comparison.missing.length > 0 && (
        <section className={section}>
          <div className={sectionHeader}>
            <h2 className={sectionTitle}>In Folio but not in this file</h2>
            <p className={sectionSub}>
              Tick a position to remove it, for example one you have sold. Unticked positions are kept as they are.
            </p>
          </div>
          <ul className="border-y border-subtle divide-y divide-subtle">
            {comparison.missing.map((m) => (
              <li key={m.holding_id} className="py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label className="flex flex-wrap items-center gap-2 min-w-0 min-h-11 md:min-h-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeIds.has(m.holding_id)}
                    onChange={() => toggleRemove(m.holding_id)}
                    aria-label={`Remove ${m.symbol}`}
                    className={checkboxClass}
                  />
                  <span className="font-mono text-base md:text-sm text-main">{m.symbol}</span>
                  {m.name && <span className="text-sm text-sub break-words min-w-0">{m.name}</span>}
                </label>
                <span className="text-sm text-sub tabular-nums">
                  {quantityText(m.quantity)} units · {money(m.market_value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
