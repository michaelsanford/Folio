import React, { useState, useEffect } from "react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { isLoanAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import type { Account, AmortizationScheduleResponse } from "../../types";
import { api } from "../../services/api";

interface LoanAmortizationViewProps {
  accounts: Account[];
}

const card = "rounded-xl bg-surface border border-subtle";

export const LoanAmortizationView: React.FC<LoanAmortizationViewProps> = ({ accounts }) => {
  const chartTheme = useChartTheme();
  const loanAccounts = accounts.filter((a) => isLoanAccount(a.type));

  const [selectedLoanId, setSelectedLoanId] = useState<string>(
    loanAccounts[0]?.id || ""
  );
  const [scheduleData, setScheduleData] = useState<AmortizationScheduleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!selectedLoanId) return;

    const fetchSchedule = async () => {
      setIsLoading(true);
      try {
        const data = await api.getAmortizationSchedule(selectedLoanId);
        setScheduleData(data);
      } catch (err) {
        console.error("Failed to load loan amortization schedule:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSchedule();
  }, [selectedLoanId]);

  if (loanAccounts.length === 0) {
    return (
      <div className={`${card} p-6 py-12 text-center`}>
        <h3 className="text-base font-medium text-main">No liability accounts yet</h3>
        <p className="mt-1 text-sm text-sub max-w-sm mx-auto">
          Add a mortgage, vehicle loan, or other liability account under Accounts to see its amortization schedule
        </p>
      </div>
    );
  }

  // Pre-calculate next 12 months for breakdown chart
  const next12Months =
    scheduleData?.schedule.slice(0, 12).map((row) => ({
      date: row.payment_date.slice(5),
      Principal: row.principal,
      Interest: row.interest,
      Escrow: row.escrow,
    })) || [];

  const hasEscrow = (scheduleData?.escrow_payment ?? 0) > 0;
  const isRevolving = !!scheduleData?.is_revolving;
  const minimumPct = scheduleData?.minimum_payment_percent;
  const projectedBalance = scheduleData?.schedule.at(-1)?.remaining_balance;


  // ECharts stacked bar options: principal carries the accent, the rest stay neutral.
  const barOptions = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      extraCssText: "border-radius: 8px; box-shadow: none;",
      textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: chartTheme.fontFamily },
      formatter: (params: any[]) => {
        let total = 0;
        let content = `<div style="color: ${chartTheme.subtleTextColor}; margin-bottom: 4px;">${params[0]?.name}</div>`;
        params.forEach((p) => {
          total += Number(p.value || 0);
          content += `<div style="display: flex; justify-content: space-between; gap: 16px; font-size: 12px;">
            <span>${p.marker}${p.seriesName}</span>
            <span style="font-family: ${chartTheme.figureFontFamily};">${formatMoney(Number(p.value))}</span>
          </div>`;
        });
        content += `<div style="border-top: 1px solid ${chartTheme.gridLineColor}; margin-top: 4px; padding-top: 4px; display: flex; justify-content: space-between; gap: 16px; font-size: 12px;">
          <span>Total payment</span>
          <span style="font-family: ${chartTheme.figureFontFamily};">${formatMoney(total)}</span>
        </div>`;
        return content;
      },
    },
    legend: {
      top: 0,
      right: 8,
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: chartTheme.textColor, fontSize: 11 },
    },
    grid: {
      left: 8,
      right: 16,
      bottom: 8,
      top: 32,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: next12Months.map((m) => m.date),
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
        formatter: (val: number) => formatMoneyCompact(val),
      },
    },
    series: [
      {
        name: "Principal",
        type: "bar",
        stack: "total",
        itemStyle: { color: chartTheme.accentColor },
        data: next12Months.map((m) => m.Principal),
      },
      {
        name: "Interest",
        type: "bar",
        stack: "total",
        itemStyle: { color: chartTheme.neutralColor },
        data: next12Months.map((m) => m.Interest),
      },
      ...(hasEscrow
        ? [
            {
              name: "Escrow",
              type: "bar",
              stack: "total",
              itemStyle: { color: chartTheme.axisLineColor },
              data: next12Months.map((m) => m.Escrow),
            },
          ]
        : []),
    ],
  };

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6">
      {/* Loan selector */}
      <div className="flex items-center gap-1 overflow-x-auto pb-4 border-b border-subtle">
        {loanAccounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedLoanId(acc.id)}
            className={`h-8 px-3 rounded-lg text-sm whitespace-nowrap border transition-colors cursor-pointer ${
              selectedLoanId === acc.id
                ? "bg-surface-subtle border-default text-main font-medium"
                : "border-transparent text-sub hover:text-main bg-surface-hover"
            }`}
          >
            {acc.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
          Calculating amortization schedule…
        </div>
      ) : scheduleData ? (
        <>
          {/* Key loan figures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`${card} p-5`}>
              <div className="text-sm text-sub">Current balance</div>
              <Money
                value={scheduleData.current_balance ?? 0}
                className="block mt-2 font-display text-2xl font-medium leading-none text-main"
              />
              <div className="mt-2 text-xs text-muted">
                {isRevolving ? (
                  "Revolving, so it goes up and down as you draw and repay"
                ) : (
                  <>
                    Original principal{" "}
                    <span className="tabular-nums">{formatMoney(scheduleData.original_principal ?? 0)}</span>
                  </>
                )}
              </div>
            </div>

            <div className={`${card} p-5`}>
              <div className="text-sm text-sub">Interest rate (APR)</div>
              <div className="mt-2 font-display text-2xl font-medium leading-none tabular-nums text-main">
                {scheduleData.interest_rate ?? 0}%
              </div>
              <div className="mt-2 text-xs text-muted">
                {isRevolving ? "Interest, next 12 months " : "Total interest "}
                <span className="tabular-nums">
                  {formatMoney(scheduleData.total_interest ?? 0, { cents: false })}
                </span>
              </div>
            </div>

            <div className={`${card} p-5`}>
              <div className="text-sm text-sub">{isRevolving ? "Minimum payment" : "Monthly payment"}</div>
              <Money
                value={scheduleData.monthly_payment ?? 0}
                className="block mt-2 font-display text-2xl font-medium leading-none text-main"
              />
              <div className="mt-2 text-xs text-muted">
                {isRevolving
                  ? minimumPct
                    ? `${minimumPct}% of the balance, at least the interest`
                    : "Interest only"
                  : (scheduleData.escrow_payment ?? 0) > 0
                    ? `Includes ${formatMoney(scheduleData.escrow_payment, { cents: false })} escrow and taxes`
                    : "Principal and interest"}
              </div>
            </div>

            {isRevolving ? (
              <div className={`${card} p-5`}>
                <div className="text-sm text-sub">Balance in 12 months</div>
                <Money
                  value={projectedBalance ?? 0}
                  className="block mt-2 font-display text-2xl font-medium leading-none text-main"
                />
                <div className="mt-2 text-xs text-muted">
                  No fixed maturity. Assumes minimum payments and no new draws
                </div>
              </div>
            ) : (
              <div className={`${card} p-5`}>
                <div className="text-sm text-sub">Projected payoff</div>
                <div className="mt-2 font-display text-2xl font-medium leading-none tabular-nums text-main">
                  {scheduleData.payoff_date || "—"}
                </div>
                <div className="mt-2 text-xs text-muted">
                  {scheduleData.loan_term_months || scheduleData.schedule?.length || 0} total payments
                </div>
              </div>
            )}
          </div>

          {/* Payment breakdown chart */}
          <section className={`${card} p-5 sm:p-6`}>
            <h2 className="text-base font-medium text-main">Payment composition, next 12 months</h2>
            <p className="mt-1 text-sm text-sub">
              How each payment splits between principal, interest, and escrow
            </p>

            <LazyChart option={barOptions} className="h-64 mt-4" />
          </section>

          {/* Full schedule */}
          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-5 sm:px-6 h-14 border-b border-subtle">
              <h2 className="text-base font-medium text-main">
                {isRevolving ? "Minimum payment projection" : "Amortization schedule"}
              </h2>
              <span className="text-xs text-muted">
                <span className="tabular-nums">{scheduleData.schedule.length}</span> periods
              </span>
            </div>

            {/* Mobile & tablet schedule feed (< lg) */}
            <div className="block lg:hidden divide-y divide-subtle text-sm max-h-96 overflow-y-auto">
              {scheduleData.schedule.map((row) => (
                <div key={row.period} className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted tabular-nums">
                      #{row.period} · {row.payment_date}
                    </span>
                    <Money value={row.total_payment} className="text-main" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="block text-xs text-muted">Principal</span>
                      <Money value={row.principal} className="text-sub" />
                    </div>
                    <div>
                      <span className="block text-xs text-muted">Interest</span>
                      <Money value={row.interest} className="text-sub" />
                    </div>
                    <div>
                      <span className="block text-xs text-muted">Balance</span>
                      <Money value={row.remaining_balance} className="text-main" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop schedule table (>= lg) */}
            <div className="hidden lg:block max-h-96 overflow-y-auto">
              <table className="w-full table-fixed text-xs xl:text-sm">
                <thead className="bg-surface sticky top-0 border-b border-subtle">
                  <tr className="text-xs text-muted">
                    <th className="h-9 px-2.5 xl:px-4 w-16 text-left font-normal">Period</th>
                    <th className="h-9 px-2.5 xl:px-4 w-24 text-left font-normal">Date</th>
                    <th className="h-9 px-2.5 xl:px-4 text-right font-normal">Total payment</th>
                    <th className="h-9 px-2.5 xl:px-4 text-right font-normal">Principal</th>
                    <th className="h-9 px-2.5 xl:px-4 text-right font-normal">Interest</th>
                    <th className="h-9 px-2.5 xl:px-4 text-right font-normal">Escrow</th>
                    <th className="h-9 px-2.5 xl:px-4 text-right font-normal">Remaining balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle text-sub">
                  {scheduleData.schedule.map((row) => (
                    <tr key={row.period} className="h-9 bg-surface-hover transition-colors">
                      <td className="px-2.5 xl:px-4 tabular-nums text-muted">#{row.period}</td>
                      <td className="px-2.5 xl:px-4 tabular-nums whitespace-nowrap">{row.payment_date}</td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.total_payment} className="text-main" />
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.principal} />
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.interest} />
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.escrow} className="text-muted" />
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.remaining_balance} className="text-main" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};
