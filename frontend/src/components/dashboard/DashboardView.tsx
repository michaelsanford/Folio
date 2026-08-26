import React from "react";
import {
  PiggyBank,
  DollarSign,
  CreditCard,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import type { Account, DashboardAnalyticsResponse } from "../../types";

interface DashboardViewProps {
  analytics: DashboardAnalyticsResponse | null;
  accounts: Account[];
  onNavigate: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  analytics,
  accounts,
  onNavigate,
}) => {
  if (!analytics) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mr-3"></div>
        Loading dashboard metrics...
      </div>
    );
  }

  const { monthly_cash_flow, net_worth_history, category_spending, sankey } = analytics;

  // ECharts Sankey Options
  const sankeyOptions = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      formatter: (params: any) => {
        if (params.dataType === "edge") {
          return `${params.data.source} → ${params.data.target}: <b>$${Number(params.data.value).toLocaleString()}</b>`;
        }
        return `${params.name}: <b>$${Number(params.value || 0).toLocaleString()}</b>`;
      },
    },
    series: [
      {
        type: "sankey",
        layout: "none",
        emphasis: { focus: "adjacency" },
        data: sankey.nodes.map((n) => ({ name: n.name })),
        links: sankey.links.map((l) => ({
          source: sankey.nodes[l.source]?.name || "Unknown",
          target: sankey.nodes[l.target]?.name || "Unknown",
          value: l.value,
        })),
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.45 },
        label: {
          color: "#94a3b8",
          fontSize: 12,
          fontWeight: 500,
        },
        itemStyle: {
          borderWidth: 0,
          borderRadius: 3,
        },
      },
    ],
  };

  // ECharts Net Worth Area Options
  const netWorthOptions = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f172a",
      borderColor: "#334155",
      textStyle: { color: "#f8fafc", fontSize: 12 },
      formatter: (params: any[]) => {
        const item = params[0];
        if (!item) return "";
        return `<div class="font-medium text-slate-300">${item.name}</div><div class="text-indigo-400 mt-1 font-bold">Net Worth: $${Number(item.value).toLocaleString()}</div>`;
      },
    },
    grid: {
      left: "2%",
      right: "3%",
      bottom: "3%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: net_worth_history.map((h) => h.date),
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#64748b", fontSize: 11 },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#334155", opacity: 0.3 } },
      axisLabel: {
        color: "#64748b",
        fontSize: 11,
        formatter: (val: number) => `$${Math.round(val / 1000)}k`,
      },
    },
    series: [
      {
        name: "Net Worth",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: net_worth_history.map((h) => h.net_worth),
        itemStyle: { color: "#6366f1" },
        lineStyle: { width: 2.5, color: "#6366f1" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(99, 102, 241, 0.4)" },
              { offset: 1, color: "rgba(99, 102, 241, 0.0)" },
            ],
          },
        },
      },
    ],
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Net Worth */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Net Worth
            </span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold text-slate-100">
            ${analytics.current_net_worth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center text-xs text-slate-400 gap-1.5 sm:gap-2">
            <span className="text-emerald-400 font-medium">Assets: ${analytics.total_assets.toLocaleString()}</span>
            <span>•</span>
            <span className="text-rose-400 font-medium">Debt: ${analytics.total_liabilities.toLocaleString()}</span>
          </div>
        </div>

        {/* Monthly Income */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Monthly Income
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold text-emerald-400">
            +${monthly_cash_flow.total_income.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 text-xs text-slate-400">Current calendar month</div>
        </div>

        {/* Monthly Expenses */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Monthly Expenses
            </span>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <ArrowDownRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold text-rose-400">
            -${monthly_cash_flow.total_expenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 text-xs text-slate-400">Fixed + Variable Outflows</div>
        </div>

        {/* Net Savings & Rate */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Net Savings
            </span>
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400">
              <PiggyBank className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold text-violet-300">
            ${monthly_cash_flow.net_savings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-semibold">
              {monthly_cash_flow.savings_rate}%
            </span>
            <span className="text-slate-400">Savings Rate</span>
          </div>
        </div>
      </div>

      {/* Sankey Flow & Net Worth Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cash Flow Sankey Diagram (2 cols) */}
        <div className="lg:col-span-2 p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-200">Cash Flow Stream (Sankey)</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Visual flow of income into category expenditures and net savings
              </p>
            </div>
          </div>

          {sankey.links.length > 0 ? (
            <LazyChart option={sankeyOptions} className="h-72" />
          ) : (
            <div className="h-72 flex flex-col items-center justify-center text-slate-500 text-sm">
              <p>No income/expense flow recorded yet for this month.</p>
              <button
                onClick={() => onNavigate("ingestion")}
                className="mt-3 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                Import Bank Statements
              </button>
            </div>
          )}
        </div>

        {/* Category Spending Breakdown (1 col) */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl flex flex-col">
          <h2 className="text-base font-semibold text-slate-200 mb-1">Top Expenses by Category</h2>
          <p className="text-xs text-slate-400 mb-4">Current month spending distribution</p>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-72 pr-1">
            {category_spending.length > 0 ? (
              category_spending.map((cat) => (
                <div key={cat.category_id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: cat.category_color }}
                      ></span>
                      <span className="font-medium text-slate-300">{cat.category_name}</span>
                    </div>
                    <div className="font-semibold text-slate-200">
                      ${cat.amount.toLocaleString()}{" "}
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({cat.percentage}%)
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: cat.category_color,
                      }}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                No expense transactions this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Net Worth Progression & Accounts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Net Worth Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
          <h2 className="text-base font-semibold text-slate-200 mb-1">Net Worth Progression</h2>
          <p className="text-xs text-slate-400 mb-4">Historical trajectory of assets vs liabilities</p>

          <LazyChart option={netWorthOptions} className="h-64" />
        </div>

        {/* Managed Accounts Summary */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-200">Your Accounts</h2>
            <button
              onClick={() => onNavigate("accounts")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              View All
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-64 pr-1">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-700/50 text-slate-300">
                    {acc.type.includes("CARD") ? (
                      <CreditCard className="w-4 h-4 text-amber-400" />
                    ) : acc.type.includes("MORTGAGE") || acc.type.includes("LOAN") ? (
                      <Building2 className="w-4 h-4 text-violet-400" />
                    ) : (
                      <PiggyBank className="w-4 h-4 text-emerald-400" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">{acc.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {acc.institution} {acc.account_number_mask ? `(${acc.account_number_mask})` : ""}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`text-xs font-bold ${
                      acc.current_balance >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    ${acc.current_balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  {acc.interest_rate ? (
                    <div className="text-[10px] text-slate-400">{acc.interest_rate}% APR</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
