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
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
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
    if (selectedLoanId) {
      setIsLoading(true);
      api
        .getAmortization(selectedLoanId)
        .then((data) => setScheduleData(data))
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    }
  }, [selectedLoanId]);

  if (loanAccounts.length === 0) {
    return (
      <div className="p-12 text-center rounded-2xl bg-slate-900/60 border border-slate-800 text-slate-400">
        <Landmark className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-200">No Loan Accounts Found</h3>
        <p className="text-xs text-slate-400 mt-1">
          Add a Mortgage or Vehicle Loan in the Accounts tab to generate full amortization schedules and automated payment split calculations.
        </p>
      </div>
    );
  }

  // Sample data for the next 12 months chart
  const next12Months = scheduleData?.schedule.slice(0, 12).map((row) => ({
    date: row.payment_date.substring(0, 7),
    Principal: row.principal,
    Interest: row.interest,
    Escrow: row.escrow,
  })) || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Loan Account Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-100">Loan & Mortgage Amortization</h1>
          <p className="text-xs text-slate-400 mt-1">
            Track principal reduction, interest amortization, escrow splits, and payoff projections.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {loanAccounts.map((loan) => (
            <button
              key={loan.id}
              onClick={() => setSelectedLoanId(loan.id)}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-semibold transition-all ${
                selectedLoanId === loan.id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                  : "bg-slate-800/80 text-slate-400 hover:text-slate-200"
              }`}
            >
              {loan.name}
            </button>
          ))}
        </div>
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
                ${scheduleData.current_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Orig. Principal: ${scheduleData.original_principal.toLocaleString()}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Interest Rate (APR)</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-amber-400">
                {scheduleData.interest_rate}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Total Interest: ${scheduleData.total_interest_remaining.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Monthly Payment</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-emerald-400">
                ${scheduleData.monthly_payment.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {scheduleData.escrow_payment > 0
                  ? `Incl. $${scheduleData.escrow_payment.toFixed(0)} escrow/taxes`
                  : "Principal + Interest"}
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
              <span className="text-xs text-slate-400 font-medium uppercase">Projected Payoff</span>
              <div className="mt-2 text-xl sm:text-2xl font-bold text-indigo-400">
                {scheduleData.projected_payoff_date}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {scheduleData.remaining_months} payments remaining
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={next12Months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="Principal" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="Interest" stackId="a" fill="#ef4444" />
                  {scheduleData.escrow_payment > 0 && (
                    <Bar dataKey="Escrow" stackId="a" fill="#8b5cf6" />
                  )}
                </BarChart>
              </ResponsiveContainer>
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
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      <b className="text-blue-400">${row.principal.toFixed(0)}</b> P / <b className="text-rose-400">${row.interest.toFixed(0)}</b> I
                      {row.escrow > 0 && <span> / <b className="text-purple-400">${row.escrow.toFixed(0)}</b> E</span>}
                    </span>
                    <span>Bal: ${row.remaining_balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3">Period</th>
                    <th className="p-3">Payment Date</th>
                    <th className="p-3 text-right">Payment</th>
                    <th className="p-3 text-right">Principal</th>
                    <th className="p-3 text-right">Interest</th>
                    <th className="p-3 text-right">Escrow</th>
                    <th className="p-3 text-right">Remaining Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono font-medium">
                  {scheduleData.schedule.map((row) => (
                    <tr key={row.period} className="hover:bg-slate-800/40 text-slate-300">
                      <td className="p-3 text-slate-400">#{row.period}</td>
                      <td className="p-3">{row.payment_date}</td>
                      <td className="p-3 text-right font-bold text-slate-100">
                        ${row.total_payment.toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-blue-400">
                        ${row.principal.toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-rose-400">
                        ${row.interest.toFixed(2)}
                      </td>
                      <td className="p-3 text-right text-purple-400">
                        ${row.escrow.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-200">
                        ${row.remaining_balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
