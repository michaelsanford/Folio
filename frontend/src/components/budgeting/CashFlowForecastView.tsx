import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { NumberField } from "../common/NumberField";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import type { CashFlowForecastResponse } from "../../types";
import { api } from "../../services/api";

const card = "rounded-xl bg-surface border border-subtle";
const inputClass =
  "w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50";

const EVENT_LABELS: Record<string, string> = {
  INCOME: "Income",
  MORTGAGE: "Mortgage",
  LOAN: "Loan",
  EXPENSE: "Expense",
};

export const CashFlowForecastView: React.FC = () => {
  const chartTheme = useChartTheme();

  const [days, setDays] = useState<number>(60);
  const [paySchedule, setPaySchedule] = useState<"BI_WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "NONE">(
    "BI_WEEKLY"
  );
  const [expectedPaycheck, setExpectedPaycheck] = useState<number | null>(3000);
  const [nextPayDate, setNextPayDate] = useState<string>(() => {
    // Default next pay date to upcoming Friday
    const d = new Date();
    const day = d.getDay();
    const diff = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  });

  const [forecast, setForecast] = useState<CashFlowForecastResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForecast = async () => {
    setIsLoading(true);
    try {
      const data = await api.getCashFlowForecast({
        days,
        pay_schedule: paySchedule,
        expected_paycheck_net: paySchedule !== "NONE" ? expectedPaycheck ?? 0 : 0,
        next_pay_date: paySchedule !== "NONE" ? nextPayDate : undefined,
      });
      setForecast(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not generate the cash flow forecast.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
  }, [days, paySchedule, expectedPaycheck, nextPayDate]);

  // ECharts line chart configuration
  const chartOptions = useMemo(() => {
    if (!forecast || !forecast.daily_curve || forecast.daily_curve.length === 0) {
      return {};
    }

    const dates = forecast.daily_curve.map((d) => d.date);
    const balances = forecast.daily_curve.map((d) => d.cash_balance);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        extraCssText: "border-radius: 8px; box-shadow: none;",
        textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: chartTheme.fontFamily },
        axisPointer: { type: "line", lineStyle: { color: chartTheme.axisLineColor } },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const idx = params[0].dataIndex;
          const pt = forecast.daily_curve[idx];
          let html = `<div style="color:${chartTheme.subtleTextColor}">${pt.date}</div>`;
          html += `<div style="margin-top:4px">Balance <span style="font-family:${chartTheme.figureFontFamily};color:${
            pt.cash_balance >= 0 ? chartTheme.tooltipText : chartTheme.negativeColor
          }">${formatMoney(pt.cash_balance)}</span></div>`;
          if (pt.projected_income > 0) {
            html += `<div>Income <span style="font-family:${chartTheme.figureFontFamily};color:${chartTheme.positiveColor}">${formatMoney(
              pt.projected_income,
              { signed: true }
            )}</span></div>`;
          }
          if (pt.projected_expense > 0) {
            html += `<div>Outflow <span style="font-family:${chartTheme.figureFontFamily}">${formatMoney(
              -pt.projected_expense
            )}</span></div>`;
          }
          if (pt.events && pt.events.length > 0) {
            html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${chartTheme.gridLineColor};font-size:11px;color:${chartTheme.subtleTextColor}">Scheduled</div>`;
            pt.events.forEach((ev) => {
              html += `<div style="font-size:11px">${ev}</div>`;
            });
          }
          return html;
        },
      },
      grid: { left: 8, right: 16, bottom: 8, top: 24, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisTick: { show: false },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: chartTheme.figureFontFamily,
          margin: 12,
          formatter: (val: string) => {
            const parts = val.split("-");
            return `${parts[1]}/${parts[2]}`;
          },
        },
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
          name: "Projected cash",
          type: "line",
          smooth: 0.3,
          showSymbol: false,
          symbolSize: 6,
          data: balances,
          itemStyle: { color: chartTheme.accentColor },
          lineStyle: { color: chartTheme.accentColor, width: 2 },
          areaStyle: { color: chartTheme.accentColor, opacity: 0.06 },
          markLine: {
            silent: true,
            symbol: "none",
            data: [
              {
                yAxis: 0,
                lineStyle: { color: chartTheme.negativeColor, type: "dashed", width: 1 },
                label: {
                  formatter: "Zero balance",
                  color: chartTheme.negativeColor,
                  fontSize: 11,
                  fontFamily: chartTheme.fontFamily,
                },
              },
            ],
          },
        },
      ],
    };
  }, [forecast, chartTheme]);

  return (
    <div className="space-y-6">
      {/* Parameter controls panel */}
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-4">
          <div>
            <h2 className="text-base font-medium text-main">Cash flow forecast</h2>
            <p className="text-sm text-sub mt-1">
              Projected cash from your pay schedule and scheduled loan payments
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Forecast window</span>
            <div className="flex rounded-lg bg-surface-subtle p-0.5 border border-default text-xs">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`h-7 px-3 rounded-md transition-colors cursor-pointer ${
                    days === d ? "bg-surface text-main" : "text-muted hover:text-main"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-sub mb-2">Pay schedule</label>
            <select
              value={paySchedule}
              onChange={(e) =>
                setPaySchedule(
                  e.target.value as "BI_WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "NONE"
                )
              }
              className={inputClass}
            >
              <option value="BI_WEEKLY">Bi-weekly (26 pay periods a year)</option>
              <option value="SEMI_MONTHLY">Semi-monthly (15th and month-end)</option>
              <option value="MONTHLY">Monthly (1st of the month)</option>
              <option value="NONE">No paycheck</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-sub mb-2">Expected net paycheck</label>
            <NumberField
              step="50"
              min="0"
              value={expectedPaycheck}
              disabled={paySchedule === "NONE"}
              onValueChange={setExpectedPaycheck}
              className={`${inputClass} tabular-nums`}
            />
          </div>

          <div>
            <label className="block text-xs text-sub mb-2">Next paycheck date</label>
            <input
              type="date"
              value={nextPayDate}
              disabled={paySchedule === "NONE"}
              onChange={(e) => setNextPayDate(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-negative-subtle text-sm text-negative">{error}</div>
      )}

      {/* KPI cards */}
      {forecast && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Starting cash</div>
            <div className="mt-2 font-display text-2xl font-medium leading-none">
              <Money value={forecast.starting_cash} className="text-main" />
            </div>
            <div className="mt-2 text-xs text-muted">Chequing and savings today</div>
          </div>

          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Ending cash after {days} days</div>
            <div className="mt-2 font-display text-2xl font-medium leading-none">
              <Money value={forecast.ending_cash} className="text-main" />
            </div>
            <div className="mt-2 text-xs text-muted">
              <Money
                value={forecast.ending_cash - forecast.starting_cash}
                signed
                className={
                  forecast.ending_cash >= forecast.starting_cash ? "text-positive" : "text-negative"
                }
              />{" "}
              net change
            </div>
          </div>

          <div className={`${card} p-5`}>
            <div className="text-sm text-sub">Lowest projected balance</div>
            <div className="mt-2 font-display text-2xl font-medium leading-none">
              <Money
                value={forecast.lowest_cash_point}
                className={forecast.lowest_cash_point >= 0 ? "text-main" : "text-negative"}
              />
            </div>
            <div className="mt-2 text-xs text-muted">
              On <span className="tabular-nums text-sub">{forecast.lowest_cash_date}</span>
            </div>
          </div>
        </div>
      )}

      {/* Warning if cash dips below zero */}
      {forecast && forecast.lowest_cash_point < 0 && (
        <div className="p-4 rounded-xl bg-negative-subtle text-sm text-negative flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
          <div>
            <div className="font-medium">Cash shortfall ahead</div>
            <p className="mt-1">
              Your projected cash drops to{" "}
              <Money value={forecast.lowest_cash_point} /> on{" "}
              <span className="tabular-nums">{forecast.lowest_cash_date}</span>. To avoid overdraft
              fees or missed loan and mortgage payments, move funds from an emergency HISA or cut
              discretionary spending before that date.
            </p>
          </div>
        </div>
      )}

      {/* Daily cash curve chart */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-main">Projected cash, {days} days</h3>
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
              <span>Calculating…</span>
            </div>
          )}
        </div>

        <div className="h-72 w-full mt-4">
          {forecast && forecast.daily_curve.length > 0 ? (
            <LazyChart option={chartOptions} className="h-full" />
          ) : (
            <div className="flex items-center justify-center h-full text-muted text-sm">
              No cash data to forecast yet
            </div>
          )}
        </div>
      </div>

      {/* Scheduled amortization and payroll events */}
      {forecast && forecast.scheduled_events.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 px-5 pt-5 pb-4">
            <h3 className="text-base font-medium text-main">
              Upcoming scheduled events{" "}
              <span className="tabular-nums text-sm text-muted">{forecast.scheduled_events.length}</span>
            </h3>
            <span className="text-xs text-muted">Loan payments and paydays</span>
          </div>

          {/* Mobile cards (< md) */}
          <div className="block md:hidden divide-y divide-subtle border-t border-subtle">
            {forecast.scheduled_events.map((ev, idx) => {
              const isIncome = ev.event_type === "INCOME";
              return (
                <div key={idx} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm text-main truncate" title={ev.description}>
                      {ev.description}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="tabular-nums">{ev.date}</span>
                      <span>·</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-xs ${
                          isIncome ? "bg-positive-subtle text-positive" : "bg-surface-subtle text-sub"
                        }`}
                      >
                        {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                      </span>
                      {ev.account_name && (
                        <>
                          <span>·</span>
                          <span className="truncate">{ev.account_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Money
                    value={isIncome ? ev.amount : -ev.amount}
                    signed
                    className={`text-sm shrink-0 ${isIncome ? "text-positive" : "text-main"}`}
                  />
                </div>
              );
            })}
          </div>

          {/* Desktop table (>= md) */}
          <div className="hidden md:block border-t border-subtle">
            <table className="w-full table-fixed text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-subtle text-xs text-muted">
                  <th className="h-10 px-4 w-24 font-normal">Date</th>
                  <th className="h-10 px-3 w-24 font-normal">Type</th>
                  <th className="h-10 px-3 font-normal">Description</th>
                  <th className="hidden lg:table-cell h-10 px-3 w-[22%] font-normal">Account</th>
                  <th className="h-10 px-4 w-28 font-normal text-right">Cash impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {forecast.scheduled_events.map((ev, idx) => {
                  const isIncome = ev.event_type === "INCOME";
                  return (
                    <tr key={idx} className="h-12 bg-surface-hover transition-colors">
                      <td className="px-4 tabular-nums text-sub whitespace-nowrap">{ev.date}</td>
                      <td className="px-3">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap ${
                            isIncome ? "bg-positive-subtle text-positive" : "bg-surface-subtle text-sub"
                          }`}
                        >
                          {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                        </span>
                      </td>
                      <td className="px-3 text-main min-w-0">
                        <div className="truncate" title={ev.description}>
                          {ev.description}
                        </div>
                        {ev.account_name && (
                          <div className="lg:hidden text-xs text-muted truncate">
                            {ev.account_name}
                          </div>
                        )}
                      </td>
                      <td className="hidden lg:table-cell px-3 text-muted">
                        <div className="truncate" title={ev.account_name || undefined}>
                          {ev.account_name || "—"}
                        </div>
                      </td>
                      <td className="px-4 text-right whitespace-nowrap">
                        <Money
                          value={isIncome ? ev.amount : -ev.amount}
                          signed
                          className={isIncome ? "text-positive" : "text-main"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
