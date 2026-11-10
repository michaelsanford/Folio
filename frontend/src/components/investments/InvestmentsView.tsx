import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { isInvestmentAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import type { Account, HoldingValuation, PerformanceResponse } from "../../types";
import { api } from "../../services/api";

interface InvestmentsViewProps {
  accounts: Account[];
  onDataModified: () => void;
}

const PERIOD_ORDER = ["1M", "3M", "YTD", "1Y", "ALL"] as const;

const percent = (value: number | null) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const todayIso = () => new Date().toISOString().split("T")[0];

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

  const handleFetchAutomatedQuotes = async () => {
    setIsFetchingQuotes(true);
    setError(null);
    try {
      const res = await api.fetchAutomatedQuotes();
      const count = res.quotes_fetched ?? res.updated_count ?? 0;
      const rateVal = res.usdcad_fx_rate;
      if (rateVal !== null && rateVal !== undefined) {
        setFxRate({
          pair: "USDCAD",
          rate: rateVal,
          source: "Bank of Canada",
          as_of_date: todayIso(),
        });
      }

      let noticeText = `Automated quotes updated (${count} symbol${count === 1 ? "" : "s"}).`;
      if (rateVal !== null && rateVal !== undefined) {
        noticeText += ` Bank of Canada USD/CAD: ${rateVal.toFixed(4)}`;
      }
      if (res.failed_count > 0 && res.failed_symbols?.length) {
        noticeText += ` (${res.failed_symbols.join(", ")} could not be quoted)`;
      }
      setNotice(noticeText);

      await load();
      onDataModified();
    } catch (err: any) {
      setError(err?.message || "Could not fetch automated quotes.");
    } finally {
      setIsFetchingQuotes(false);
    }
  };

  const currency = investmentAccounts.find((a) => a.id === accountId)?.currency || "CAD";

  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createHolding({
        account_id: accountId,
        symbol: newHolding.symbol,
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
      setNotice(`Added position in ${newHolding.symbol.toUpperCase()}`);
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

  const mono = "IBM Plex Mono, ui-monospace, monospace";
  const tooltipBase = {
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: none;",
    textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
  };

  const allocationOptions = useMemo(() => {
    const data = (performance?.holdings || [])
      .filter((h) => h.market_value > 0)
      .map((h) => ({ name: h.symbol, value: Number(h.market_value.toFixed(2)) }));
    return {
      backgroundColor: "transparent",
      // Share chart: positions need distinct series colours.
      color: chartTheme.palette,
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: any) =>
          `${p.name}<div style="margin-top:4px;font-family:${mono}">${formatMoney(p.value, { currency })} · ${p.percent}%</div>`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: chartTheme.tooltipBg, borderWidth: 2 },
          label: { color: chartTheme.textColor, fontSize: 11, fontFamily: mono },
          data,
        },
      ],
    };
  }, [performance, currency, chartTheme]);

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
        axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11, fontFamily: mono },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: mono,
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
            onChange={(e) => setAccountId(e.target.value)}
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
              <span className="font-mono text-main">{fxRate.rate!.toFixed(4)}</span>
              <span className="text-xs text-muted hidden sm:inline">Bank of Canada</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleFetchAutomatedQuotes}
            disabled={isFetchingQuotes}
            className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
            title="Automatically fetch latest quotes for TSX/TSX-V (.TO, .V), US equities, and Bank of Canada exchange rate"
          >
            <RefreshCw
              className={`w-4 h-4 text-sub ${isFetchingQuotes ? "animate-spin" : ""}`}
              strokeWidth={1.5}
            />
            {isFetchingQuotes ? "Updating quotes…" : "Update quotes (TSX / BoC)"}
          </button>
          <button onClick={() => setIsPriceOpen(true)} className={btnSecondary}>
            Update prices
          </button>
          <button onClick={() => setIsAddOpen(true)} className={btnPrimary}>
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add holding
          </button>
        </div>
      </div>

      {/* Canadian market coverage and BoC FX context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sub">Market coverage:</span>
          <span>
            TSX &amp; TSX-V (<code className="font-mono text-sub">.TO</code>,{" "}
            <code className="font-mono text-sub">.V</code>)
          </span>
          <span aria-hidden="true">·</span>
          <span>US equities &amp; ETFs (USD)</span>
          <span aria-hidden="true">·</span>
          <span>Bank of Canada Valet FX daily</span>
        </div>
        {fxAvailable && fxRate && (
          <div className="flex items-center gap-2 shrink-0">
            <span>BoC Valet daily</span>
            <span className="font-mono text-main">{fxRate.rate!.toFixed(4)}</span>
            {fxRate.as_of_date && <span className="font-mono">{fxRate.as_of_date}</span>}
          </div>
        )}
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

      {/* KPI row */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Market value</div>
            <Money
              value={performance.market_value}
              currency={currency}
              className="block mt-2 text-2xl font-medium leading-none text-main"
            />
            <div className="mt-2 text-xs text-muted">
              Cost <span className="font-mono">{formatMoney(performance.cost_basis, { currency })}</span>
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
              className="block mt-2 text-2xl font-medium leading-none text-main"
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

      {/* Returns */}
      {performance && (
        <section className={`${card} p-5 sm:p-6`}>
          <h2 className="text-base font-medium text-main">Returns</h2>
          <p className="mt-1 text-sm text-sub">
            <span className="text-main">Time-weighted</span> measures investment performance, ignoring deposit timing.{" "}
            <span className="text-main">Money-weighted</span> measures what you earned including timing.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="text-xs text-muted border-b border-subtle">
                  <th className="text-left font-normal h-9 pr-4">Measure</th>
                  {PERIOD_ORDER.map((p) => (
                    <th key={p} className="text-right font-normal h-9 px-3">
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
                    <td className="pr-4 text-main">{label}</td>
                    {PERIOD_ORDER.map((p) => {
                      const value = performance.returns[p]?.[key] ?? null;
                      return (
                        <td
                          key={p}
                          className={`px-3 text-right font-mono tabular-nums ${
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
        </section>
      )}

      {/* Charts */}
      {performance && performance.holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Allocation</h2>
            <p className="mt-1 text-sm text-sub">Share of market value by position</p>
            <LazyChart option={allocationOptions} className="h-64 mt-4" />
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

      {/* Holdings table */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center px-5 sm:px-6 h-14 border-b border-subtle">
          <h2 className="text-base font-medium text-main">Holdings</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-xs text-muted border-b border-subtle">
                <th className="text-left font-normal h-9 px-5 sm:px-6">Symbol</th>
                <th className="text-right font-normal h-9 px-3">Quantity</th>
                <th className="text-right font-normal h-9 px-3">Price</th>
                <th className="text-right font-normal h-9 px-3">Cost basis</th>
                <th className="text-right font-normal h-9 px-3">Market value</th>
                <th className="text-right font-normal h-9 px-3">Unrealized</th>
                <th className="h-9 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-muted">
                    Loading positions…
                  </td>
                </tr>
              )}

              {!isLoading && (performance?.holdings.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-muted">
                    No holdings yet. Add one to start tracking performance.
                  </td>
                </tr>
              )}

              {!isLoading &&
                performance?.holdings.map((h) => (
                  <tr key={h.holding_id} className="h-14 bg-surface-hover transition-colors">
                    <td className="px-5 sm:px-6">
                      <div className="text-main font-mono">{h.symbol}</div>
                      {h.name && <div className="text-xs text-muted">{h.name}</div>}
                    </td>
                    <td className="px-3 text-right text-sub font-mono tabular-nums">
                      {Number(h.quantity).toLocaleString("en-CA", { maximumFractionDigits: 8 })}
                    </td>
                    <td className="px-3 text-right">
                      {h.is_priced ? (
                        <>
                          <Money value={h.price ?? 0} currency={currency} className="text-main" />
                          <div className="text-[11px] font-mono text-muted">as of {h.price_as_of}</div>
                        </>
                      ) : (
                        <span className="text-xs text-warning">No price</span>
                      )}
                    </td>
                    <td className="px-3 text-right">
                      <Money value={h.cost_basis} currency={currency} className="text-sub" />
                    </td>
                    <td className="px-3 text-right">
                      <Money value={h.market_value} currency={currency} className="text-main" />
                    </td>
                    <td className="px-3 text-right">
                      <Money
                        value={h.unrealized_gain}
                        currency={currency}
                        signed
                        className={h.unrealized_gain >= 0 ? "text-positive" : "text-negative"}
                      />
                      <div className="text-[11px] font-mono text-muted">
                        {percent(h.unrealized_gain_pct)}
                      </div>
                    </td>
                    <td className="px-3 text-right">
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

      {/* Add holding modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
          <form
            onSubmit={handleAddHolding}
            className="w-full max-w-md rounded-xl bg-surface border border-default p-5 flex flex-col gap-4 shadow-xl"
          >
            <h3 className="text-base font-medium text-main">Add holding</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Symbol</label>
                <input
                  required
                  value={newHolding.symbol}
                  onChange={(e) => setNewHolding({ ...newHolding, symbol: e.target.value })}
                  placeholder="VFV.TO"
                  className={`${inputCls} font-mono`}
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
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className={labelCls}>Total cost</label>
                <input
                  required
                  value={newHolding.cost_basis}
                  onChange={(e) => setNewHolding({ ...newHolding, cost_basis: e.target.value })}
                  placeholder="10000.00"
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className={labelCls}>Commission</label>
                <input
                  value={newHolding.fee}
                  onChange={(e) => setNewHolding({ ...newHolding, fee: e.target.value })}
                  className={`${inputCls} font-mono`}
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
            className="w-full max-w-md rounded-xl bg-surface border border-default p-5 flex flex-col gap-4 shadow-xl"
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
                className={`${inputCls} font-mono`}
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
