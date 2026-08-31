import React, { useState, useEffect } from "react";
import { Landmark } from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { isLoanAccount } from "../../constants/canadianAccountTypes";
import { useChartTheme } from "../../hooks/useChartTheme";
import type { Account, AmortizationScheduleResponse } from "../../types";
import { api } from "../../services/api";

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
      <div className="p-12 text-center rounded-2xl bg-surface border border-default shadow-xs">
        <Landmark className="w-12 h-12 text-muted mx-auto mb-3" />
        <h3 className="text-base font-bold text-main">No Liability Accounts Found</h3>
        <p className="text-xs text-muted max-w-sm mx-auto mt-1">
          Add a Mortgage, Vehicle Loan, or Liability account under Accounts to compute amortization schedules.
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

  // ECharts Stacked Bar Options
  const barOptions = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: chartTheme.tooltipBg,
      borderColor: chartTheme.tooltipBorder,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        let total = 0;
        let content = `<div style="font-weight: bold; color: ${chartTheme.tooltipText}; margin-bottom: 4px;">${params[0]?.name}</div>`;
        params.forEach((p) => {
          total += Number(p.value || 0);
          content += `<div style="display: flex; justify-content: space-between; gap: 16px; font-size: 12px; font-family: monospace;">
            <span style="color:${p.color}">● ${p.seriesName}:</span>
            <b>$${Number(p.value).toFixed(2)}</b>
          </div>`;
        });
        content += `<div style="border-top: 1px solid ${chartTheme.gridLineColor}; margin-top: 4px; padding-top: 4px; display: flex; justify-content: space-between; font-weight: bold; font-size: 12px; font-family: monospace;">
          <span>Total Payment:</span>
          <span>$${total.toFixed(2)}</span>
        </div>`;
        return content;
      },
    },
    legend: {
      top: "0%",
      right: "4%",
      textStyle: { color: chartTheme.textColor, fontSize: 11 },
    },
    grid: {
      left: "2%",
      right: "3%",
      bottom: "3%",
      top: "14%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: next12Months.map((m) => m.date),
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
        formatter: (val: number) => `$${val}`,
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
        itemStyle: { color: chartTheme.negativeColor },
        data: next12Months.map((m) => m.Interest),
      },
      ...(hasEscrow
        ? [
            {
              name: "Escrow",
              type: "bar",
              stack: "total",
              itemStyle: { color: chartTheme.neutralColor },
              data: next12Months.map((m) => m.Escrow),
            },
          ]
        : []),
    ],
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Account Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-subtle">
        {loanAccounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedLoanId(acc.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              selectedLoanId === acc.id
                ? "bg-accent-main text-accent-contrast shadow-xs"
                : "bg-surface text-sub hover:text-main border border-default hover:bg-surface-hover"
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            {acc.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-muted">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main mx-auto mb-3"></div>
          Calculating amortization schedule...
        </div>
      ) : scheduleData ? (
        <>
          {/* Key Loan Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
              <span className="text-xs text-muted font-semibold uppercase tracking-wider">Current Balance</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-main">
                ${(scheduleData.current_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-muted font-mono mt-1">
                Orig. Principal: ${(scheduleData.original_principal ?? 0).toLocaleString()}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
              <span className="text-xs text-muted font-semibold uppercase tracking-wider">Interest Rate (APR)</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-accent-main">
                {scheduleData.interest_rate ?? 0}%
              </div>
              <div className="text-[11px] text-muted font-mono mt-1">
                Total Interest: ${(scheduleData.total_interest ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
              <span className="text-xs text-muted font-semibold uppercase tracking-wider">Monthly Payment</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-positive">
                ${(scheduleData.monthly_payment ?? 0).toFixed(2)}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {(scheduleData.escrow_payment ?? 0) > 0
                  ? `Incl. $${scheduleData.escrow_payment.toFixed(0)} escrow/taxes`
                  : "Principal + Interest"}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-default shadow-xs">
              <span className="text-xs text-muted font-semibold uppercase tracking-wider">Projected Payoff</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-main">
                {scheduleData.payoff_date || "-"}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {scheduleData.loan_term_months || scheduleData.schedule?.length || 0} total payments
              </div>
            </div>
          </div>

          {/* Payment Breakdown Chart */}
          <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
            <h2 className="text-sm sm:text-base font-bold text-main mb-1">
              Payment Composition (Upcoming 12 Months)
            </h2>
            <p className="text-xs text-muted mb-4">
              Breakdown of Principal reduction, Interest cost, and Escrow
            </p>

            <LazyChart option={barOptions} className="h-64" />
          </div>

          {/* Full Schedule */}
          <div className="rounded-2xl border border-default bg-surface overflow-hidden shadow-xs">
            <div className="p-4 border-b border-subtle bg-surface-subtle flex items-center justify-between">
              <h2 className="text-sm font-bold text-main">Full Amortization Schedule</h2>
              <span className="text-xs text-muted font-mono">
                {scheduleData.schedule.length} Periods
              </span>
            </div>

            {/* Mobile Schedule Feed (< md) */}
            <div className="block md:hidden divide-y divide-subtle font-mono text-xs max-h-96 overflow-y-auto">
              {scheduleData.schedule.map((row) => (
                <div key={row.period} className="p-3 space-y-1.5 hover:bg-surface-hover">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-muted">Period #{row.period} • {row.payment_date}</span>
                    <span className="text-main">${row.total_payment.toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] text-muted">
                    <div>
                      <span className="text-[9px] uppercase block text-muted font-sans font-semibold">Principal</span>
                      <span className="text-accent-main font-medium">${row.principal.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase block text-muted font-sans font-semibold">Interest</span>
                      <span className="text-negative font-medium">${row.interest.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase block text-muted font-sans font-semibold">Balance</span>
                      <span className="text-main font-medium">${row.remaining_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Schedule Table (>= md) */}
            <div className="hidden md:block overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-surface-subtle text-muted sticky top-0 border-b border-subtle font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Total Payment</th>
                    <th className="py-2.5 px-4 text-accent-main">Principal</th>
                    <th className="py-2.5 px-4 text-negative">Interest</th>
                    <th className="py-2.5 px-4 text-muted">Escrow</th>
                    <th className="py-2.5 px-4">Remaining Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle text-sub">
                  {scheduleData.schedule.map((row) => (
                    <tr key={row.period} className="hover:bg-surface-hover transition-colors">
                      <td className="py-2 px-4 text-muted">#{row.period}</td>
                      <td className="py-2 px-4">{row.payment_date}</td>
                      <td className="py-2 px-4 font-semibold text-main">
                        ${row.total_payment.toFixed(2)}
                      </td>
                      <td className="py-2 px-4 text-accent-main">${row.principal.toFixed(2)}</td>
                      <td className="py-2 px-4 text-negative">${row.interest.toFixed(2)}</td>
                      <td className="py-2 px-4 text-muted">${row.escrow.toFixed(2)}</td>
                      <td className="py-2 px-4 font-bold text-main">
                        ${row.remaining_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
