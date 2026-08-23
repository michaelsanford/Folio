import React, { useState, useEffect } from "react";
import {
  Landmark,
  Shield,
  Percent,
  Calendar,
  DollarSign,
  TrendingDown,
  Calculator,
  ChevronRight,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import type { Account, AmortizationScheduleResponse } from "../../types";
import { api } from "../../services/api";

interface LoanAmortizationViewProps {
  accounts: Account[];
}

export const LoanAmortizationView: React.FC<LoanAmortizationViewProps> = ({ accounts }) => {
  const loanAccounts = accounts.filter((a) =>
    ["MORTGAGE", "VEHICLE_LOAN", "OTHER_LIABILITY"].includes(a.type)
  );

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
      <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800">
        <Landmark className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <h3 className="text-base font-medium text-slate-300">No Liability Accounts Found</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
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
      backgroundColor: "#0f172a",
      borderColor: "#334155",
      textStyle: { color: "#f8fafc", fontSize: 12 },
      formatter: (params: any[]) => {
        let total = 0;
        let content = `<div class="font-semibold text-slate-200 mb-1">${params[0]?.name}</div>`;
        params.forEach((p) => {
          total += Number(p.value || 0);
          content += `<div class="flex items-center justify-between gap-4 text-xs">
            <span style="color:${p.color}">● ${p.seriesName}:</span>
            <b>$${Number(p.value).toFixed(2)}</b>
          </div>`;
        });
        content += `<div class="border-t border-slate-700 mt-1 pt-1 flex justify-between font-bold text-xs text-slate-100">
          <span>Total Payment:</span>
          <span>$${total.toFixed(2)}</span>
        </div>`;
        return content;
      },
    },
    legend: {
      top: "0%",
      right: "4%",
      textStyle: { color: "#94a3b8", fontSize: 11 },
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
        formatter: (val: number) => `$${val}`,
      },
    },
    series: [
      {
        name: "Principal",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#3b82f6" },
        data: next12Months.map((m) => m.Principal),
      },
      {
        name: "Interest",
        type: "bar",
        stack: "total",
        itemStyle: { color: "#ef4444" },
        data: next12Months.map((m) => m.Interest),
      },
      ...(hasEscrow
        ? [
            {
              name: "Escrow",
              type: "bar",
              stack: "total",
              itemStyle: { color: "#8b5cf6" },
              data: next12Months.map((m) => m.Escrow),
            },
          ]
        : []),
    ],
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Account Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800">
        {loanAccounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedLoanId(acc.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              selectedLoanId === acc.id
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            {acc.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-3"></div>
          Calculating amortization schedule...
        </div>
      ) : scheduleData ? (
        <>
          {/* Key Loan Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Current Balance</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-100">
                ${(scheduleData.current_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Orig. Principal: ${(scheduleData.original_principal ?? 0).toLocaleString()}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Interest Rate (APR)</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-amber-400">
                {scheduleData.interest_rate ?? 0}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Total Interest: ${(scheduleData.total_interest ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Monthly Payment</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-emerald-400">
                ${(scheduleData.monthly_payment ?? 0).toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {(scheduleData.escrow_payment ?? 0) > 0
                  ? `Incl. $${scheduleData.escrow_payment.toFixed(0)} escrow/taxes`
                  : "Principal + Interest"}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Projected Payoff</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-indigo-400">
                {scheduleData.payoff_date || "-"}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {scheduleData.loan_term_months || scheduleData.schedule?.length || 0} total payments
              </div>
            </div>
          </div>

          {/* Payment Breakdown Chart */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl">
            <h2 className="text-sm sm:text-base font-semibold text-slate-200 mb-1">
              Payment Composition (Upcoming 12 Months)
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Breakdown of Principal reduction, Interest cost, and Escrow
            </p>

            <div className="h-64 w-full">
              <ReactECharts
                option={barOptions}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "svg" }}
              />
            </div>
          </div>

          {/* Full Schedule */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Full Amortization Schedule</h2>
              <span className="text-xs text-slate-400 font-mono">
                {scheduleData.schedule.length} Periods
              </span>
            </div>

            {/* Mobile Schedule Feed (< md) */}
            <div className="block md:hidden divide-y divide-slate-800/60 font-mono text-xs max-h-96 overflow-y-auto">
              {scheduleData.schedule.map((row) => (
                <div key={row.period} className="p-3 space-y-1.5 hover:bg-slate-800/30">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-slate-400">Period #{row.period} • {row.payment_date}</span>
                    <span className="text-slate-100">${row.total_payment.toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-400">
                    <div>
                      <span className="text-[9px] uppercase block text-slate-500">Principal</span>
                      <span className="text-blue-400 font-medium">${row.principal.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase block text-slate-500">Interest</span>
                      <span className="text-rose-400 font-medium">${row.interest.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase block text-slate-500">Balance</span>
                      <span className="text-slate-200 font-medium">${row.remaining_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Schedule Table (>= md) */}
            <div className="hidden md:block overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/60 text-slate-400 sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Total Payment</th>
                    <th className="py-2.5 px-4 text-blue-400">Principal</th>
                    <th className="py-2.5 px-4 text-rose-400">Interest</th>
                    <th className="py-2.5 px-4 text-violet-400">Escrow</th>
                    <th className="py-2.5 px-4">Remaining Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300">
                  {scheduleData.schedule.map((row) => (
                    <tr key={row.period} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 px-4 text-slate-500">#{row.period}</td>
                      <td className="py-2 px-4">{row.payment_date}</td>
                      <td className="py-2 px-4 font-semibold text-slate-100">
                        ${row.total_payment.toFixed(2)}
                      </td>
                      <td className="py-2 px-4 text-blue-400">${row.principal.toFixed(2)}</td>
                      <td className="py-2 px-4 text-rose-400">${row.interest.toFixed(2)}</td>
                      <td className="py-2 px-4 text-violet-400">${row.escrow.toFixed(2)}</td>
                      <td className="py-2 px-4 font-bold text-slate-200">
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
