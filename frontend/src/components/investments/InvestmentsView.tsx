import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, RefreshCw, Trash2 } from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { ProjectionPanel } from "./ProjectionPanel";
import { QuoteBadge, formatQuoteTime } from "./QuoteBadge";
import { QuoteTicker } from "./QuoteTicker";
import { isInvestmentAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact, formatNumber } from "../../utils/format";
import type {
  Account,
  HoldingValuation,
  PerformanceResponse,
  QuoteRefreshResponse,
  SymbolLookupResponse,
} from "../../types";
import { api } from "../../services/api";

interface InvestmentsViewProps {
  accounts: Account[];
  onDataModified: () => void;
}

const PERIOD_ORDER = ["1M", "3M", "YTD", "1Y", "ALL"] as const;

const percent = (value: number | null) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const todayIso = () => new Date().toISOString().split("T")[0];

/** Line under a price: when it was quoted, or that it was typed in. */
function priceDetail(h: HoldingValuation, currency: string): string {
  if (!h.price_source || h.price_source === "MANUAL") {
    if (!h.price_as_of) return "";
    const [y, m, d] = h.price_as_of.split("-").map(Number);
    return `Entered ${new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
  }
  if ((h.price_session === "PRE" || h.price_session === "POST") && h.previous_close != null) {
    return `Close ${formatMoney(h.previous_close, { currency })}`;
  }
  return formatQuoteTime(h.price_quoted_at) ?? `As of ${h.price_as_of}`;
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  EQUITY: "Stocks",
  ETF: "ETFs",
  MUTUAL_FUND: "Mutual funds",
  FIXED_INCOME: "Bonds",
  CASH: "Cash",
  CRYPTO: "Crypto",
  OTHER: "Other",
};

/** Session flag: quotes refresh by themselves once per browser session. */
const AUTO_REFRESH_KEY = "folio.quotes.autoRefreshed";
const REFRESHED_AT_KEY = "folio.quotes.refreshedAt";

const sessionGet = (key: string): string | null => {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const sessionSet = (key: string, value: string) => {
  try {
    globalThis.sessionStorage?.setItem(key, value);
  } catch {
    /* private mode or blocked storage: refresh again next visit */
  }
};

const SOURCE_LABELS: Record<string, string> = { YAHOO: "Yahoo", TMX: "TMX" };

/** One line saying exactly what a quote refresh did. */
export function summarizeRefresh(res: QuoteRefreshResponse): string {
  const parts: string[] = [];
  const bySource = new Map<string, number>();
  for (const q of res.quotes ?? []) bySource.set(q.source, (bySource.get(q.source) ?? 0) + 1);
  const sources = [...bySource].map(([src, n]) => `${SOURCE_LABELS[src] ?? src} ${n}`).join(", ");
  parts.push(`Updated ${res.updated_count}${sources ? ` (${sources})` : ""}`);
  if (res.skipped_closed?.length) parts.push(`Market closed: ${res.skipped_closed.length}`);
  if (res.skipped_recent?.length) parts.push(`Already current: ${res.skipped_recent.length}`);
  if (res.skipped_manual?.length) parts.push(`Priced by hand today: ${res.skipped_manual.join(", ")}`);
  const failures = res.failures?.length
    ? res.failures.map((f) => `${f.symbol} (${f.reason})`)
    : res.failed_symbols ?? [];
  if (failures.length) parts.push(`Couldn't quote: ${failures.join(", ")}`);
  if (res.timed_out) parts.push("Some quotes timed out");
  return parts.join(" · ");
}

/** Positions below this share of the portfolio are grouped as "Other" in the donut. */
const SMALL_POSITION_SHARE = 0.03;

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({
  accounts,
  onDataModified,
}) => {
  const chartTheme = useChartTheme();

  const investmentAccounts = useMemo(
    () => accounts.filter((a) => isInvestmentAccount(a.type)),
    [accounts]
  );

  const [accountId, setAccountId] = useState<string>("");
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isFetchingQuotes, setIsFetchingQuotes] = useState(false);
  const [fxRate, setFxRate] = useState<{
    pair: string;
    rate: number | null;
    source?: string;
    as_of_date?: string;
  } | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newHolding, setNewHolding] = useState({
    symbol: "",
    name: "",
    trade_date: todayIso(),
    quantity: "",
    cost_basis: "",
    fee: "0",
  });

  const [isPriceOpen, setIsPriceOpen] = useState(false);
  const [priceDate, setPriceDate] = useState(todayIso());
  const [priceText, setPriceText] = useState("");
  const [projectionOpened, setProjectionOpened] = useState(false);
  const [quotesRefreshedAt, setQuotesRefreshedAt] = useState<string | null>(() => sessionGet(REFRESHED_AT_KEY));
  const [symbolLookup, setSymbolLookup] = useState<SymbolLookupResponse | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  useEffect(() => {
    if (!accountId && investmentAccounts.length > 0) {
      setAccountId(investmentAccounts[0].id);
    }
  }, [investmentAccounts, accountId]);

  const load = async (id = accountId) => {
    if (!id) return;
    setIsLoading(true);
    try {
      setPerformance(await api.getPerformance(id));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load investment performance.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadFxRate = async () => {
    try {
      const data = await api.getFxRate("USDCAD");
      if (data && data.rate !== null && data.rate !== undefined) {
        setFxRate(data);
      }
    } catch {
      // Non-critical background fetch
    }
  };

  useEffect(() => {
    loadFxRate();
  }, []);

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

  // Largest positions first; weights are shares of total market value.
  const sortedHoldings = useMemo(
    () => [...(performance?.holdings ?? [])].sort((a, b) => b.market_value - a.market_value),
    [performance]
  );
  const totalValue = sortedHoldings.reduce((sum, h) => sum + Math.max(0, h.market_value), 0);
  const weight = (h: HoldingValuation) =>
    totalValue > 0 ? `${((Math.max(0, h.market_value) / totalValue) * 100).toFixed(1)}%` : "—";

  /**
   * Refresh delayed quotes. The first visit in a session does this by itself
   * and stays quiet unless something failed; the button reports every outcome.
   */
  const refreshQuotes = async ({ automatic = false } = {}) => {
    setIsFetchingQuotes(true);
    if (!automatic) setError(null);
    try {
      const res = await api.fetchAutomatedQuotes();
      const rateVal = res.usdcad_fx_rate;
      if (rateVal !== null && rateVal !== undefined) {
        setFxRate({
          pair: "USDCAD",
          rate: rateVal,
          source: "Bank of Canada",
          as_of_date: todayIso(),
        });
      }
      const at = res.refreshed_at || new Date().toISOString();
      setQuotesRefreshedAt(at);
      sessionSet(REFRESHED_AT_KEY, at);
      if (!automatic || res.failed_count > 0) setNotice(summarizeRefresh(res));

      await load();
      onDataModified();
    } catch (err: any) {
      if (!automatic) setError(err?.message || "Could not refresh quotes.");
    } finally {
      setIsFetchingQuotes(false);
    }
  };

  // Once per browser session, refresh quotes when the page first opens.
  useEffect(() => {
    if (investmentAccounts.length === 0 || sessionGet(AUTO_REFRESH_KEY)) return;
    sessionSet(AUTO_REFRESH_KEY, "1");
    void refreshQuotes({ automatic: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investmentAccounts.length]);

  const currency = investmentAccounts.find((a) => a.id === accountId)?.currency || "CAD";

  // While adding a holding, show which listing the typed symbol means.
  useEffect(() => {
    const typed = newHolding.symbol.trim();
    if (!isAddOpen || typed.length === 0) {
      setSymbolLookup(null);
      return;
    }
    let cancelled = false;
    setIsLookingUp(true);
    const timer = window.setTimeout(() => {
      api
        .lookupSymbol(typed, currency)
        .then((r) => !cancelled && setSymbolLookup(r))
        .catch(() => !cancelled && setSymbolLookup(null))
        .finally(() => !cancelled && setIsLookingUp(false));
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newHolding.symbol, isAddOpen, currency]);

  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createHolding({
        account_id: accountId,
        // Save the listing the lookup found (XEQT -> XEQT.TO), so it can be quoted.
        symbol: symbolLookup?.found && symbolLookup.listing ? symbolLookup.listing : newHolding.symbol,
        name: newHolding.name || undefined,
        lots: [
          {
            trade_date: newHolding.trade_date,
            quantity: newHolding.quantity,
            cost_basis: newHolding.cost_basis,
            fee: newHolding.fee || "0",
          },
        ],
      });
      setIsAddOpen(false);
      setNewHolding({
        symbol: "",
        name: "",
        trade_date: todayIso(),
        quantity: "",
        cost_basis: "",
        fee: "0",
      });
      setNotice(`Added position in ${(symbolLookup?.found && symbolLookup.listing) || newHolding.symbol.toUpperCase()}`);
      setSymbolLookup(null);
      await load();
      onDataModified();
    } catch (err: any) {
      setError(err?.message || "Could not save holding.");
    }
  };

  const handleSavePrices = async (e: React.FormEvent) => {
    e.preventDefault();
    const quotes: { symbol: string; as_of_date: string; price: string }[] = [];
    for (const rawLine of priceText.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 2) {
        setError(`Could not parse line: "${line}". Expected SYMBOL,PRICE.`);
        return;
      }
      quotes.push({
        symbol: parts[0].toUpperCase(),
        as_of_date: priceDate,
        price: parts[1],
      });
    }
    if (quotes.length === 0) {
      setError("Enter at least one price.");
      return;
    }
    try {
      const res = await api.upsertPrices(quotes);
      await api.revalueInvestments();
      setIsPriceOpen(false);
      setPriceText("");
      setNotice(`Updated ${res.length} holding prices.`);
      await load();
      onDataModified();
    } catch (err: any) {
      setError(err?.message || "Could not save prices.");
    }
  };

  const handleDelete = async (holding: HoldingValuation) => {
    try {
      await api.deleteHolding(holding.holding_id);
      await load();
      onDataModified();
    } catch (err: any) {
      setError(err?.message || "Could not remove the holding.");
    }
  };

  const tooltipBase = {
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: none;",
    textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: chartTheme.fontFamily },
  };

  const allocationOptions = useMemo(() => {
    const positive = sortedHoldings.filter((h) => h.market_value > 0);
    const total = positive.reduce((sum, h) => sum + h.market_value, 0);
    const large = positive.filter((h) => h.market_value / total >= SMALL_POSITION_SHARE);
    const small = positive.filter((h) => h.market_value / total < SMALL_POSITION_SHARE);
    const data = large.map((h) => ({ name: h.symbol, value: Number(h.market_value.toFixed(2)) }));
    // Grouping a single small position would only rename it.
    if (small.length > 1) {
      data.push({ name: "Other", value: Number(small.reduce((sum, h) => sum + h.market_value, 0).toFixed(2)) });
    } else {
      data.push(...small.map((h) => ({ name: h.symbol, value: Number(h.market_value.toFixed(2)) })));
    }
    return {
      backgroundColor: "transparent",
      // Share chart: positions need distinct series colours.
      color: chartTheme.palette,
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: any) =>
          `${p.name}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(p.value, { currency })} · ${p.percent}%</div>`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: chartTheme.tooltipBg, borderWidth: 2 },
          label: { color: chartTheme.textColor, fontSize: 11, fontFamily: chartTheme.figureFontFamily },
          data,
        },
      ],
    };
  }, [sortedHoldings, currency, chartTheme]);

  const assetClassOptions = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const h of performance?.holdings ?? []) {
      if (h.market_value <= 0) continue;
      const label = ASSET_CLASS_LABELS[h.asset_class] ?? h.asset_class;
      byClass.set(label, (byClass.get(label) ?? 0) + h.market_value);
    }
    const data = [...byClass.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }));
    return {
      backgroundColor: "transparent",
      color: chartTheme.palette,
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: any) =>
          `${p.name}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(p.value, { currency })} · ${p.percent}%</div>`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: chartTheme.tooltipBg, borderWidth: 2 },
          label: { color: chartTheme.textColor, fontSize: 11, fontFamily: chartTheme.fontFamily },
          data,
        },
      ],
    };
  }, [performance, currency, chartTheme]);

  const gainLossOptions = useMemo(() => {
    // Largest gain at the top: category axes draw bottom-up, so sort ascending.
    const rows = [...(performance?.holdings ?? [])].sort((a, b) => a.unrealized_gain - b.unrealized_gain);
    return {
      backgroundColor: "transparent",
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any[]) => {
          const h = rows[params[0]?.dataIndex ?? 0];
          if (!h) return "";
          return `${h.symbol}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(h.unrealized_gain, { currency, signed: true })} · ${percent(h.unrealized_gain_pct)}</div>`;
        },
      },
      grid: { left: 8, right: 24, bottom: 8, top: 8, containLabel: true },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: chartTheme.figureFontFamily,
          formatter: (v: number) => formatMoneyCompact(v, currency),
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((h) => h.symbol),
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.textColor, fontSize: 11, fontFamily: chartTheme.figureFontFamily },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 16,
          data: rows.map((h) => ({
            value: Number(h.unrealized_gain.toFixed(2)),
            itemStyle: {
              color: h.unrealized_gain >= 0 ? chartTheme.positiveColor : chartTheme.negativeColor,
              borderRadius: h.unrealized_gain >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
            },
          })),
        },
      ],
    };
  }, [performance, currency, chartTheme]);

  const returnsChartOptions = useMemo(() => {
    if (!performance) return null;
    const series = (
      [
        ["Time-weighted", "time_weighted", chartTheme.accentColor],
        ["Money-weighted", "money_weighted", chartTheme.neutralColor],
      ] as const
    ).map(([name, key, color]) => ({
      name,
      type: "bar",
      barMaxWidth: 18,
      itemStyle: { color },
      data: PERIOD_ORDER.map((p) => {
        const v = performance.returns[p]?.[key];
        return v === null || v === undefined
          ? null
          : { value: v, itemStyle: v < 0 ? { color: chartTheme.negativeColor } : undefined };
      }),
    }));
    if (series.every((s) => s.data.every((d) => d === null))) return null;
    return {
      backgroundColor: "transparent",
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: number | null) => (v === null || v === undefined ? "—" : percent(v)),
      },
      legend: {
        data: series.map((s) => s.name),
        textStyle: { color: chartTheme.textColor, fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        bottom: 0,
      },
      grid: { left: 8, right: 16, bottom: 32, top: 12, containLabel: true },
      xAxis: {
        type: "category",
        data: [...PERIOD_ORDER],
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11, fontFamily: chartTheme.figureFontFamily },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: chartTheme.figureFontFamily,
          formatter: (v: number) => `${v}%`,
        },
      },
      series,
    };
  }, [performance, chartTheme]);

  const growthOptions = useMemo(() => {
    if (!performance) return null;
    return {
      backgroundColor: "transparent",
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: number) => formatMoney(v, { currency }),
      },
      legend: {
        data: ["Money you added", "Market growth"],
        textStyle: { color: chartTheme.textColor, fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        bottom: 0,
      },
      grid: { left: 8, right: 16, bottom: 32, top: 16, containLabel: true },
      xAxis: {
        type: "category",
        data: ["Portfolio"],
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisTick: { show: false },
        axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11, fontFamily: chartTheme.figureFontFamily },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: chartTheme.figureFontFamily,
          formatter: (v: number) => formatMoneyCompact(v),
        },
      },
      series: [
        {
          name: "Money you added",
          type: "bar",
          stack: "total",
          barMaxWidth: 64,
          itemStyle: { color: chartTheme.neutralColor },
          data: [Number(performance.net_invested.toFixed(2))],
        },
        {
          name: "Market growth",
          type: "bar",
          stack: "total",
          barMaxWidth: 64,
          itemStyle: { color: performance.market_growth >= 0 ? chartTheme.accentColor : chartTheme.negativeColor },
          data: [Number(performance.market_growth.toFixed(2))],
        },
      ],
    };
  }, [performance, currency, chartTheme]);

  const card = "rounded-xl bg-surface border border-subtle";
  const btnPrimary =
    "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer";
  const btnSecondary =
    "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer";
  const inputCls =
    "w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";
  const labelCls = "block text-xs text-sub mb-1";

  if (investmentAccounts.length === 0) {
    return (
      <div className={`${card} max-w-3xl mx-auto p-6 py-12 text-center`}>
        <h2 className="text-base font-medium text-main">No investment accounts yet</h2>
        <p className="mt-1 text-sm text-sub max-w-md mx-auto">
          Create an account of type <span className="text-main font-medium">Investment</span>{" "}
          to track holdings, cost basis, and returns. Balances are derived from your positions.
        </p>
      </div>
    );
  }

  const fxAvailable = fxRate?.rate !== null && fxRate?.rate !== undefined;

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6">
      {error && (
        <div className="p-3 rounded-lg bg-negative-subtle border border-negative/30 text-sm text-negative flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-negative hover:underline underline-offset-4 font-medium">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-positive-subtle border border-positive/30 text-sm text-positive flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-positive hover:underline underline-offset-4 font-medium">
            Dismiss
          </button>
        </div>
      )}

      {/* Account selector and actions */}
      <div className={`${card} p-4 flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setProjectionOpened(false);
            }}
            className={`${inputCls} w-auto cursor-pointer`}
          >
            {investmentAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.institution ? `· ${a.institution}` : ""}
              </option>
            ))}
          </select>

          {/* Bank of Canada USD/CAD rate */}
          {fxAvailable && fxRate && (
            <div
              className="inline-flex items-center gap-2 text-sm text-sub"
              title={`Bank of Canada USD/CAD daily exchange rate${fxRate.as_of_date ? ` as of ${fxRate.as_of_date}` : ""}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-positive" />
              <span>USD/CAD</span>
              <span className="tabular-nums text-main">{fxRate.rate!.toFixed(4)}</span>
              <span className="text-xs text-muted hidden sm:inline">Bank of Canada</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted tabular-nums" aria-live="polite">
            {isFetchingQuotes
              ? "Refreshing quotes…"
              : quotesRefreshedAt
                ? `Quotes updated ${formatQuoteTime(quotesRefreshedAt, Intl.DateTimeFormat().resolvedOptions().timeZone, "")}`
                : null}
          </span>
          <button
            onClick={() => void refreshQuotes()}
            disabled={isFetchingQuotes}
            className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
            title="Fetch delayed quotes (Yahoo Finance, with TMX Money for TSX/TSX-V) and the Bank of Canada USD/CAD rate. Listings outside their trading hours are skipped once their close is recorded."
          >
            <RefreshCw
              className={`w-4 h-4 text-sub ${isFetchingQuotes ? "animate-spin" : ""}`}
              strokeWidth={1.5}
            />
            Refresh quotes
          </button>
          <button onClick={() => setIsPriceOpen(true)} className={btnSecondary}>
            Update prices
          </button>
          <button onClick={() => setIsAddOpen(true)} className={btnPrimary}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add holding
          </button>
        </div>
      </div>

      {performance && performance.unpriced_holdings.length > 0 && (
        <div className="p-3 rounded-lg bg-warning-subtle border border-warning/30 text-sm text-warning flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
          <span>
            No price recorded for{" "}
            <span className="font-medium font-mono">{performance.unpriced_holdings.join(", ")}</span>. Those
            positions are shown at cost, so market value and returns understate reality until you
            enter a price.
          </span>
        </div>
      )}

      {/* Ticker: refreshed with the quotes, never on a timer */}
      {performance && sortedHoldings.length > 0 && <QuoteTicker holdings={sortedHoldings} currency={currency} />}

      {/* KPI row */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Market value</div>
            <Money
              value={performance.market_value}
              currency={currency}
              className="block mt-2 font-display text-2xl font-medium leading-none text-main"
            />
            <div className="mt-2 text-xs text-muted">
              Cost <span className="tabular-nums">{formatMoney(performance.cost_basis, { currency })}</span>
            </div>
          </div>

          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Unrealized gain</div>
            <Money
              value={performance.unrealized_gain}
              currency={currency}
              signed
              className={`block mt-2 text-2xl font-medium leading-none ${
                performance.unrealized_gain >= 0 ? "text-positive" : "text-negative"
              }`}
            />
            <div className="mt-2 text-xs text-muted">Against cost basis</div>
          </div>

          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Money you added</div>
            <Money
              value={performance.net_invested}
              currency={currency}
              className="block mt-2 font-display text-2xl font-medium leading-none text-main"
            />
            <div className="mt-2 text-xs text-muted">Contributions less withdrawals</div>
          </div>

          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Market growth</div>
            <Money
              value={performance.market_growth}
              currency={currency}
              signed
              className={`block mt-2 text-2xl font-medium leading-none ${
                performance.market_growth >= 0 ? "text-positive" : "text-negative"
              }`}
            />
            <div className="mt-2 text-xs text-muted">Value beyond what you put in</div>
          </div>
        </div>
      )}

      {/* Holdings table */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center px-5 sm:px-6 h-14 border-b border-subtle">
          <h2 className="text-base font-medium text-main">Holdings</h2>
        </div>

        {/* Mobile & tablet cards (< lg) */}
        <div className="block lg:hidden divide-y divide-subtle">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted">Loading positions…</div>
          ) : (performance?.holdings.length ?? 0) === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No holdings yet. Add one to start tracking performance.
            </div>
          ) : (
            sortedHoldings.map((h) => (
              <div key={h.holding_id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-main font-mono truncate">{h.symbol}</div>
                    {h.name && <div className="text-xs text-muted truncate">{h.name}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <Money value={h.market_value} currency={currency} className="text-sm text-main" />
                      <div className="text-xs tabular-nums">
                        <Money
                          value={h.unrealized_gain}
                          currency={currency}
                          signed
                          className={h.unrealized_gain >= 0 ? "text-positive" : "text-negative"}
                        />{" "}
                        <span className="text-muted">({percent(h.unrealized_gain_pct)})</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(h)}
                      title={`Remove ${h.symbol}`}
                      className="p-1.5 rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
                  <span>{weight(h)} of portfolio</span>
                  <span>·</span>
                  <span>Qty {formatNumber(Number(h.quantity), 8)}</span>
                  <span>·</span>
                  <span>
                    {h.is_priced ? (
                      <>
                        Price <Money value={h.price ?? 0} currency={currency} className="text-sub" />
                        <QuoteBadge source={h.price_source} session={h.price_session} quotedAt={h.price_quoted_at} />
                      </>
                    ) : (
                      <span className="text-warning">No price</span>
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    Cost <Money value={h.cost_basis} currency={currency} className="text-sub" />
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop holdings table (>= lg) */}
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-xs text-muted border-b border-subtle">
                <th className="text-left font-normal h-9 px-3 w-[20%]">Symbol</th>
                <th className="text-right font-normal h-9 px-3 w-[12%]">Quantity</th>
                <th className="text-right font-normal h-9 px-3 w-[14%]">Price</th>
                <th className="text-right font-normal h-9 px-3 w-[13%]">Cost basis</th>
                <th className="text-right font-normal h-9 px-3 w-[14%]">Market value</th>
                <th className="text-right font-normal h-9 px-3 w-[9%]">Weight</th>
                <th className="text-right font-normal h-9 px-3 w-[13%]">Unrealized</th>
                <th className="h-9 px-2 w-11"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-muted">
                    Loading positions…
                  </td>
                </tr>
              )}

              {!isLoading && (performance?.holdings.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-muted">
                    No holdings yet. Add one to start tracking performance.
                  </td>
                </tr>
              )}

              {!isLoading &&
                sortedHoldings.map((h) => (
                  <tr key={h.holding_id} className="h-14 bg-surface-hover transition-colors">
                    <td className="px-3 min-w-0">
                      <div className="text-main font-mono truncate" title={h.symbol}>
                        {h.symbol}
                      </div>
                      {h.name && (
                        <div className="text-xs text-muted truncate" title={h.name}>
                          {h.name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 text-right text-sub tabular-nums whitespace-nowrap">
                      {formatNumber(Number(h.quantity), 8)}
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      {h.is_priced ? (
                        <>
                          <Money value={h.price ?? 0} currency={currency} className="text-main" />
                          <QuoteBadge source={h.price_source} session={h.price_session} quotedAt={h.price_quoted_at} />
                          <div className="text-xs tabular-nums text-muted">{priceDetail(h, currency)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-warning">No price</span>
                      )}
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Money value={h.cost_basis} currency={currency} className="text-sub" />
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Money value={h.market_value} currency={currency} className="text-main" />
                    </td>
                    <td className="px-3 text-right text-sub tabular-nums whitespace-nowrap">{weight(h)}</td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Money
                        value={h.unrealized_gain}
                        currency={currency}
                        signed
                        className={h.unrealized_gain >= 0 ? "text-positive" : "text-negative"}
                      />
                      <div className="text-xs tabular-nums text-muted">
                        {percent(h.unrealized_gain_pct)}
                      </div>
                    </td>
                    <td className="px-2 text-right">
                      <button
                        onClick={() => handleDelete(h)}
                        title={`Remove ${h.symbol}`}
                        className="p-1.5 rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Returns */}
      {performance && (
        <section className={`${card} p-5 sm:p-6`}>
          <h2 className="text-base font-medium text-main">Returns</h2>
          <p className="mt-1 text-sm text-sub">
            <span className="text-main">Time-weighted</span> measures investment performance, ignoring deposit timing.{" "}
            <span className="text-main">Money-weighted</span> measures what you earned including timing.
          </p>

          <div className="mt-4">
            <table className="w-full table-fixed text-xs sm:text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-subtle">
                  <th className="text-left font-normal h-9 pr-2 w-[32%] sm:w-auto">Measure</th>
                  {PERIOD_ORDER.map((p) => (
                    <th key={p} className="text-right font-normal h-9 px-1 sm:px-3">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Time-weighted", "time_weighted"],
                    ["Money-weighted", "money_weighted"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key} className="h-10 border-b border-subtle last:border-0">
                    <td className="pr-2 text-main truncate" title={label}>{label}</td>
                    {PERIOD_ORDER.map((p) => {
                      const value = performance.returns[p]?.[key] ?? null;
                      return (
                        <td
                          key={p}
                          className={`px-1 sm:px-3 text-right tabular-nums ${
                            value === null
                              ? "text-muted"
                              : value >= 0
                                ? "text-positive"
                                : "text-negative"
                          }`}
                        >
                          {percent(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted">
            A dash means there is not enough data for that period
          </p>
          {returnsChartOptions && (
            <>
              <h3 className="mt-6 text-sm font-medium text-main">Returns by period</h3>
              <LazyChart option={returnsChartOptions} className="h-56 mt-2" />
            </>
          )}
        </section>
      )}

      {/* Allocation */}
      {performance && performance.holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Allocation by position</h2>
            <p className="mt-1 text-sm text-sub">Share of market value. Positions under 3% are grouped</p>
            <LazyChart option={allocationOptions} className="h-64 mt-4" />
          </section>

          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Allocation by asset class</h2>
            <p className="mt-1 text-sm text-sub">Equity, bonds, cash and the rest</p>
            <LazyChart option={assetClassOptions} className="h-64 mt-4" />
          </section>

          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Gain and loss by position</h2>
            <p className="mt-1 text-sm text-sub">Unrealized, against what each position cost</p>
            <LazyChart
              option={gainLossOptions}
              className="mt-4"
              style={{ height: Math.max(160, performance.holdings.length * 28 + 32) }}
            />
          </section>

          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Contributions vs growth</h2>
            <p className="mt-1 text-sm text-sub">
              How much of the balance you saved, and how much the market added
            </p>
            {growthOptions && <LazyChart option={growthOptions} className="h-64 mt-4" />}
          </section>
        </div>
      )}

      {/* Projection: opt-in, fetched only once opened */}
      {performance && performance.holdings.length > 0 && (
        <details
          className={`${card} group`}
          onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setProjectionOpened(true)}
        >
          <summary className="flex items-center justify-between gap-3 px-5 sm:px-6 h-14 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="text-base font-medium text-main">Projection</span>
            <span className="flex items-center gap-2 text-sm text-sub">
              <span className="hidden sm:inline">Where this account could be, from its own past returns</span>
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" strokeWidth={1.5} />
            </span>
          </summary>
          <div className="px-5 sm:px-6 pb-6 pt-2 border-t border-subtle">
            {projectionOpened && (
              <ProjectionPanel accountId={accountId} currency={currency} marketValue={performance.market_value} />
            )}
          </div>
        </details>
      )}

      {/* Canadian market coverage and BoC FX context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <abbr className="quote-badge no-underline" title="Delayed quote">D</abbr> Delayed about 15 minutes, from Yahoo
            Finance with TMX Money as the backup for TSX &amp; TSX-V
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <abbr className="quote-badge no-underline" data-session="PRE" title="Pre-market or after-hours quote">
              Pre
            </abbr>{" "}
            /{" "}
            <abbr className="quote-badge no-underline" data-session="POST" title="After-hours quote">
              Post
            </abbr>{" "}
            US extended hours
          </span>
          <span aria-hidden="true">·</span>
          <span>Not refreshed outside trading hours once the close is in</span>
          <span aria-hidden="true">·</span>
          <span>Bank of Canada FX daily</span>
        </div>
        {fxAvailable && fxRate && (
          <div className="flex items-center gap-2 shrink-0">
            <span>BoC Valet daily</span>
            <span className="tabular-nums text-main">{fxRate.rate!.toFixed(4)}</span>
            {fxRate.as_of_date && <span className="tabular-nums">{fxRate.as_of_date}</span>}
          </div>
        )}
      </div>

      {/* Add holding modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
          <form
            onSubmit={handleAddHolding}
            className="w-full max-w-md rounded-xl bg-surface border border-default p-5 flex flex-col gap-4 shadow-xl animate-in zoom-in-95"
          >
            <h3 className="text-base font-medium text-main">Add holding</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Symbol</label>
                <input
                  required
                  value={newHolding.symbol}
                  onChange={(e) => setNewHolding({ ...newHolding, symbol: e.target.value })}
                  placeholder="VFV or VFV.TO"
                  aria-describedby="symbol-lookup"
                  className={`${inputCls} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelCls}>Name (optional)</label>
                <input
                  value={newHolding.name}
                  onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })}
                  placeholder="Vanguard S&P 500"
                  className={inputCls}
                />
              </div>
            </div>

            {newHolding.symbol.trim() && (
              <div id="symbol-lookup" aria-live="polite" className="-mt-2 text-xs">
                {isLookingUp && !symbolLookup ? (
                  <span className="text-muted">Looking up {newHolding.symbol.trim().toUpperCase()}…</span>
                ) : symbolLookup?.found ? (
                  <span className="text-sub">
                    <span className="font-mono text-main">{symbolLookup.query}</span>
                    {symbolLookup.listing !== symbolLookup.query && (
                      <>
                        {" → "}
                        <span className="font-mono text-main">{symbolLookup.listing}</span>
                      </>
                    )}
                    {symbolLookup.name ? ` · ${symbolLookup.name}` : ""}
                    {symbolLookup.exchange ? ` · ${symbolLookup.exchange}` : ""}
                    {symbolLookup.price != null && (
                      <>
                        {" · "}
                        <span className="tabular-nums text-main">
                          {formatMoney(symbolLookup.price, { currency: symbolLookup.currency || currency })}
                        </span>
                        <QuoteBadge source={symbolLookup.source} session={symbolLookup.session} />
                      </>
                    )}
                  </span>
                ) : symbolLookup ? (
                  <span className="text-warning">
                    No listing found for {symbolLookup.query}. You can still save it and enter prices by hand.
                  </span>
                ) : null}
              </div>
            )}

            <div>
              <label className={labelCls}>Purchase date</label>
              <input
                type="date"
                required
                value={newHolding.trade_date}
                onChange={(e) => setNewHolding({ ...newHolding, trade_date: e.target.value })}
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Quantity</label>
                <input
                  required
                  value={newHolding.quantity}
                  onChange={(e) => setNewHolding({ ...newHolding, quantity: e.target.value })}
                  placeholder="100"
                  className={`${inputCls} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelCls}>Total cost</label>
                <input
                  required
                  value={newHolding.cost_basis}
                  onChange={(e) => setNewHolding({ ...newHolding, cost_basis: e.target.value })}
                  placeholder="10000.00"
                  className={`${inputCls} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelCls}>Commission</label>
                <input
                  value={newHolding.fee}
                  onChange={(e) => setNewHolding({ ...newHolding, fee: e.target.value })}
                  className={`${inputCls} tabular-nums`}
                />
              </div>
            </div>
            <p className="text-xs text-muted">
              For Canadian securities, add <span className="font-mono text-sub">.TO</span> for TSX (e.g.{" "}
              <span className="font-mono text-sub">XEQT.TO</span>, <span className="font-mono text-sub">VFV.TO</span>) or{" "}
              <span className="font-mono text-sub">.V</span> for TSX Venture. US equities use standard tickers (e.g.{" "}
              <span className="font-mono text-sub">AAPL</span>). Total cost is for the entire position, not per share.
            </p>

            <div className="flex justify-end gap-2 pt-4 border-t border-subtle">
              <button type="button" onClick={() => setIsAddOpen(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary}>
                Add holding
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Price entry modal */}
      {isPriceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
          <form
            onSubmit={handleSavePrices}
            className="w-full max-w-md rounded-xl bg-surface border border-default p-5 flex flex-col gap-4 shadow-xl animate-in zoom-in-95"
          >
            <div>
              <h3 className="text-base font-medium text-main">Update prices</h3>
              <p className="mt-1 text-xs text-muted">
                Manual quote overrides. Folio also fetches automated quotes for TSX/TSX-V (
                <span className="font-mono text-sub">.TO</span>, <span className="font-mono text-sub">.V</span>), US
                equities, and Bank of Canada exchange rates. Paste one{" "}
                <span className="font-mono text-sub">SYMBOL,PRICE</span> per line.
              </p>
            </div>

            <div>
              <label className={labelCls}>Prices as of</label>
              <input
                type="date"
                required
                value={priceDate}
                onChange={(e) => setPriceDate(e.target.value)}
                className={`${inputCls} tabular-nums`}
              />
            </div>

            <div>
              <label className={labelCls}>Quotes</label>
              <textarea
                required
                rows={7}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder={"VFV.TO,145.20\nXEQT.TO,33.85\nZAG.TO,14.02"}
                className="w-full px-3 py-2 rounded-lg border border-default bg-input text-sm text-main font-mono placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-subtle">
              <button type="button" onClick={() => setIsPriceOpen(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary}>
                Save &amp; revalue
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
