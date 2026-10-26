import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calendar,
  DollarSign,
  Clock,
  Landmark,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { useChartTheme } from "../../hooks/useChartTheme";
import type { CashFlowForecastResponse } from "../../types";
import { api } from "../../services/api";

const money = (val: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

export const CashFlowForecastView: React.FC = () => {
  const chartTheme = useChartTheme();

  const [days, setDays] = useState<number>(60);
  const [paySchedule, setPaySchedule] = useState<"BI_WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "NONE">(
    "BI_WEEKLY"
  );
  const [expectedPaycheck, setExpectedPaycheck] = useState<number>(3000);
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
        expected_paycheck_net: paySchedule !== "NONE" ? expectedPaycheck : 0,
        next_pay_date: paySchedule !== "NONE" ? nextPayDate : undefined,
      });
      setForecast(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not generate cash-flow forecast.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadForecast();
  }, [days, paySchedule, expectedPaycheck, nextPayDate]);

  // ECharts Line Chart Configuration
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
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const idx = params[0].dataIndex;
          const pt = forecast.daily_curve[idx];
          let html = `<div class="font-sans"><b>${pt.date}</b><br/>`;
          html += `Cash Balance: <b style="color: ${
            pt.cash_balance >= 0 ? chartTheme.positiveColor : chartTheme.negativeColor
          }">${money(pt.cash_balance)}</b><br/>`;
          if (pt.projected_income > 0) {
            html += `<span style="color: ${chartTheme.positiveColor}">+ Income: ${money(
              pt.projected_income
            )}</span><br/>`;
          }
          if (pt.projected_expense > 0) {
            html += `<span style="color: ${chartTheme.negativeColor}">- Outflow: ${money(
              pt.projected_expense
            )}</span><br/>`;
          }
          if (pt.events && pt.events.length > 0) {
            html += `<div class="mt-1 pt-1 border-t border-subtle text-[11px]"><b>Scheduled:</b><br/>`;
            pt.events.forEach((ev) => {
              html += `• ${ev}<br/>`;
            });
            html += `</div>`;
          }
          html += `</div>`;
          return html;
        },
      },
      grid: {
        left: "3%",
        right: "3%",
        bottom: "10%",
        top: "12%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
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
          formatter: (v: number) => `$${Math.round(v / 1000)}k`,
        },
      },
      series: [
        {
          name: "Projected Cash",
          type: "line",
          smooth: true,
          showSymbol: false,
          symbolSize: 6,
          data: balances,
          lineStyle: {
            color: chartTheme.accentColor,
            width: 2.5,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${chartTheme.accentColor}33` },
                { offset: 1, color: `${chartTheme.accentColor}05` },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: "none",
            data: [
              {
                yAxis: 0,
                lineStyle: { color: chartTheme.negativeColor, type: "dashed", width: 1.5 },
                label: { formatter: "Zero Liquidity Floor", color: chartTheme.negativeColor },
              },
            ],
          },
        },
      ],
    };
  }, [forecast, chartTheme]);

  return (
    <div className="space-y-6">
      {/* Parameter Controls Panel */}
      <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle pb-4">
          <div>
            <h2 className="text-base font-bold text-main flex items-center gap-2">
              <Calendar className="w-5 h-5 text-accent-main" />
              Canadian Cash-Flow Forecasting
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Simulate cash trajectory based on Canadian 26-pay period bi-weekly schedules and loan amortization payment dates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">Forecast Window:</span>
            <div className="flex rounded-xl bg-surface-subtle p-0.5 border border-default text-xs">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    days === d
                      ? "bg-accent-main text-accent-contrast shadow-xs"
                      : "text-muted hover:text-main"
                  }`}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-muted mb-1.5">
              Payroll Schedule
            </label>
            <select
              value={paySchedule}
              onChange={(e) =>
                setPaySchedule(
                  e.target.value as "BI_WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "NONE"
                )
              }
              className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-medium focus:ring-1 focus:ring-accent-main focus:outline-hidden"
            >
              <option value="BI_WEEKLY">Bi-Weekly (26 pay periods / year)</option>
              <option value="SEMI_MONTHLY">Semi-Monthly (15th & Month-End)</option>
              <option value="MONTHLY">Monthly (1st of month)</option>
              <option value="NONE">No automated payroll injection</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted mb-1.5">
              Expected Net Paycheck ($CAD)
            </label>
            <input
              type="number"
              step="50"
              min="0"
              value={expectedPaycheck}
              disabled={paySchedule === "NONE"}
              onChange={(e) => setExpectedPaycheck(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono focus:ring-1 focus:ring-accent-main focus:outline-hidden disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted mb-1.5">
              Next Paycheck Date
            </label>
            <input
              type="date"
              value={nextPayDate}
              disabled={paySchedule === "NONE"}
              onChange={(e) => setNextPayDate(e.target.value)}
              className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {forecast && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Starting Liquid Cash
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-main">
              {money(forecast.starting_cash)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              Current balance in Chequing & Savings
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Projected Ending Cash ({days} Days)
            </div>
            <div
              className={`mt-2 text-2xl font-bold font-mono ${
                forecast.ending_cash >= forecast.starting_cash ? "text-positive" : "text-negative"
              }`}
            >
              {money(forecast.ending_cash)}
            </div>
            <div className="mt-1 text-[11px] text-muted flex items-center gap-1 font-mono">
              Net Change:{" "}
              {forecast.ending_cash >= forecast.starting_cash ? "+" : ""}
              {money(forecast.ending_cash - forecast.starting_cash)}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Lowest Projected Point
            </div>
            <div
              className={`mt-2 text-2xl font-bold font-mono ${
                forecast.lowest_cash_point >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {money(forecast.lowest_cash_point)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              Projected for <b>{forecast.lowest_cash_date}</b>
            </div>
          </div>
        </div>
      )}

      {/* Danger Warning if Cash Dips Below Zero */}
      {forecast && forecast.lowest_cash_point < 0 && (
        <div className="p-4 rounded-2xl bg-negative-subtle border border-rose-500/40 text-xs text-negative flex items-start gap-3 shadow-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-negative" />
          <div>
            <div className="font-bold text-sm">Cash Deficit Alert</div>
            <p className="mt-0.5">
              Your projected liquid cash balance drops to{" "}
              <b>{money(forecast.lowest_cash_point)}</b> on <b>{forecast.lowest_cash_date}</b>.
              To avoid overdraft fees or missed loan/mortgage payments, consider transferring funds
              from an emergency HISA or reducing discretionary expenses prior to that date.
            </p>
          </div>
        </div>
      )}

      {/* Interactive Daily Cash Curve Chart */}
      <div className="p-6 rounded-2xl bg-surface border border-default shadow-xs">
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent-main" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
              Projected Liquid Cash Curve ({days} Days)
            </h3>
          </div>
          {isLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Calculating...</span>
            </div>
          )}
        </div>

        <div className="h-72 w-full mt-2">
          {forecast && forecast.daily_curve.length > 0 ? (
            <LazyChart option={chartOptions} className="h-full" />
          ) : (
            <div className="flex items-center justify-center h-full text-muted text-xs">
              No cash data available to generate forecast curve.
            </div>
          )}
        </div>
      </div>

      {/* Scheduled Amortization & Payroll Events Table */}
      {forecast && forecast.scheduled_events.length > 0 && (
        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent-main" />
              Upcoming Scheduled Cash Events ({forecast.scheduled_events.length})
            </h3>
            <span className="text-[11px] text-muted">
              Amortization loan schedules + Payroll calendar
            </span>
          </div>

          <div className="border border-default rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-subtle border-b border-subtle text-muted font-semibold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Account</th>
                  <th className="py-2.5 px-4 text-right">Cash Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {forecast.scheduled_events.map((ev, idx) => {
                  const isIncome = ev.event_type === "INCOME";
                  return (
                    <tr key={idx} className="hover:bg-surface-hover transition-colors">
                      <td className="py-2.5 px-3 font-mono font-medium text-main">{ev.date}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            isIncome
                              ? "bg-positive-subtle text-positive"
                              : ev.event_type === "MORTGAGE"
                              ? "bg-purple-500/10 text-purple-600"
                              : "bg-surface-subtle text-muted"
                          }`}
                        >
                          {ev.event_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-main">{ev.description}</td>
                      <td className="py-2.5 px-3 text-muted">{ev.account_name || "—"}</td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono font-bold ${
                          isIncome ? "text-positive" : "text-negative"
                        }`}
                      >
                        {isIncome ? "+" : "-"}
                        {money(ev.amount)}
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
