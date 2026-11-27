import React from "react";
import { LazyChart } from "../common/LazyChart";
import { AccountIcon } from "../common/AccountIcon";
import { Money } from "../common/Money";
import { AccountFilterBar } from "./AccountFilterBar";
import { CreditUsage } from "../accounts/CreditUsage";
import { isAssetAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { formatMoney, formatMoneyCompact, getDateLocale } from "../../utils/format";
import type { Account, DashboardAnalyticsResponse } from "../../types";
import {
  labelText,
  loneText,
  scrollList,
  pageStack,
  primaryButton,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
  wrapOnPhone,
} from "../common/ui";

interface DashboardViewProps {
  analytics: DashboardAnalyticsResponse | null;
  accounts: Account[];
  onNavigate: (tab: string) => void;
  /** Accounts left out of every figure (persisted as a preference). */
  hiddenAccountIds?: readonly string[];
  onHiddenAccountsChange?: (ids: string[]) => void;
}

let measureCanvas: HTMLCanvasElement | undefined;
/** Width in pixels of a chart label, so the chart can leave room for it. */
function measureText(text: string, size: number, family: string): number {
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * size * 0.6;
  ctx.font = `${size}px ${family}`;
  return ctx.measureText(text).width;
}

/** One figure of the month, set straight on the page: label, figure, note. */
const Figure: React.FC<{ label: string; children: React.ReactNode; meta: React.ReactNode }> = ({
  label,
  children,
  meta,
}) => (
  <div className="min-w-0">
    <div className={labelText}>{label}</div>
    <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none">{children}</div>
    <div className="mt-2 text-sm text-sub">{meta}</div>
  </div>
);

export const DashboardView: React.FC<DashboardViewProps> = ({
  analytics,
  accounts,
  onNavigate,
  hiddenAccountIds = [],
  onHiddenAccountsChange,
}) => {
  const chartTheme = useChartTheme();
  const isPhone = useIsPhone();
  const hidden = new Set(hiddenAccountIds);
  const hiddenCount = accounts.filter((a) => hidden.has(a.id)).length;

  if (!analytics) {
    return (
      <div role="status" className={`flex items-center justify-center h-64 ${loneText}`}>
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
        Loading dashboard
      </div>
    );
  }

  const { monthly_cash_flow, net_worth_history, category_spending, sankey } = analytics;

  const monthTitle = new Date().toLocaleDateString(getDateLocale(), { month: "long", year: "numeric" });

  const lastPoint = net_worth_history[net_worth_history.length - 1];
  const prevPoint = net_worth_history[net_worth_history.length - 2];
  const monthChange = lastPoint && prevPoint ? lastPoint.net_worth - prevPoint.net_worth : null;

  const tooltipBase = {
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: none;",
    textStyle: { color: chartTheme.tooltipText, fontSize: chartTheme.labelFontSize, fontFamily: chartTheme.fontFamily },
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
        return `<div style="color:${chartTheme.subtleTextColor}">${item.name}</div><div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(Number(item.value))}</div>`;
      },
    },
    grid: { left: 8, right: 16, bottom: 8, top: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: net_worth_history.map((h) => h.date),
      axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
      axisTick: { show: false },
      axisLabel: { color: chartTheme.subtleTextColor, fontSize: chartTheme.axisFontSize, fontFamily: chartTheme.figureFontFamily, margin: 12 },
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
        fontSize: chartTheme.axisFontSize,
        fontFamily: chartTheme.figureFontFamily,
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
          fontFamily: chartTheme.figureFontFamily,
          fontSize: chartTheme.axisFontSize,
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

  // Room on the right for the category names: as wide as the longest one, up
  // to a cap. A longer name wraps onto a second line (then ends in an
  // ellipsis; the tooltip and Top categories show it in full), and the nodes
  // are spaced by the label height so wrapped names never run into each other.
  const sankeyLabelWidths = sankey.nodes.map((n) =>
    measureText(n.name, chartTheme.labelFontSize, chartTheme.fontFamily) * 1.1,
  );
  const sankeyLabelRoom = Math.min(isPhone ? 150 : 280, Math.max(48, ...sankeyLabelWidths) + 16);
  const sankeyLabelLines = Math.min(
    2,
    Math.max(1, ...sankeyLabelWidths.map((w) => Math.ceil(w / (sankeyLabelRoom - 12)))),
  );
  const sankeyLineHeight = Math.round(chartTheme.labelFontSize * 1.25);

  const sankeyOptions = {
    backgroundColor: "transparent",
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      triggerOn: "mousemove",
      formatter: (params: any) => {
        if (params.dataType === "edge") {
          return `${params.data.source} → ${params.data.target}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(Number(params.data.value))}</div>`;
        }
        return `${params.name}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(Number(params.value || 0))}</div>`;
      },
    },
    series: [
      {
        type: "sankey",
        layout: "none",
        left: 0,
        right: sankeyLabelRoom,
        top: 8,
        bottom: 8 + (sankeyLabelLines - 1) * sankeyLineHeight,
        nodeWidth: 8,
        nodeGap: sankeyLabelLines * sankeyLineHeight + 6,
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
        label: {
          color: chartTheme.textColor,
          fontSize: chartTheme.labelFontSize,
          fontFamily: chartTheme.fontFamily,
          width: sankeyLabelRoom - 12,
          overflow: "break",
          lineHeight: sankeyLineHeight,
          height: sankeyLabelLines * sankeyLineHeight,
          lineOverflow: "truncate",
        },
        itemStyle: { borderWidth: 0, borderRadius: 2 },
      },
    ],
  };

  return (
    <div className={`max-w-[1440px] mx-auto ${pageStack}`}>
      {/* Header: the month and where net worth stands */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl leading-tight font-semibold text-main">{monthTitle}</h1>
          <p className="mt-1 text-sm text-sub">
            {hiddenCount === 0 ? (
              "Household overview"
            ) : (
              <>
                <span className="tabular-nums">
                  {accounts.length - hiddenCount} of {accounts.length}
                </span>{" "}
                accounts
                {onHiddenAccountsChange && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => onHiddenAccountsChange([])}
                      className="text-accent-subtle hover:underline underline-offset-4 cursor-pointer"
                    >
                      Show all
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="sm:text-right">
          <div className="text-sm text-sub">Net worth</div>
          <Money
            value={analytics.current_net_worth}
            className={`block mt-1 text-4xl leading-none font-medium ${
              analytics.current_net_worth < 0 ? "text-negative" : "text-main"
            }`}
          />
          <div className="mt-2 text-sm tabular-nums text-sub">
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

      {onHiddenAccountsChange && (
        <AccountFilterBar
          accounts={accounts}
          hiddenAccountIds={hiddenAccountIds}
          onHiddenAccountsChange={onHiddenAccountsChange}
        />
      )}

      {/* Main chart */}
      <section className={section}>
        <div className={sectionHeader}>
          <h2 className={sectionTitle}>Net worth</h2>
          <p className={sectionSub}>Month-end balances</p>
        </div>
        {net_worth_history.length > 1 ? (
          <LazyChart option={netWorthOptions} className="h-64 sm:h-80" />
        ) : (
          <div className={`h-64 sm:h-80 px-4 flex items-center justify-center text-center ${loneText}`}>
            Net worth history appears after the first month of balances
          </div>
        )}
      </section>

      {/* This month */}
      <section className={section} aria-labelledby="this-month">
        <h2 id="this-month" className={`${sectionTitle} ${sectionHeader}`}>This month</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-8">
        <Figure label="Income" meta="Everything that came in">
          <Money value={monthly_cash_flow.total_income} className="text-main" />
        </Figure>
        <Figure label="Expenses" meta="Fixed and variable">
          <Money value={monthly_cash_flow.total_expenses} className="text-main" />
        </Figure>
        <Figure
          label="Net savings"
          meta={<span className="tabular-nums">{monthly_cash_flow.savings_rate}% of income</span>}
        >
          <Money
            value={monthly_cash_flow.net_savings}
            signed
            className={monthly_cash_flow.net_savings >= 0 ? "text-positive" : "text-negative"}
          />
        </Figure>
        </div>
      </section>

      {/* Cash flow + categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-16">
        <section className={`${section} lg:col-span-2`}>
          <div className={sectionHeader}>
            <h2 className={sectionTitle}>Cash flow</h2>
            <p className={sectionSub}>Where this month's income went</p>
          </div>
          {sankey.links.length > 0 ? (
            <LazyChart option={sankeyOptions} className={sankeyLabelLines > 1 ? "h-[28rem]" : "h-80"} />
          ) : (
            <div className={`h-80 px-4 flex flex-col items-center justify-center gap-4 text-center ${loneText}`}>
              <p>No income or spending recorded this month</p>
              <button
                onClick={() => onNavigate("ingestion")}
                className={primaryButton}
              >
                Import statements
              </button>
            </div>
          )}
        </section>

        <section className={`${section} flex flex-col`}>
          <div className={sectionHeader}>
            <h2 className={sectionTitle}>Top categories</h2>
            <p className={sectionSub}>Spending this month</p>
          </div>
          <div className={`flex-1 flex flex-col gap-5 md:overflow-y-auto md:max-h-72 ${scrollList}`}>
            {category_spending.length > 0 ? (
              category_spending.map((cat) => (
                <div key={cat.category_id}>
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: cat.category_color }}
                      />
                      <span className="text-main break-words">{cat.category_name}</span>
                    </div>
                    <div className="shrink-0 flex items-baseline gap-2">
                      <Money value={cat.amount} cents={false} className="text-sub" />
                      <span className="w-11 text-right text-sm tabular-nums text-sub">
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: "var(--text-secondary)",
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className={`h-full py-8 flex items-center justify-center text-center ${loneText}`}>
                No spending this month
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Accounts */}
      <section className={section}>
        <div className={`flex items-baseline justify-between ${sectionHeader}`}>
          <h2 className={sectionTitle}>Accounts</h2>
          <button
            type="button"
            onClick={() => onNavigate("accounts")}
            className="min-h-11 md:min-h-0 px-2 -mr-2 text-base md:text-sm font-semibold text-accent-subtle hover:underline underline-offset-4 cursor-pointer"
          >
            View all
          </button>
        </div>
        <ul className={`border-y border-subtle divide-y divide-[var(--border-subtle)] md:max-h-96 md:overflow-y-auto ${scrollList}`}>
          {accounts.map((acc) => {
            const isLiability = !isAssetAccount(acc.type);
            const isHidden = hidden.has(acc.id);
            return (
              <li
                key={acc.id}
                className={`flex items-center justify-between gap-4 min-h-16 py-3 transition-opacity ${
                  isHidden ? "opacity-50" : ""
                }`}
                title={isHidden ? "Not counted on the dashboard" : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <AccountIcon type={acc.type} icon={acc.icon} color={acc.color} size="md" />
                  <div className="min-w-0">
                    <div className={`text-base text-main ${wrapOnPhone}`}>{acc.name}</div>
                    {(acc.institution || acc.account_number_mask) && (
                      <div className={`text-sm text-sub ${wrapOnPhone}`}>
                        {acc.institution}
                        {acc.account_number_mask ? ` ··${acc.account_number_mask}` : ""}
                      </div>
                    )}
                    {(acc.interest_rate || acc.credit_limit) ? (
                      <div className="text-sm text-sub flex flex-wrap items-center gap-x-1.5">
                        {acc.interest_rate ? <span>{acc.interest_rate}% APR</span> : null}
                        {acc.interest_rate && acc.credit_limit ? <span aria-hidden="true">·</span> : null}
                        {acc.credit_limit ? (
                          <CreditUsage compact balance={acc.current_balance} limit={acc.credit_limit} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <Money
                  value={isLiability ? -acc.current_balance : acc.current_balance}
                  className={`text-base shrink-0 ${isLiability ? "text-sub" : "text-main"}`}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
