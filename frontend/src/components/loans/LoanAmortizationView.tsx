import React, { useState, useEffect } from "react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { isLoanAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import type { Account, AmortizationScheduleResponse } from "../../types";
import { api } from "../../services/api";
import {
  chipTab,
  labelText,
  loneText,
  pageStack,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
  segmentTrack,
} from "../common/ui";

interface LoanAmortizationViewProps {
  accounts: Account[];
}


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
      <div className="px-4 py-16 text-center">
        <h3 className={sectionTitle}>No liability accounts yet</h3>
        <p className={`mt-2 max-w-md mx-auto ${loneText}`}>
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
      textStyle: { color: chartTheme.tooltipText, fontSize: chartTheme.labelFontSize, fontFamily: chartTheme.fontFamily },
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
      textStyle: { color: chartTheme.textColor, fontSize: chartTheme.axisFontSize },
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
      axisLabel: { color: chartTheme.subtleTextColor, fontSize: chartTheme.axisFontSize, fontFamily: chartTheme.figureFontFamily },
    },
    yAxis: {
      type: "value",
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
    <div className={`max-w-7xl mx-auto ${pageStack}`}>
      {/* Loan selector: wraps onto more lines, never scrolls sideways */}
      <div className={segmentTrack}>
        {loanAccounts.map((acc) => (
          <button
            key={acc.id}
            type="button"
            onClick={() => setSelectedLoanId(acc.id)}
            aria-pressed={selectedLoanId === acc.id}
            className={`${chipTab(selectedLoanId === acc.id)} -mb-px text-left break-words`}
          >
            {acc.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div role="status" className={`flex items-center justify-center h-48 px-4 text-center ${loneText}`}>
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
          Calculating amortization schedule…
        </div>
      ) : scheduleData ? (
        <>
          {/* Key loan figures, set straight on the page */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
            <div className="min-w-0">
              <div className={labelText}>Current balance</div>
              <Money
                value={scheduleData.current_balance ?? 0}
                className="block mt-2 font-display text-2xl md:text-3xl font-medium leading-none text-main"
              />
              <div className="mt-2 text-sm text-sub">
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

            <div className="min-w-0">
              <div className={labelText}>Interest rate (APR)</div>
              <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none tabular-nums text-main">
                {scheduleData.interest_rate ?? 0}%
              </div>
              <div className="mt-2 text-sm text-sub">
                {isRevolving ? "Interest, next 12 months " : "Total interest "}
                <span className="tabular-nums">
                  {formatMoney(scheduleData.total_interest ?? 0, { cents: false })}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <div className={labelText}>{isRevolving ? "Minimum payment" : "Monthly payment"}</div>
              <Money
                value={scheduleData.monthly_payment ?? 0}
                className="block mt-2 font-display text-2xl md:text-3xl font-medium leading-none text-main"
              />
              <div className="mt-2 text-sm text-sub">
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
              <div className="min-w-0">
                <div className={labelText}>Balance in 12 months</div>
                <Money
                  value={projectedBalance ?? 0}
                  className="block mt-2 font-display text-2xl md:text-3xl font-medium leading-none text-main"
                />
                <div className="mt-2 text-sm text-sub">
                  No fixed maturity. Assumes minimum payments and no new draws
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <div className={labelText}>Projected payoff</div>
                <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none tabular-nums text-main break-words">
                  {scheduleData.payoff_date || "—"}
                </div>
                <div className="mt-2 text-sm text-sub">
                  {scheduleData.loan_term_months || scheduleData.schedule?.length || 0} total payments
                </div>
              </div>
            )}
          </div>

          {/* Payment breakdown chart */}
          <section className={section}>
            <div className={sectionHeader}>
              <h2 className={sectionTitle}>Payment composition, next 12 months</h2>
              <p className={sectionSub}>
                How each payment splits between principal, interest, and escrow
              </p>
            </div>

            <LazyChart option={barOptions} className="h-64" />
          </section>

          {/* Full schedule */}
          <section className={section}>
            <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${sectionHeader}`}>
              <h2 className={sectionTitle}>
                {isRevolving ? "Minimum payment projection" : "Amortization schedule"}
              </h2>
              <span className="text-sm text-sub">
                <span className="tabular-nums">{scheduleData.schedule.length}</span> periods
              </span>
            </div>

            {/* Phone schedule feed (< md); the page scrolls, not an inner box */}
            <div className="block md:hidden border-y border-subtle divide-y divide-subtle text-base">
              {scheduleData.schedule.map((row) => (
                <div key={row.period} className="py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-sub tabular-nums">
                      #{row.period} · {row.payment_date}
                    </span>
                    <Money value={row.total_payment} className="text-main" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="block text-sm text-sub">Principal</span>
                      <Money value={row.principal} className="text-sub" />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-sm text-sub">Interest</span>
                      <Money value={row.interest} className="text-sub" />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-sm text-sub">Balance</span>
                      <Money value={row.remaining_balance} className="text-main" />
                    </div>
                  </div>
                  {row.escrow > 0 && (
                    <div className="text-sm text-sub">
                      Includes <Money value={row.escrow} /> escrow
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tablet and desktop schedule table (>= md). Period and escrow fold
                into the date and total cells below lg, so the table always fits. */}
            <div className="hidden md:block max-h-96 overflow-y-auto border-b border-subtle">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-[var(--bg-canvas)] sticky top-0 border-b border-subtle">
                  <tr className="text-sm text-sub">
                    <th className="hidden lg:table-cell h-10 px-2.5 xl:px-4 w-16 text-left font-normal">Period</th>
                    <th className="h-10 px-2.5 xl:px-4 w-28 text-left font-normal">Date</th>
                    <th className="h-10 px-2.5 xl:px-4 text-right font-normal">Total payment</th>
                    <th className="h-10 px-2.5 xl:px-4 text-right font-normal">Principal</th>
                    <th className="h-10 px-2.5 xl:px-4 text-right font-normal">Interest</th>
                    <th className="hidden lg:table-cell h-10 px-2.5 xl:px-4 text-right font-normal">Escrow</th>
                    <th className="h-10 px-2.5 xl:px-4 text-right font-normal">Remaining balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle text-sub">
                  {scheduleData.schedule.map((row) => (
                    <tr key={row.period} className="h-10 bg-surface-hover transition-colors">
                      <td className="hidden lg:table-cell px-2.5 xl:px-4 tabular-nums">#{row.period}</td>
                      <td className="px-2.5 xl:px-4 py-1.5 tabular-nums whitespace-nowrap">
                        <span className="lg:hidden">#{row.period} · </span>
                        {row.payment_date}
                      </td>
                      <td className="px-2.5 xl:px-4 py-1.5 text-right whitespace-nowrap">
                        <Money value={row.total_payment} className="text-main" />
                        {row.escrow > 0 && (
                          <div className="lg:hidden">
                            incl. <Money value={row.escrow} /> escrow
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.principal} />
                      </td>
                      <td className="px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.interest} />
                      </td>
                      <td className="hidden lg:table-cell px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <Money value={row.escrow} />
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
