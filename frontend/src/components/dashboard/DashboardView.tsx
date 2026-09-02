import React from "react";
import {
  PiggyBank,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { AccountIcon } from "../common/AccountIcon";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
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
  const chartTheme = useChartTheme();

  if (!analytics) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main mr-3"></div>
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
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
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
          color: chartTheme.textColor,
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
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const item = params[0];
        if (!item) return "";
        return `<div><div style="font-weight: 500; color: ${chartTheme.subtleTextColor};">${item.name}</div><div style="color: ${chartTheme.accentColor}; margin-top: 4px; font-weight: bold; font-family: monospace;">Net Worth: $${Number(item.value).toLocaleString()}</div></div>`;
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
      axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
      axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11 },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
      axisLabel: {
        color: chartTheme.subtleTextColor,
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
        itemStyle: { color: chartTheme.accentColor },
        lineStyle: { width: 2.5, color: chartTheme.accentColor },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: chartTheme.accentGradient.start },
              { offset: 1, color: chartTheme.accentGradient.end },
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
        <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Net Worth
            </span>
            <div className="p-2 rounded-xl bg-accent-subtle text-accent-subtle">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold font-mono tracking-tight text-main">
            ${analytics.current_net_worth.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center text-xs font-mono text-muted gap-1.5 sm:gap-2">
            <span className="text-positive font-medium">Assets: ${analytics.total_assets.toLocaleString()}</span>
            <span>•</span>
            <span className="text-negative font-medium">Debt: ${analytics.total_liabilities.toLocaleString()}</span>
          </div>
        </div>

        {/* Monthly Income */}
        <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Monthly Income
            </span>
            <div className="p-2 rounded-xl bg-positive-subtle text-positive">
              <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold font-mono text-positive">
            +${monthly_cash_flow.total_income.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 text-xs text-muted">Current calendar month</div>
        </div>

        {/* Monthly Expenses */}
        <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Monthly Expenses
            </span>
            <div className="p-2 rounded-xl bg-negative-subtle text-negative">
              <ArrowDownRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-2xl font-bold font-mono text-negative">
            -${monthly_cash_flow.total_expenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 text-xs text-muted">Fixed + Variable Outflows</div>
        </div>

        {/* Net Savings & Rate */}
        <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Net Savings
            </span>
            <div className="p-2 rounded-xl bg-accent-subtle text-accent-subtle">
              <PiggyBank className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div
            className={`mt-2 sm:mt-3 text-xl sm:text-2xl font-bold font-mono ${
              monthly_cash_flow.net_savings >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            ${monthly_cash_flow.net_savings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span className="px-2 py-0.5 rounded bg-accent-subtle text-accent-subtle font-mono font-semibold">
              {monthly_cash_flow.savings_rate}%
            </span>
            <span className="text-muted">Savings Rate</span>
          </div>
        </div>
      </div>

      {/* Sankey Flow & Net Worth Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cash Flow Sankey Diagram (2 cols) */}
        <div className="lg:col-span-2 p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-main">Cash Flow Stream (Sankey)</h2>
              <p className="text-xs text-muted mt-0.5">
                Visual flow of income into category expenditures and net savings
              </p>
            </div>
          </div>

          {sankey.links.length > 0 ? (
            <LazyChart option={sankeyOptions} className="h-72" />
          ) : (
            <div className="h-72 flex flex-col items-center justify-center text-muted text-sm">
              <p>No income/expense flow recorded yet for this month.</p>
              <button
                onClick={() => onNavigate("ingestion")}
                className="mt-3 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs"
              >
                Import Bank Statements
              </button>
            </div>
          )}
        </div>

        {/* Category Spending Breakdown (1 col) */}
        <div className="p-6 rounded-2xl bg-surface border border-default shadow-xs flex flex-col">
          <h2 className="text-base font-bold text-main mb-1">Top Expenses by Category</h2>
          <p className="text-xs text-muted mb-4">Current month spending distribution</p>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-72 pr-1">
            {category_spending.length > 0 ? (
              category_spending.map((cat) => (
                <div key={cat.category_id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.category_color }}
                      ></span>
                      <span className="font-medium text-main truncate">{cat.category_name}</span>
                    </div>
                    <div className="font-semibold font-mono text-sub shrink-0">
                      ${cat.amount.toLocaleString()}{" "}
                      <span className="text-[10px] text-muted font-normal">
                        ({cat.percentage}%)
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
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
              <div className="h-full flex items-center justify-center text-muted text-xs">
                No expense transactions this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Net Worth Progression & Accounts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Net Worth Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-surface border border-default shadow-xs">
          <h2 className="text-base font-bold text-main mb-1">Net Worth Progression</h2>
          <p className="text-xs text-muted mb-4">Historical trajectory of assets vs liabilities</p>

          <LazyChart option={netWorthOptions} className="h-64" />
        </div>

        {/* Managed Accounts Summary */}
        <div className="p-6 rounded-2xl bg-surface border border-default shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-main">Your Accounts</h2>
            <button
              onClick={() => onNavigate("accounts")}
              className="text-xs text-accent-main hover:underline font-semibold"
            >
              View All
            </button>
          </div>

          <div className="space-y-2.5 overflow-y-auto max-h-64 pr-1">
            {accounts.map((acc) => {
              const isAsset = isAssetAccount(acc.type);
              return (
                <div
                  key={acc.id}
                  className="p-3 rounded-xl bg-surface-subtle border border-subtle flex items-center justify-between transition-colors hover:border-default"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AccountIcon
                      type={acc.type}
                      icon={acc.icon}
                      color={acc.color}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-main truncate">{acc.name}</div>
                      <div className="text-[10px] text-muted truncate">
                        {acc.institution} {acc.account_number_mask ? `(${acc.account_number_mask})` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-bold font-mono ${
                        isAsset
                          ? "text-positive"
                          : acc.current_balance < 0
                          ? "text-negative"
                          : "text-main"
                      }`}
                    >
                      ${acc.current_balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    {acc.interest_rate ? (
                      <div className="text-[10px] text-muted font-mono">{acc.interest_rate}% APR</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
