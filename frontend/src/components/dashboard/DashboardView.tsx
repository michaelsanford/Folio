import React from "react";
import { LazyChart } from "../common/LazyChart";
import { AccountIcon } from "../common/AccountIcon";
import { Money } from "../common/Money";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import type { Account, DashboardAnalyticsResponse } from "../../types";

interface DashboardViewProps {
  analytics: DashboardAnalyticsResponse | null;
  accounts: Account[];
  onNavigate: (tab: string) => void;
}

const card = "rounded-xl bg-surface border border-subtle";

const StatCard: React.FC<{ label: string; children: React.ReactNode; meta: React.ReactNode }> = ({
  label,
  children,
  meta,
}) => (
  <div className={`${card} p-5`}>
    <div className="text-sm text-sub">{label}</div>
    <div className="mt-2 text-2xl font-medium leading-none">{children}</div>
    <div className="mt-2 text-xs text-muted">{meta}</div>
  </div>
);

export const DashboardView: React.FC<DashboardViewProps> = ({
  analytics,
  accounts,
  onNavigate,
}) => {
  const chartTheme = useChartTheme();

  if (!analytics) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
        Loading dashboard
      </div>
    );
  }

  const { monthly_cash_flow, net_worth_history, category_spending, sankey } = analytics;

  const monthTitle = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const lastPoint = net_worth_history[net_worth_history.length - 1];
  const prevPoint = net_worth_history[net_worth_history.length - 2];
  const monthChange = lastPoint && prevPoint ? lastPoint.net_worth - prevPoint.net_worth : null;

  const mono = "IBM Plex Mono, ui-monospace, monospace";
  const tooltipBase = {
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: none;",
    textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
  };

  // Net worth: the main chart. One accent line on a ruled monthly grid.
  const netWorthOptions = {
    backgroundColor: "transparent",
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: chartTheme.axisLineColor } },
      formatter: (params: any[]) => {
        const item = params[0];
        if (!item) return "";
        return `<div style="color:${chartTheme.subtleTextColor}">${item.name}</div><div style="margin-top:4px;font-family:${mono}">${formatMoney(Number(item.value))}</div>`;
      },
    },
    grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: net_worth_history.map((h) => h.date),
      axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.subtleTextColor, fontSize: 11, fontFamily: mono, margin: 12 },
      splitLine: { show: true, lineStyle: { color: chartTheme.gridLineColor } },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
      axisLabel: {
        color: chartTheme.subtleTextColor,
        fontSize: 11,
        fontFamily: mono,
        formatter: (val: number) => formatMoneyCompact(val),
      },
    },
    series: [
      {
        name: "Net worth",
        type: "line",
        smooth: 0.3,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: false,
        data: net_worth_history.map((h) => h.net_worth),
        endLabel: {
          show: true,
          color: chartTheme.textColor,
          fontFamily: mono,
          fontSize: 11,
          offset: [-8, -16],
          align: "right",
          formatter: (p: any) => formatMoney(Number(p.value), { cents: false }),
        },
        itemStyle: { color: chartTheme.accentColor },
        lineStyle: { width: 2, color: chartTheme.accentColor },
        emphasis: { disabled: true },
      },
    ],
  };

  // Cash flow: the one place category colours appear. Income leads in the accent,
  // pass-through nodes stay neutral, categories keep the colours their owners chose.
  const categoryColors = new Map(category_spending.map((c) => [c.category_name, c.category_color]));
  const nodeColor = (name: string): string => {
    if (/income/i.test(name)) return chartTheme.accentColor;
    if (/savings/i.test(name)) return chartTheme.positiveColor;
    return categoryColors.get(name) || chartTheme.neutralColor;
  };

  const sankeyOptions = {
    backgroundColor: "transparent",
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      triggerOn: "mousemove",
      formatter: (params: any) => {
        if (params.dataType === "edge") {
          return `${params.data.source} → ${params.data.target}<div style="margin-top:4px;font-family:${mono}">${formatMoney(Number(params.data.value))}</div>`;
        }
        return `${params.name}<div style="margin-top:4px;font-family:${mono}">${formatMoney(Number(params.value || 0))}</div>`;
      },
    },
    series: [
      {
        type: "sankey",
        layout: "none",
        left: 0,
        right: 120,
        top: 8,
        bottom: 8,
        nodeWidth: 8,
        nodeGap: 10,
        emphasis: { focus: "adjacency" },
        data: sankey.nodes.map((n) => ({
          name: n.name,
          itemStyle: { color: nodeColor(n.name) },
        })),
        links: sankey.links.map((l) => ({
          source: sankey.nodes[l.source]?.name || "Unknown",
          target: sankey.nodes[l.target]?.name || "Unknown",
          value: l.value,
        })),
        lineStyle: { color: "target", curveness: 0.5, opacity: 0.18 },
        label: { color: chartTheme.textColor, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
        itemStyle: { borderWidth: 0, borderRadius: 2 },
      },
    ],
  };

  return (
    <div className="max-w-[1440px] mx-auto flex flex-col gap-6">
      {/* Header: the month and where net worth stands */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-tight font-medium text-main">{monthTitle}</h1>
          <p className="mt-1 text-sm text-sub">Household overview</p>
        </div>
        <div className="sm:text-right">
          <div className="text-sm text-sub">Net worth</div>
          <Money
            value={analytics.current_net_worth}
            className={`block mt-1 text-[32px] leading-none font-medium ${
              analytics.current_net_worth < 0 ? "text-negative" : "text-main"
            }`}
          />
          <div className="mt-2 text-xs font-mono text-muted">
            {monthChange !== null && (
              <span className={monthChange >= 0 ? "text-positive" : "text-negative"}>
                {formatMoney(monthChange, { signed: true, cents: false })}
              </span>
            )}
            {monthChange !== null && <span> vs last month · </span>}
            <span>
              Assets {formatMoney(analytics.total_assets, { cents: false })} · Debt{" "}
              {formatMoney(analytics.total_liabilities, { cents: false })}
            </span>
          </div>
        </div>
      </header>

      {/* Main chart */}
      <section className={`${card} p-5 sm:p-6`}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium text-main">Net worth</h2>
          <span className="text-xs text-muted">Month-end balances</span>
        </div>
        {net_worth_history.length > 1 ? (
          <LazyChart option={netWorthOptions} className="h-64 sm:h-80 mt-4" />
        ) : (
          <div className="h-64 sm:h-80 mt-4 flex items-center justify-center text-sm text-muted">
            Net worth history appears after the first month of balances
          </div>
        )}
      </section>

      {/* This month */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Income" meta="This month">
          <Money value={monthly_cash_flow.total_income} className="text-main" />
        </StatCard>
        <StatCard label="Expenses" meta="This month, fixed and variable">
          <Money value={monthly_cash_flow.total_expenses} className="text-main" />
        </StatCard>
        <StatCard
          label="Net savings"
          meta={<span className="font-mono">{monthly_cash_flow.savings_rate}% of income</span>}
        >
          <Money
            value={monthly_cash_flow.net_savings}
            signed
            className={monthly_cash_flow.net_savings >= 0 ? "text-positive" : "text-negative"}
          />
        </StatCard>
      </div>

      {/* Cash flow + categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} lg:col-span-2 p-5 sm:p-6`}>
          <h2 className="text-base font-medium text-main">Cash flow</h2>
          <p className="mt-1 text-sm text-sub">Where this month's income went</p>
          {sankey.links.length > 0 ? (
            <LazyChart option={sankeyOptions} className="h-72 mt-4" />
          ) : (
            <div className="h-72 mt-4 flex flex-col items-center justify-center gap-3 text-sm text-muted">
              <p>No income or spending recorded this month</p>
              <button
                onClick={() => onNavigate("ingestion")}
                className="h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98]"
              >
                Import statements
              </button>
            </div>
          )}
        </section>

        <section className={`${card} p-5 sm:p-6 flex flex-col`}>
          <h2 className="text-base font-medium text-main">Top categories</h2>
          <p className="mt-1 text-sm text-sub">Spending this month</p>
          <div className="flex-1 mt-4 flex flex-col gap-4 overflow-y-auto max-h-72 pr-1">
            {category_spending.length > 0 ? (
              category_spending.map((cat) => (
                <div key={cat.category_id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: cat.category_color }}
                      />
                      <span className="text-main truncate">{cat.category_name}</span>
                    </div>
                    <div className="shrink-0 flex items-baseline gap-2">
                      <Money value={cat.amount} cents={false} className="text-sub" />
                      <span className="w-9 text-right text-xs font-mono text-muted">
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-surface-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: "var(--text-muted)",
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted">
                No spending this month
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Accounts */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between px-5 sm:px-6 h-14 border-b border-subtle">
          <h2 className="text-base font-medium text-main">Accounts</h2>
          <button
            onClick={() => onNavigate("accounts")}
            className="text-sm text-accent-subtle hover:underline underline-offset-4"
          >
            View all
          </button>
        </div>
        <ul className="divide-y divide-[var(--border-subtle)] max-h-96 overflow-y-auto">
          {accounts.map((acc) => {
            const isLiability = !isAssetAccount(acc.type);
            return (
              <li key={acc.id} className="flex items-center justify-between gap-4 px-5 sm:px-6 h-14">
                <div className="flex items-center gap-3 min-w-0">
                  <AccountIcon type={acc.type} icon={acc.icon} color={acc.color} size="md" />
                  <div className="min-w-0">
                    <div className="text-sm text-main truncate">{acc.name}</div>
                    <div className="text-xs text-muted truncate">
                      {acc.institution}
                      {acc.account_number_mask ? ` ··${acc.account_number_mask}` : ""}
                      {acc.interest_rate ? ` · ${acc.interest_rate}% APR` : ""}
                    </div>
                  </div>
                </div>
                <Money
                  value={isLiability ? -Math.abs(acc.current_balance) : acc.current_balance}
                  className={`text-sm ${isLiability ? "text-sub" : "text-main"}`}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
