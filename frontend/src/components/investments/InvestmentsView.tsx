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
  const investmentAccounts = useMemo(
    () => accounts.filter((a) => a.type === "INVESTMENT"),
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
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not add the holding.");
    }
  };

  /** Accepts "SYMBOL,PRICE" or "SYMBOL PRICE" per line -- one paste from a broker page. */
  const handleSavePrices = async (e: React.FormEvent) => {
    e.preventDefault();
    const quotes = priceText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [symbol, price] = line.split(/[,\s]+/);
        return { symbol, as_of_date: priceDate, price };
      })
      .filter((q) => q.symbol && q.price && !Number.isNaN(Number(q.price)));

    if (quotes.length === 0) {
      setError("No usable rows. Use one SYMBOL,PRICE per line.");
      return;
    }

    try {
      await api.upsertPrices(quotes);
      const result = await api.revalueInvestments();
      setIsPriceOpen(false);
      setPriceText("");
      setNotice(
        `Saved ${quotes.length} price${quotes.length === 1 ? "" : "s"} and revalued ${result.accounts_revalued} account${result.accounts_revalued === 1 ? "" : "s"}.`
      );
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
      tooltip: {
        trigger: "item",
        backgroundColor: "#0f172a",
        borderColor: "#334155",
        textStyle: { color: "#f8fafc", fontSize: 12 },
        formatter: (p: any) => `${p.name}: <b>${money(p.value, currency)}</b> (${p.percent}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#0f172a", borderWidth: 2 },
          label: { color: "#94a3b8", fontSize: 11 },
          data,
        },
      ],
    };
  }, [performance, currency]);

  const growthOptions = useMemo(() => {
    if (!performance) return null;
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "#0f172a",
        borderColor: "#334155",
        textStyle: { color: "#f8fafc", fontSize: 12 },
        valueFormatter: (v: number) => money(v, currency),
      },
      legend: {
        data: ["Money you added", "Market growth"],
        textStyle: { color: "#94a3b8", fontSize: 11 },
        bottom: 0,
      },
      grid: { left: "2%", right: "3%", bottom: "16%", top: "8%", containLabel: true },
      xAxis: {
        type: "category",
        data: ["Portfolio"],
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#64748b", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "#334155", opacity: 0.3 } },
        axisLabel: {
          color: "#64748b",
          fontSize: 11,
          formatter: (v: number) => `$${Math.round(v / 1000)}k`,
        },
      },
      series: [
        {
          name: "Money you added",
          type: "bar",
          stack: "total",
          itemStyle: { color: "#6366f1" },
          data: [Number(performance.net_invested.toFixed(2))],
        },
        {
          name: "Market growth",
          type: "bar",
          stack: "total",
          itemStyle: { color: performance.market_growth >= 0 ? "#10b981" : "#f43f5e" },
          data: [Number(performance.market_growth.toFixed(2))],
        },
      ],
    };
  }, [performance, currency]);

  if (investmentAccounts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-center">
        <div className="inline-flex p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-3">
          <TrendingUp className="w-6 h-6" />
        </div>
        <h2 className="text-base font-semibold text-slate-100">No investment accounts yet</h2>
        <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
          Create an account of type <span className="text-slate-200 font-medium">Investment</span>{" "}
          to track holdings, cost basis, and returns. Balances are then derived from your positions
          rather than typed in by hand.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {error && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-200 hover:text-white font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-200 hover:text-white font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Account selector and actions */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="px-3 py-2 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs font-medium text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
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
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Update prices
          </button>
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add holding
          </button>
        </div>
      </div>

      {performance && performance.unpriced_holdings.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            No price recorded for{" "}
            <span className="font-semibold">{performance.unpriced_holdings.join(", ")}</span>. Those
            positions are shown at cost, so market value and returns understate reality until you
            enter a price.
          </span>
        </div>
      )}

      {/* KPI row */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Market Value
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-100">
              {money(performance.market_value, currency)}
            </div>
            <div className="mt-1.5 text-xs text-slate-400">
              Cost {money(performance.cost_basis, currency)}
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Unrealized Gain
            </div>
            <div
              className={`mt-2 text-xl sm:text-2xl font-bold ${
                performance.unrealized_gain >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {money(performance.unrealized_gain, currency)}
            </div>
            <div className="mt-1.5 text-xs text-slate-400 flex items-center gap-1">
              {performance.unrealized_gain >= 0 ? (
                <TrendingUp className="w-3 h-3 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3 h-3 text-rose-400" />
              )}
              against cost basis
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Money You Added
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-indigo-300">
              {money(performance.net_invested, currency)}
            </div>
            <div className="mt-1.5 text-xs text-slate-400">
              Contributions less withdrawals
            </div>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Market Growth
            </div>
            <div
              className={`mt-2 text-xl sm:text-2xl font-bold ${
                performance.market_growth >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {money(performance.market_growth, currency)}
            </div>
            <div className="mt-1.5 text-xs text-slate-400">Value beyond what you put in</div>
          </div>
        </div>
      )}

      {/* Returns */}
      {performance && (
        <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
          <h2 className="text-sm sm:text-base font-semibold text-slate-200">Returns</h2>
          <p className="text-xs text-slate-400 mt-0.5 mb-4">
            <span className="text-slate-300 font-medium">Time-weighted</span> measures how the
            investments performed, ignoring when you deposited.{" "}
            <span className="text-slate-300 font-medium">Money-weighted</span> measures what you
            actually earned, including your timing.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[440px]">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="text-left font-medium py-2 pr-4">Measure</th>
                  {PERIOD_ORDER.map((p) => (
                    <th key={p} className="text-right font-medium py-2 px-3">
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
                  <tr key={key} className="border-b border-slate-800/60 last:border-0">
                    <td className="py-2.5 pr-4 text-slate-300 font-medium">{label}</td>
                    {PERIOD_ORDER.map((p) => {
                      const value = performance.returns[p]?.[key] ?? null;
                      return (
                        <td
                          key={p}
                          className={`py-2.5 px-3 text-right font-semibold tabular-nums ${
                            value === null
                              ? "text-slate-600"
                              : value >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
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
          <p className="text-[11px] text-slate-500 mt-3">
            A dash means there is not enough data for that period — typically no cash flows or no
            recorded price.
          </p>
        </div>
      )}

      {/* Charts */}
      {performance && performance.holdings.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
            <h2 className="text-sm sm:text-base font-semibold text-slate-200 mb-1">Allocation</h2>
            <p className="text-xs text-slate-400 mb-3">Share of market value by position</p>
            <LazyChart option={allocationOptions} className="h-64" />
          </div>

          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
            <h2 className="text-sm sm:text-base font-semibold text-slate-200 mb-1">
              Contributions vs Growth
            </h2>
            <p className="text-xs text-slate-400 mb-3">
              How much of the balance you saved, and how much the market added
            </p>
            {growthOptions && <LazyChart option={growthOptions} className="h-64" />}
          </div>
        </div>
      )}

      {/* Holdings table */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800/80">
          <h2 className="text-sm sm:text-base font-semibold text-slate-200">Holdings</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800 bg-slate-900/40">
                <th className="text-left font-medium py-2.5 px-4">Symbol</th>
                <th className="text-right font-medium py-2.5 px-3">Quantity</th>
                <th className="text-right font-medium py-2.5 px-3">Price</th>
                <th className="text-right font-medium py-2.5 px-3">Cost Basis</th>
                <th className="text-right font-medium py-2.5 px-3">Market Value</th>
                <th className="text-right font-medium py-2.5 px-3">Unrealized</th>
                <th className="py-2.5 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading positions…
                  </td>
                </tr>
              )}

              {!isLoading && (performance?.holdings.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No holdings yet. Add one to start tracking performance.
                  </td>
                </tr>
              )}

              {!isLoading &&
                performance?.holdings.map((h) => (
                  <tr key={h.holding_id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-200">{h.symbol}</div>
                      {h.name && <div className="text-[10px] text-slate-500">{h.name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300 tabular-nums">
                      {Number(h.quantity).toLocaleString("en-CA", { maximumFractionDigits: 8 })}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {h.is_priced ? (
                        <>
                          <div className="text-slate-300">{money(h.price ?? 0, currency)}</div>
                          <div className="text-[10px] text-slate-500">as of {h.price_as_of}</div>
                        </>
                      ) : (
                        <span className="text-amber-400/80">no price</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300 tabular-nums">
                      {money(h.cost_basis, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-100 font-semibold tabular-nums">
                      {money(h.market_value, currency)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold tabular-nums ${
                        h.unrealized_gain >= 0 ? "text-emerald-400" : "text-rose-400"
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
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <form
            onSubmit={handleAddHolding}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3 text-xs"
          >
            <h3 className="text-base font-bold text-slate-100">Add Holding</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Symbol</label>
                <input
                  required
                  value={newHolding.symbol}
                  onChange={(e) => setNewHolding({ ...newHolding, symbol: e.target.value })}
                  placeholder="VFV.TO"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Name (optional)</label>
                <input
                  value={newHolding.name}
                  onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })}
                  placeholder="Vanguard S&amp;P 500"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Purchase date</label>
              <input
                type="date"
                required
                value={newHolding.trade_date}
                onChange={(e) => setNewHolding({ ...newHolding, trade_date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Quantity</label>
                <input
                  required
                  value={newHolding.quantity}
                  onChange={(e) => setNewHolding({ ...newHolding, quantity: e.target.value })}
                  placeholder="100"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Total cost</label>
                <input
                  required
                  value={newHolding.cost_basis}
                  onChange={(e) => setNewHolding({ ...newHolding, cost_basis: e.target.value })}
                  placeholder="10000.00"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Commission</label>
                <input
                  value={newHolding.fee}
                  onChange={(e) => setNewHolding({ ...newHolding, fee: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Total cost is what the whole tranche cost, not the per-share price.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
              >
                Add Holding
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Price entry modal */}
      {isPriceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <form
            onSubmit={handleSavePrices}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3 text-xs"
          >
            <h3 className="text-base font-bold text-slate-100">Update Prices</h3>
            <p className="text-[11px] text-slate-400">
              Prices are entered by hand — Folio makes no outbound network calls. Paste one{" "}
              <span className="text-slate-200 font-mono">SYMBOL,PRICE</span> per line.
            </p>

            <div>
              <label className="block text-slate-400 mb-1">Prices as of</label>
              <input
                type="date"
                required
                value={priceDate}
                onChange={(e) => setPriceDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Quotes</label>
              <textarea
                required
                rows={7}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder={"VFV.TO,145.20\nXEQT.TO,33.85\nZAG.TO,14.02"}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsPriceOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
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
