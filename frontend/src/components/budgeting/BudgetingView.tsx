import React, { useState, useEffect } from "react";
import {
  PiggyBank,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Edit2,
  Save,
} from "lucide-react";
import type { Budget, BudgetItem, Category } from "../../types";
import { api } from "../../services/api";

interface BudgetingViewProps {
  categories: Category[];
}

export const BudgetingView: React.FC<BudgetingViewProps> = ({ categories }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [budget, setBudget] = useState<Budget | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState<number>(0);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

  const loadBudget = async () => {
    setIsLoading(true);
    try {
      const data = await api.getBudget(year, month);
      setBudget(data);
    } catch {
      // Fallback to current
      const data = await api.getCurrentBudget();
      setBudget(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBudget();
  }, [currentDate]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
  };

  const handleSavePlannedAmount = async (categoryId: string) => {
    if (!budget) return;
    try {
      const updated = await api.updateBudget(budget.id, {
        items: [{ category_id: categoryId, planned_amount: targetInput }],
      });
      setBudget(updated);
      setEditingTargetId(null);
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const totalPlannedExpenses = budget?.items.reduce((sum, it) => sum + it.planned_amount, 0) || 0;
  const totalActualExpenses = budget?.total_actual_expense || 0;
  const remainingBudget = totalPlannedExpenses - totalActualExpenses;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Month Navigator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Monthly Envelope Budget</h1>
          <p className="text-xs text-slate-400 mt-1">
            Allocate category spending targets and monitor live expense burn rates.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-800/80 p-1.5 rounded-xl border border-slate-700/80">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold text-slate-200 px-3 min-w-[120px] text-center">
            {monthName}
          </span>
          <button
            onClick={handleNextMonth}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-xs text-slate-400 font-medium uppercase">Total Planned Budget</span>
          <div className="mt-2 text-2xl font-bold text-slate-100">
            ${totalPlannedExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Target for {monthName}</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-xs text-slate-400 font-medium uppercase">Actual Spent So Far</span>
          <div className="mt-2 text-2xl font-bold text-rose-400">
            ${totalActualExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {totalPlannedExpenses > 0
              ? `${Math.round((totalActualExpenses / totalPlannedExpenses) * 100)}% of total budget`
              : "No budget targets set"}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <span className="text-xs text-slate-400 font-medium uppercase">Remaining to Spend</span>
          <div
            className={`mt-2 text-2xl font-bold ${
              remainingBudget >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            ${remainingBudget.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {remainingBudget >= 0 ? "Under budget" : "Over budget"}
          </div>
        </div>
      </div>

      {/* Category Envelopes List */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-200">Category Budgets & Envelopes</h2>

        {isLoading ? (
          <div className="py-12 text-center text-slate-400">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mx-auto mb-2"></div>
            Loading budgets...
          </div>
        ) : budget?.items && budget.items.length > 0 ? (
          <div className="space-y-4">
            {budget.items.map((item) => {
              const cat = categories.find((c) => c.id === item.category_id);
              if (!cat) return null;

              const percentUsed =
                item.planned_amount > 0
                  ? Math.min(100, Math.round((item.actual_amount / item.planned_amount) * 100))
                  : item.actual_amount > 0
                  ? 100
                  : 0;

              const isOver = item.actual_amount > item.planned_amount && item.planned_amount > 0;
              const isEditing = editingTargetId === item.category_id;

              return (
                <div
                  key={item.category_id}
                  className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40 space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color || "#6366f1" }}
                      ></span>
                      <span className="text-sm font-semibold text-slate-200">{cat.name}</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Target: $</span>
                          <input
                            type="number"
                            step="10"
                            value={targetInput}
                            onChange={(e) => setTargetInput(parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs font-mono"
                          />
                          <button
                            onClick={() => handleSavePlannedAmount(item.category_id)}
                            className="p-1 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">
                            Spent: <b className="text-slate-200">${item.actual_amount.toFixed(2)}</b> / $
                            {item.planned_amount.toFixed(2)}
                          </span>
                          <button
                            onClick={() => {
                              setEditingTargetId(item.category_id);
                              setTargetInput(item.planned_amount);
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-400"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isOver
                            ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        }`}
                      >
                        {isOver
                          ? `Over by $${(item.actual_amount - item.planned_amount).toFixed(2)}`
                          : `$${item.remaining_amount.toFixed(2)} left`}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isOver
                          ? "bg-rose-500"
                          : percentUsed > 80
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                      }`}
                      style={{ width: `${percentUsed}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500 text-xs">
            No budget categories configured yet.
          </div>
        )}
      </div>
    </div>
  );
};
