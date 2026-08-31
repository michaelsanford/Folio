import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Plus,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Trash2,
} from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { isInvestmentAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import type { Account, HoldingValuation, PerformanceResponse } from "../../types";
import { api } from "../../services/api";

interface InvestmentsViewProps {
  accounts: Account[];
  onDataModified: () => void;
}

const PERIOD_ORDER = ["1M", "3M", "YTD", "1Y", "ALL"] as const;

const money = (value: number, currency = "CAD") =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

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

  useEffect(() => {
    if (accountId) load(accountId);
  }, [accountId]);

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

  const allocationOptions = useMemo(() => {
    const data = (performance?.holdings || [])
      .filter((h) => h.market_value > 0)
      .map((h) => ({ name: h.symbol, value: Number(h.market_value.toFixed(2)) }));
    return {
      backgroundColor: "transparent",
      color: chartTheme.palette,
      tooltip: {
        trigger: "item",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        formatter: (p: any) => `${p.name}: <b>${money(p.value, currency)}</b> (${p.percent}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: chartTheme.tooltipBg, borderWidth: 2 },
          label: { color: chartTheme.textColor, fontSize: 11 },
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
        trigger: "axis",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        valueFormatter: (v: number) => money(v, currency),
      },
      legend: {
        data: ["Money you added", "Market growth"],
        textStyle: { color: chartTheme.textColor, fontSize: 11 },
        bottom: 0,
      },
      grid: { left: "2%", right: "3%", bottom: "16%", top: "8%", containLabel: true },
      xAxis: {
        type: "category",
        data: ["Portfolio"],
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          formatter: (v: number) => `$${Math.round(v / 1000)}k`,
        },
      },
      series: [
        {
          name: "Money you added",
          type: "bar",
          stack: "total",
          itemStyle: { color: chartTheme.accentColor },
          data: [Number(performance.net_invested.toFixed(2))],
        },
        {
          name: "Market growth",
          type: "bar",
          stack: "total",
          itemStyle: { color: performance.market_growth >= 0 ? chartTheme.positiveColor : chartTheme.negativeColor },
          data: [Number(performance.market_growth.toFixed(2))],
        },
      ],
    };
  }, [performance, currency, chartTheme]);

  if (investmentAccounts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-8 rounded-2xl bg-surface border border-default text-center shadow-xs">
        <div className="inline-flex p-3 rounded-2xl bg-accent-subtle text-accent-subtle mb-3">
          <TrendingUp className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-main">No investment accounts yet</h2>
        <p className="text-xs text-muted mt-1.5 max-w-md mx-auto">
          Create an account of type <span className="text-main font-semibold">Investment</span>{" "}
          to track holdings, cost basis, and returns. Balances are derived from your positions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {error && (
        <div className="p-3 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-negative hover:underline font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-positive-subtle border border-emerald-500/30 text-xs text-positive flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-positive hover:underline font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Account selector and actions */}
      <div className="p-4 rounded-2xl bg-surface border border-default shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="px-3 py-2 bg-input border border-default rounded-xl text-xs font-medium text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
        >
          {investmentAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.institution ? `· ${a.institution}` : ""}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsPriceOpen(true)}
            className="px-3 py-2 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-default text-sub text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Update prices
          </button>
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-3 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add holding
          </button>
        </div>
      </div>

      {performance && performance.unpriced_holdings.length > 0 && (
        <div className="p-3 rounded-xl bg-accent-subtle border border-accent-main/30 text-xs text-accent-subtle flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            No price recorded for{" "}
            <span className="font-semibold font-mono">{performance.unpriced_holdings.join(", ")}</span>. Those
            positions are shown at cost, so market value and returns understate reality until you
            enter a price.
          </span>
        </div>
      )}

      {/* KPI row */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Market Value
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-main">
              {money(performance.market_value, currency)}
            </div>
            <div className="mt-1.5 text-xs text-muted font-mono">
              Cost {money(performance.cost_basis, currency)}
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Unrealized Gain
            </div>
            <div
              className={`mt-2 text-xl sm:text-2xl font-bold font-mono ${
                performance.unrealized_gain >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {money(performance.unrealized_gain, currency)}
            </div>
            <div className="mt-1.5 text-xs text-muted flex items-center gap-1">
              {performance.unrealized_gain >= 0 ? (
                <TrendingUp className="w-3 h-3 text-positive" />
              ) : (
                <TrendingDown className="w-3 h-3 text-negative" />
              )}
              against cost basis
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Money You Added
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-accent-main">
              {money(performance.net_invested, currency)}
            </div>
            <div className="mt-1.5 text-xs text-muted">
              Contributions less withdrawals
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Market Growth
            </div>
            <div
              className={`mt-2 text-xl sm:text-2xl font-bold font-mono ${
                performance.market_growth >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {money(performance.market_growth, currency)}
            </div>
            <div className="mt-1.5 text-xs text-muted">Value beyond what you put in</div>
          </div>
        </div>
      )}

      {/* Returns */}
      {performance && (
        <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
          <h2 className="text-sm sm:text-base font-bold text-main">Returns</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            <span className="text-main font-medium">Time-weighted</span> measures investment performance, ignoring deposit timing.{" "}
            <span className="text-main font-medium">Money-weighted</span> measures what you earned including timing.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[440px]">
              <thead>
                <tr className="text-muted border-b border-subtle">
                  <th className="text-left font-semibold py-2 pr-4">Measure</th>
                  {PERIOD_ORDER.map((p) => (
                    <th key={p} className="text-right font-semibold py-2 px-3">
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
                  <tr key={key} className="border-b border-subtle last:border-0">
                    <td className="py-2.5 pr-4 text-main font-medium">{label}</td>
                    {PERIOD_ORDER.map((p) => {
                      const value = performance.returns[p]?.[key] ?? null;
                      return (
                        <td
                          key={p}
                          className={`py-2.5 px-3 text-right font-semibold font-mono tabular-nums ${
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
          <p className="text-[11px] text-muted mt-3">
            A dash means there is not enough data for that period.
          </p>
        </div>
      )}

      {/* Charts */}
      {performance && performance.holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
            <h2 className="text-sm sm:text-base font-bold text-main mb-1">Allocation</h2>
            <p className="text-xs text-muted mb-3">Share of market value by position</p>
            <LazyChart option={allocationOptions} className="h-64" />
          </div>

          <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
            <h2 className="text-sm sm:text-base font-bold text-main mb-1">
              Contributions vs Growth
            </h2>
            <p className="text-xs text-muted mb-3">
              How much of the balance you saved, and how much the market added
            </p>
            {growthOptions && <LazyChart option={growthOptions} className="h-64" />}
          </div>
        </div>
      )}

      {/* Holdings table */}
      <div className="rounded-2xl bg-surface border border-default shadow-xs overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-subtle bg-surface-subtle">
          <h2 className="text-sm sm:text-base font-bold text-main">Holdings</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-muted border-b border-subtle bg-surface-subtle/50">
                <th className="text-left font-semibold py-2.5 px-4">Symbol</th>
                <th className="text-right font-semibold py-2.5 px-3">Quantity</th>
                <th className="text-right font-semibold py-2.5 px-3">Price</th>
                <th className="text-right font-semibold py-2.5 px-3">Cost Basis</th>
                <th className="text-right font-semibold py-2.5 px-3">Market Value</th>
                <th className="text-right font-semibold py-2.5 px-3">Unrealized</th>
                <th className="py-2.5 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle font-medium">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    Loading positions…
                  </td>
                </tr>
              )}

              {!isLoading && (performance?.holdings.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No holdings yet. Add one to start tracking performance.
                  </td>
                </tr>
              )}

              {!isLoading &&
                performance?.holdings.map((h) => (
                  <tr key={h.holding_id} className="hover:bg-surface-hover transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-main">{h.symbol}</div>
                      {h.name && <div className="text-[10px] text-muted">{h.name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right text-sub font-mono tabular-nums">
                      {Number(h.quantity).toLocaleString("en-CA", { maximumFractionDigits: 8 })}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-mono">
                      {h.is_priced ? (
                        <>
                          <div className="text-main">{money(h.price ?? 0, currency)}</div>
                          <div className="text-[10px] text-muted">as of {h.price_as_of}</div>
                        </>
                      ) : (
                        <span className="text-accent-main font-semibold">no price</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-sub font-mono tabular-nums">
                      {money(h.cost_basis, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-main font-semibold font-mono tabular-nums">
                      {money(h.market_value, currency)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold font-mono tabular-nums ${
                        h.unrealized_gain >= 0 ? "text-positive" : "text-negative"
                      }`}
                    >
                      {money(h.unrealized_gain, currency)}
                      <div className="text-[10px] font-normal opacity-80">
                        {percent(h.unrealized_gain_pct)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleDelete(h)}
                        title={`Remove ${h.symbol}`}
                        className="p-1.5 rounded-lg text-muted hover:text-negative hover:bg-negative-subtle cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add holding modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <form
            onSubmit={handleAddHolding}
            className="w-full max-w-md rounded-2xl bg-surface border border-default p-5 space-y-3 text-xs shadow-2xl"
          >
            <h3 className="text-base font-bold text-main">Add Holding</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-muted mb-1 font-medium">Symbol</label>
                <input
                  required
                  value={newHolding.symbol}
                  onChange={(e) => setNewHolding({ ...newHolding, symbol: e.target.value })}
                  placeholder="VFV.TO"
                  className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main"
                />
              </div>
              <div>
                <label className="block text-muted mb-1 font-medium">Name (optional)</label>
                <input
                  value={newHolding.name}
                  onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })}
                  placeholder="Vanguard S&amp;P 500"
                  className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main"
                />
              </div>
            </div>

            <div>
              <label className="block text-muted mb-1 font-medium">Purchase date</label>
              <input
                type="date"
                required
                value={newHolding.trade_date}
                onChange={(e) => setNewHolding({ ...newHolding, trade_date: e.target.value })}
                className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-muted mb-1 font-medium">Quantity</label>
                <input
                  required
                  value={newHolding.quantity}
                  onChange={(e) => setNewHolding({ ...newHolding, quantity: e.target.value })}
                  placeholder="100"
                  className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main font-mono"
                />
              </div>
              <div>
                <label className="block text-muted mb-1 font-medium">Total cost</label>
                <input
                  required
                  value={newHolding.cost_basis}
                  onChange={(e) => setNewHolding({ ...newHolding, cost_basis: e.target.value })}
                  placeholder="10000.00"
                  className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main font-mono"
                />
              </div>
              <div>
                <label className="block text-muted mb-1 font-medium">Commission</label>
                <input
                  value={newHolding.fee}
                  onChange={(e) => setNewHolding({ ...newHolding, fee: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted">
              Total cost is what the whole tranche cost, not the per-share price.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 rounded-lg border border-default text-sub hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast font-semibold shadow-xs cursor-pointer"
              >
                Add Holding
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Price entry modal */}
      {isPriceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <form
            onSubmit={handleSavePrices}
            className="w-full max-w-md rounded-2xl bg-surface border border-default p-5 space-y-3 text-xs shadow-2xl"
          >
            <h3 className="text-base font-bold text-main">Update Prices</h3>
            <p className="text-[11px] text-muted">
              Prices are entered by hand — Folio makes no outbound network calls. Paste one{" "}
              <span className="text-main font-mono">SYMBOL,PRICE</span> per line.
            </p>

            <div>
              <label className="block text-muted mb-1 font-medium">Prices as of</label>
              <input
                type="date"
                required
                value={priceDate}
                onChange={(e) => setPriceDate(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main font-mono"
              />
            </div>

            <div>
              <label className="block text-muted mb-1 font-medium">Quotes</label>
              <textarea
                required
                rows={7}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder={"VFV.TO,145.20\nXEQT.TO,33.85\nZAG.TO,14.02"}
                className="w-full px-3 py-2 bg-input border border-default rounded-lg text-main font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsPriceOpen(false)}
                className="px-4 py-2 rounded-lg border border-default text-sub hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast font-semibold shadow-xs cursor-pointer"
              >
                Save &amp; Revalue
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
