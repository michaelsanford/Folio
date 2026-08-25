import React, { useState, useEffect, useMemo } from "react";
import {
  PiggyBank,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Edit2,
  Save,
  X,
  Plus,
  Search,
  LayoutList,
  LayoutGrid,
  ExternalLink,
  Trash2,
  ArrowUpDown,
  FolderPlus,
  DollarSign,
  BarChart3,
} from "lucide-react";
import ReactECharts from "echarts-for-react";
import type { Budget, BudgetItem, Category, Transaction } from "../../types";
import { api } from "../../services/api";

interface BudgetingViewProps {
  categories: Category[];
  onCategoriesModified?: () => void;
}

type FilterStatus = "ALL" | "OVER" | "WARNING" | "ON_TRACK" | "UNSPENT";
type SortField = "NAME" | "PLANNED" | "ACTUAL" | "REMAINING" | "PERCENT";
type SortDirection = "ASC" | "DESC";

const PRESET_COLORS = [
  "#6366F1", // Indigo
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#EF4444", // Rose
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#14B8A6", // Teal
  "#F97316", // Orange
  "#64748B", // Slate
];

export const BudgetingView: React.FC<BudgetingViewProps> = ({
  categories,
  onCategoriesModified,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [budget, setBudget] = useState<Budget | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // View & Filter States
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [chartMode, setChartMode] = useState<"top8" | "all">("top8");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [sortField, setSortField] = useState<SortField>("PERCENT");
  const [sortDirection, setSortDirection] = useState<SortDirection>("DESC");

  // Inline Editing
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState<number>(0);

  // Add / Create Category Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalTab, setAddModalTab] = useState<"existing" | "new">("existing");
  const [selectedExistingCatId, setSelectedExistingCatId] = useState<string>("");
  const [existingCatTarget, setExistingCatTarget] = useState<number>(100);

  // New Category Form
  const [newCatName, setNewCatName] = useState("");
  const [newCatParentId, setNewCatParentId] = useState<string>("");
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [newCatTarget, setNewCatTarget] = useState<number>(100);
  const [isSubmittingCat, setIsSubmittingCat] = useState(false);

  // Transaction Drilldown Modal
  const [drilldownCategory, setDrilldownCategory] = useState<Category | null>(null);
  const [drilldownTransactions, setDrilldownTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

  // Compute month progress
  const daysInMonth = new Date(year, month, 0).getDate();
  const currentDay = Math.min(
    daysInMonth,
    new Date().getFullYear() === year && new Date().getMonth() + 1 === month
      ? new Date().getDate()
      : daysInMonth
  );
  const monthElapsedPercent = Math.round((currentDay / daysInMonth) * 100);

  const loadBudget = async () => {
    setIsLoading(true);
    try {
      const data = await api.getBudget(year, month);
      setBudget(data);
    } catch {
      try {
        const data = await api.getCurrentBudget();
        setBudget(data);
      } catch (err) {
        console.error("Budget load error:", err);
      }
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

  const handleSavePlannedAmount = async (categoryId: string, amount: number) => {
    if (!budget) return;
    try {
      const updated = await api.upsertBudgetItem(year, month, {
        category_id: categoryId,
        planned_amount: amount,
      });
      setBudget(updated);
      setEditingTargetId(null);
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const handleRemoveCategoryFromBudget = async (categoryId: string) => {
    if (!budget) return;
    if (!confirm("Are you sure you want to remove this category target from the budget?")) return;
    try {
      const updated = await api.deleteBudgetItem(budget.id, categoryId);
      setBudget(updated);
    } catch (err: any) {
      alert(`Remove failed: ${err.message}`);
    }
  };

  const handleAddExistingCategory = async () => {
    if (!selectedExistingCatId) return;
    setIsSubmittingCat(true);
    try {
      const updated = await api.upsertBudgetItem(year, month, {
        category_id: selectedExistingCatId,
        planned_amount: existingCatTarget,
      });
      setBudget(updated);
      setIsAddModalOpen(false);
      setSelectedExistingCatId("");
      if (onCategoriesModified) onCategoriesModified();
    } catch (err: any) {
      alert(`Failed to add category: ${err.message}`);
    } finally {
      setIsSubmittingCat(false);
    }
  };

  const handleCreateNewCategory = async () => {
    if (!newCatName.trim()) return;
    setIsSubmittingCat(true);
    try {
      const created = await api.createCategory({
        name: newCatName.trim(),
        parent_id: newCatParentId || null,
        color: newCatColor,
        type: "EXPENSE",
        is_budgeted: true,
      });

      const updated = await api.upsertBudgetItem(year, month, {
        category_id: created.id,
        planned_amount: newCatTarget,
      });

      setBudget(updated);
      setIsAddModalOpen(false);
      setNewCatName("");
      setNewCatParentId("");
      setNewCatTarget(100);
      if (onCategoriesModified) onCategoriesModified();
    } catch (err: any) {
      alert(`Failed to create category: ${err.message}`);
    } finally {
      setIsSubmittingCat(false);
    }
  };

  const handleOpenDrilldown = async (cat: Category) => {
    setDrilldownCategory(cat);
    setIsLoadingTransactions(true);
    try {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const res = await api.getTransactions({
        category_id: cat.id,
        start_date: startDate,
        end_date: endDate,
        page_size: 100,
      });
      setDrilldownTransactions(res.items || []);
    } catch (err) {
      console.error("Drilldown fetch error:", err);
      setDrilldownTransactions([]);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  // KPIs
  const totalPlannedExpenses = budget?.items.reduce((sum, it) => sum + it.planned_amount, 0) || 0;
  const totalActualExpenses = budget?.total_actual_expense || 0;
  const remainingBudget = totalPlannedExpenses - totalActualExpenses;
  const overallPercentSpent =
    totalPlannedExpenses > 0
      ? Math.round((totalActualExpenses / totalPlannedExpenses) * 100)
      : 0;

  const daysRemainingInMonth = Math.max(1, daysInMonth - currentDay);
  const dailySafeSpend = Math.max(0, remainingBudget) / daysRemainingInMonth;

  // Filtered & Sorted Budget Items
  const filteredAndSortedItems = useMemo(() => {
    if (!budget?.items) return [];

    let list = budget.items.map((item) => {
      const cat = categories.find((c) => c.id === item.category_id);
      const isOver = item.actual_amount > item.planned_amount && item.planned_amount > 0;
      const percentUsed =
        item.planned_amount > 0
          ? Math.round((item.actual_amount / item.planned_amount) * 100)
          : item.actual_amount > 0
          ? 100
          : 0;

      let status: FilterStatus = "ON_TRACK";
      if (item.actual_amount === 0 && item.planned_amount === 0) {
        status = "UNSPENT";
      } else if (isOver) {
        status = "OVER";
      } else if (percentUsed >= 80) {
        status = "WARNING";
      } else if (item.actual_amount === 0) {
        status = "UNSPENT";
      }

      return {
        ...item,
        category: cat,
        percentUsed,
        isOver,
        status,
      };
    });

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (it) =>
          it.category?.name.toLowerCase().includes(q) ||
          it.category?.slug.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== "ALL") {
      list = list.filter((it) => it.status === statusFilter);
    }

    // Sort
    list.sort((a, b) => {
      let comparison = 0;
      if (sortField === "NAME") {
        comparison = (a.category?.name || "").localeCompare(b.category?.name || "");
      } else if (sortField === "PLANNED") {
        comparison = a.planned_amount - b.planned_amount;
      } else if (sortField === "ACTUAL") {
        comparison = a.actual_amount - b.actual_amount;
      } else if (sortField === "REMAINING") {
        comparison = a.remaining_amount - b.remaining_amount;
      } else if (sortField === "PERCENT") {
        comparison = a.percentUsed - b.percentUsed;
      }
      return sortDirection === "ASC" ? comparison : -comparison;
    });

    return list;
  }, [budget?.items, categories, searchQuery, statusFilter, sortField, sortDirection]);

  // Overall Donut Gauge Chart Options
  const overallGaugeOptions = useMemo(() => {
    const isOver = totalActualExpenses > totalPlannedExpenses && totalPlannedExpenses > 0;
    const spentColor = isOver ? "#ef4444" : overallPercentSpent > 80 ? "#f59e0b" : "#10b981";
    const remainingVal = Math.max(0, totalPlannedExpenses - totalActualExpenses);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: "{b}: <b>${c}</b> ({d}%)",
      },
      series: [
        {
          name: "Budget Burn",
          type: "pie",
          radius: ["65%", "85%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: "#0f172a",
            borderWidth: 3,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: false,
            },
          },
          data: [
            {
              value: Number(totalActualExpenses.toFixed(2)),
              name: "Actual Spent",
              itemStyle: { color: spentColor },
            },
            {
              value: Number(remainingVal.toFixed(2)),
              name: "Remaining Target",
              itemStyle: { color: "#334155" },
            },
          ],
        },
      ],
    };
  }, [totalActualExpenses, totalPlannedExpenses, overallPercentSpent]);

  // Category Target vs Actual Comparison Bar Chart Options
  const categoryBarChartOptions = useMemo(() => {
    const rawItems = (budget?.items || [])
      .map((it) => {
        const cat = categories.find((c) => c.id === it.category_id);
        return {
          name: cat?.name || "Other",
          color: cat?.color || "#6366f1",
          planned: it.planned_amount,
          actual: it.actual_amount,
          percent: it.planned_amount > 0 ? (it.actual_amount / it.planned_amount) * 100 : 0,
        };
      })
      .filter((it) => it.planned > 0 || it.actual > 0);

    // Sort by highest actual spend
    rawItems.sort((a, b) => b.actual - a.actual);
    const displayItems = chartMode === "top8" ? rawItems.slice(0, 8) : rawItems;

    // Reverse for horizontal bottom-up display
    const names = displayItems.map((i) => i.name).reverse();
    const plannedData = displayItems.map((i) => i.planned).reverse();
    const actualData = displayItems.map((i) => i.actual).reverse();

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any) => {
          let str = `<b>${params[0].name}</b><br/>`;
          params.forEach((p: any) => {
            str += `${p.marker} ${p.seriesName}: <b>$${Number(p.value).toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}</b><br/>`;
          });
          return str;
        },
      },
      legend: {
        data: ["Target (Planned)", "Actual Spent"],
        textStyle: { color: "#94a3b8", fontSize: 11 },
        top: 0,
        right: 10,
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
        top: "30px",
        containLabel: true,
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          fontSize: 10,
          formatter: (v: number) => `$${v}`,
        },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLabel: {
          color: "#cbd5e1",
          fontSize: 11,
          formatter: (value: string) =>
            value.length > 18 ? `${value.substring(0, 18)}...` : value,
        },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      series: [
        {
          name: "Target (Planned)",
          type: "bar",
          data: plannedData,
          itemStyle: {
            color: "#475569",
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 14,
        },
        {
          name: "Actual Spent",
          type: "bar",
          data: actualData,
          itemStyle: {
            color: (params: any) => {
              const idx = displayItems.length - 1 - params.dataIndex;
              const it = displayItems[idx];
              if (it && it.actual > it.planned && it.planned > 0) {
                return "#f43f5e"; // Rose overspent
              }
              return it?.color || "#6366f1";
            },
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 14,
        },
      ],
    };
  }, [budget?.items, categories, chartMode]);

  // Unbudgeted expense categories available to add
  const unbudgetedCategories = useMemo(() => {
    const existingCatIds = new Set((budget?.items || []).map((it) => it.category_id));
    return categories.filter(
      (c) => c.type === "EXPENSE" && (!existingCatIds.has(c.id) || !c.is_budgeted)
    );
  }, [categories, budget?.items]);

  const parentCategories = useMemo(() => {
    return categories.filter((c) => !c.parent_id);
  }, [categories]);

  const statusCounts = useMemo(() => {
    const list = budget?.items || [];
    let over = 0;
    let warning = 0;
    let onTrack = 0;
    let unspent = 0;

    list.forEach((it) => {
      if (it.actual_amount === 0 && it.planned_amount === 0) unspent++;
      else if (it.actual_amount > it.planned_amount && it.planned_amount > 0) over++;
      else if (it.planned_amount > 0 && it.actual_amount / it.planned_amount >= 0.8) warning++;
      else if (it.actual_amount === 0) unspent++;
      else onTrack++;
    });

    return { total: list.length, over, warning, onTrack, unspent };
  }, [budget?.items]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Month Navigator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <PiggyBank className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              Monthly Budget & Expense Envelopes
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Set monthly spending ceilings, visualize burn pace, and track live category actuals.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {/* Add Category Button */}
          <button
            onClick={() => {
              setIsAddModalOpen(true);
              if (unbudgetedCategories.length > 0) {
                setSelectedExistingCatId(unbudgetedCategories[0].id);
              }
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Category</span>
          </button>

          {/* Month Switcher */}
          <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700/80 shadow-inner">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-200 px-3.5 min-w-[130px] text-center">
              {monthName}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Analytics Graphics & Burn Rate Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Burn Rate & Radial Gauge Card */}
        <div className="lg:col-span-4 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Overall Budget Health
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  overallPercentSpent > 100
                    ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                    : overallPercentSpent > monthElapsedPercent
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {overallPercentSpent > 100
                  ? "Over Budget"
                  : overallPercentSpent > monthElapsedPercent
                  ? "Over Pace"
                  : "On Track"}
              </span>
            </div>

            {/* Gauge and Central Numbers */}
            <div className="relative h-44 my-2 flex items-center justify-center">
              <ReactECharts
                option={overallGaugeOptions}
                style={{ height: "100%", width: "100%" }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-slate-100">
                  {overallPercentSpent}%
                </span>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  Used
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-slate-800/80 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Month Timeline:</span>
              <span className="text-slate-200 font-medium">
                Day {currentDay} of {daysInMonth} ({monthElapsedPercent}%)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Daily Allowance:</span>
              <span className="text-emerald-400 font-bold font-mono">
                ${dailySafeSpend.toFixed(2)} / day
              </span>
            </div>
          </div>
        </div>

        {/* Category Breakdown Bar Chart */}
        <div className="lg:col-span-8 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-xl flex flex-col">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Category Spending vs. Target Comparison
              </span>
            </div>
            <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700/60 text-[11px]">
              <button
                onClick={() => setChartMode("top8")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  chartMode === "top8"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Top Spenders
              </button>
              <button
                onClick={() => setChartMode("all")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  chartMode === "all"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-[220px]">
            {budget?.items && budget.items.length > 0 ? (
              <ReactECharts
                option={categoryBarChartOptions}
                style={{ height: "100%", width: "100%" }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">
                No budget targets or expenses recorded for this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium uppercase">Total Planned Target</span>
            <DollarSign className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-100 font-mono">
            ${totalPlannedExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Sum of all category targets</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium uppercase">Actual Spent So Far</span>
            <TrendingDown className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-400 font-mono">
            ${totalActualExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {totalPlannedExpenses > 0
              ? `${overallPercentSpent}% of total planned envelope`
              : "No target set"}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium uppercase">Remaining Cushion</span>
            <TrendingUp
              className={`w-4 h-4 ${remainingBudget >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            />
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono ${
              remainingBudget >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            ${remainingBudget.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {remainingBudget >= 0 ? "Within budget parameters" : "Over total planned budget"}
          </div>
        </div>
      </div>

      {/* Main Budget Ledger Section */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden shadow-2xl backdrop-blur-sm">
        {/* Controls Toolbar: Search, Filters, View Mode Toggle */}
        <div className="p-5 border-b border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Filter Pills */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                statusFilter === "ALL"
                  ? "bg-slate-700 text-white shadow"
                  : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              All ({statusCounts.total})
            </button>
            {statusCounts.over > 0 && (
              <button
                onClick={() => setStatusFilter("OVER")}
                className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                  statusFilter === "OVER"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                    : "bg-slate-800/60 text-rose-400 hover:bg-slate-800"
                }`}
              >
                Over ({statusCounts.over})
              </button>
            )}
            {statusCounts.warning > 0 && (
              <button
                onClick={() => setStatusFilter("WARNING")}
                className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                  statusFilter === "WARNING"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : "bg-slate-800/60 text-amber-400 hover:bg-slate-800"
                }`}
              >
                Near Limit ({statusCounts.warning})
              </button>
            )}
            <button
              onClick={() => setStatusFilter("ON_TRACK")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                statusFilter === "ON_TRACK"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-slate-800/60 text-emerald-400 hover:bg-slate-800"
              }`}
            >
              On Track ({statusCounts.onTrack})
            </button>
            <button
              onClick={() => setStatusFilter("UNSPENT")}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                statusFilter === "UNSPENT"
                  ? "bg-slate-700 text-slate-200"
                  : "bg-slate-800/60 text-slate-400 hover:bg-slate-800"
              }`}
            >
              Unspent ({statusCounts.unspent})
            </button>
          </div>

          {/* Search & Layout Switcher */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-700/80 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 w-48 sm:w-56"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Desktop / Mobile View Mode Switcher */}
            <div className="flex items-center bg-slate-800 p-0.5 rounded-xl border border-slate-700/60">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === "table"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Tabular Ledger (Desktop view)"
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === "cards"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Envelope Cards (Mobile view)"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        {isLoading ? (
          <div className="py-20 text-center text-slate-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto mb-3"></div>
            Loading monthly budget ledger...
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-16 text-center text-slate-400 px-4">
            <PiggyBank className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <div className="text-sm font-semibold text-slate-200">No matching budget categories</div>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Add your first budget target or clear active search filters to view your envelopes.
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              Add Category Target
            </button>
          </div>
        ) : viewMode === "table" ? (
          /* High-Density Tabular Ledger for Desktop */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 uppercase tracking-wider font-semibold">
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-slate-200"
                    onClick={() => {
                      if (sortField === "NAME") setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
                      else {
                        setSortField("NAME");
                        setSortDirection("ASC");
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Category</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th className="py-3.5 px-3">Status</th>
                  <th
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-200"
                    onClick={() => {
                      if (sortField === "PLANNED") setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
                      else {
                        setSortField("PLANNED");
                        setSortDirection("DESC");
                      }
                    }}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Target (Planned)</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-200"
                    onClick={() => {
                      if (sortField === "ACTUAL") setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
                      else {
                        setSortField("ACTUAL");
                        setSortDirection("DESC");
                      }
                    }}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Actual Spent</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-slate-200"
                    onClick={() => {
                      if (sortField === "REMAINING") setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
                      else {
                        setSortField("REMAINING");
                        setSortDirection("ASC");
                      }
                    }}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Remaining</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    className="py-3.5 px-4 w-48 cursor-pointer hover:text-slate-200"
                    onClick={() => {
                      if (sortField === "PERCENT") setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
                      else {
                        setSortField("PERCENT");
                        setSortDirection("DESC");
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Envelope Burn</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredAndSortedItems.map((item) => {
                  const cat = item.category;
                  if (!cat) return null;
                  const isEditing = editingTargetId === item.category_id;
                  const parentCat = categories.find((c) => c.id === cat.parent_id);

                  return (
                    <tr
                      key={item.category_id}
                      className="hover:bg-slate-800/40 transition-colors group"
                    >
                      {/* Category Name & Parent Group */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: cat.color || "#6366f1" }}
                          ></span>
                          <div>
                            <div className="font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                              {cat.name}
                            </div>
                            {parentCat && (
                              <div className="text-[10px] text-slate-400 font-medium">
                                {parentCat.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                            item.isOver
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              : item.percentUsed >= 80
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : item.actual_amount === 0
                              ? "bg-slate-800 text-slate-400"
                              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {item.isOver
                            ? "Over Limit"
                            : item.percentUsed >= 80
                            ? "Near Limit"
                            : item.actual_amount === 0
                            ? "Unspent"
                            : "On Track"}
                        </span>
                      </td>

                      {/* Target Planned (Inline Editable) */}
                      <td className="py-3 px-4 text-right font-mono">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-slate-400">$</span>
                            <input
                              type="number"
                              step="10"
                              value={targetInput}
                              onChange={(e) => setTargetInput(parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSavePlannedAmount(item.category_id, targetInput);
                                if (e.key === "Escape") setEditingTargetId(null);
                              }}
                              autoFocus
                              className="w-20 px-1.5 py-0.5 bg-slate-950 border border-indigo-500 rounded text-slate-100 text-xs font-mono text-right"
                            />
                            <button
                              onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                              className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                              title="Save Target"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingTargetId(null)}
                              className="p-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200"
                              title="Cancel"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              setEditingTargetId(item.category_id);
                              setTargetInput(item.planned_amount);
                            }}
                            className="cursor-pointer hover:text-indigo-400 flex items-center justify-end gap-1.5 group/edit"
                            title="Click to edit target"
                          >
                            <span className="font-semibold text-slate-200">
                              ${item.planned_amount.toFixed(2)}
                            </span>
                            <Edit2 className="w-3 h-3 text-slate-500 opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>

                      {/* Actual Spent */}
                      <td className="py-3 px-4 text-right font-mono">
                        <span className="font-semibold text-rose-300">
                          ${item.actual_amount.toFixed(2)}
                        </span>
                        <div className="text-[10px] text-slate-400 font-sans">
                          {item.percentUsed}%
                        </div>
                      </td>

                      {/* Remaining */}
                      <td className="py-3 px-4 text-right font-mono">
                        <span
                          className={`font-semibold ${
                            item.remaining_amount >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {item.remaining_amount >= 0
                            ? `$${item.remaining_amount.toFixed(2)}`
                            : `-$${Math.abs(item.remaining_amount).toFixed(2)}`}
                        </span>
                      </td>

                      {/* Progress Bar Meter */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.isOver
                                  ? "bg-rose-500"
                                  : item.percentUsed >= 80
                                  ? "bg-amber-400"
                                  : "bg-emerald-400"
                              }`}
                              style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenDrilldown(cat)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors"
                            title="View category transactions"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                            title="Remove category target from budget"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Touch-Friendly Card / Envelope View for Mobile & Tablet */
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedItems.map((item) => {
              const cat = item.category;
              if (!cat) return null;
              const isEditing = editingTargetId === item.category_id;

              return (
                <div
                  key={item.category_id}
                  className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50 space-y-3 shadow-md flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color || "#6366f1" }}
                      ></span>
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{cat.name}</div>
                        <span
                          className={`mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold inline-block ${
                            item.isOver
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : item.percentUsed >= 80
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {item.isOver ? "Over Budget" : `${item.percentUsed}% Spent`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenDrilldown(cat)}
                        className="p-1 text-slate-400 hover:text-indigo-400"
                        title="View transactions"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                        className="p-1 text-slate-400 hover:text-rose-400"
                        title="Remove category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Numbers */}
                  <div className="space-y-1.5 text-xs font-mono">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Spent:</span>
                      <span className="font-bold text-rose-300">
                        ${item.actual_amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Target:</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span>$</span>
                          <input
                            type="number"
                            step="10"
                            value={targetInput}
                            onChange={(e) => setTargetInput(parseFloat(e.target.value) || 0)}
                            className="w-16 px-1 py-0.5 bg-slate-900 border border-indigo-500 rounded text-slate-100 text-xs font-mono text-right"
                          />
                          <button
                            onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                            className="p-1 rounded bg-indigo-600 text-white"
                          >
                            <Save className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTargetId(item.category_id);
                            setTargetInput(item.planned_amount);
                          }}
                          className="font-bold text-slate-200 hover:text-indigo-400 flex items-center gap-1"
                        >
                          <span>${item.planned_amount.toFixed(2)}</span>
                          <Edit2 className="w-3 h-3 text-slate-500" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                      <span className="text-slate-400">Remaining:</span>
                      <span
                        className={`font-bold ${
                          item.remaining_amount >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {item.remaining_amount >= 0
                          ? `$${item.remaining_amount.toFixed(2)}`
                          : `-$${Math.abs(item.remaining_amount).toFixed(2)}`}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-700/60">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        item.isOver
                          ? "bg-rose-500"
                          : item.percentUsed >= 80
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                      }`}
                      style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* ADD / CREATE CATEGORY MODAL                                   */}
      {/* ------------------------------------------------------------- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">Add Category to Budget</h3>
                  <p className="text-xs text-slate-400">
                    Configure a monthly spending envelope for {monthName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex border-b border-slate-800 bg-slate-950/40 p-1.5 gap-2 text-xs">
              <button
                onClick={() => setAddModalTab("existing")}
                className={`flex-1 py-2 rounded-xl font-semibold transition-all ${
                  addModalTab === "existing"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Existing Category ({unbudgetedCategories.length})
              </button>
              <button
                onClick={() => setAddModalTab("new")}
                className={`flex-1 py-2 rounded-xl font-semibold transition-all ${
                  addModalTab === "new"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                + Create New Category
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {addModalTab === "existing" ? (
                /* Tab 1: Pick Existing Category */
                <div className="space-y-4">
                  {unbudgetedCategories.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      All existing expense categories are already in your budget. Switch to "Create
                      New Category" to add a new one.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Select Category
                        </label>
                        <select
                          value={selectedExistingCatId}
                          onChange={(e) => setSelectedExistingCatId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                        >
                          {unbudgetedCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Monthly Planned Target ($)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={existingCatTarget}
                            onChange={(e) => setExistingCatTarget(parseFloat(e.target.value) || 0)}
                            className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                /* Tab 2: Create Brand New Category */
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Category Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Pet Care, Gym & Fitness, House Cleaning"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Parent Group (Optional)
                    </label>
                    <select
                      value={newCatParentId}
                      onChange={(e) => setNewCatParentId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">-- No Parent (Top-Level Category) --</option>
                      {parentCategories.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Category Color
                    </label>
                    <div className="flex items-center flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewCatColor(color)}
                          className={`w-6 h-6 rounded-full transition-transform ${
                            newCatColor === color
                              ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-slate-900"
                              : "hover:scale-110 opacity-80"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Monthly Planned Target ($)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={newCatTarget}
                        onChange={(e) => setNewCatTarget(parseFloat(e.target.value) || 0)}
                        className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={
                  addModalTab === "existing"
                    ? handleAddExistingCategory
                    : handleCreateNewCategory
                }
                disabled={
                  isSubmittingCat ||
                  (addModalTab === "existing" && !selectedExistingCatId) ||
                  (addModalTab === "new" && !newCatName.trim())
                }
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 flex items-center gap-2"
              >
                {isSubmittingCat && (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                )}
                <span>
                  {addModalTab === "existing" ? "Add to Budget" : "Create & Add to Budget"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TRANSACTION DRILLDOWN MODAL                                   */}
      {/* ------------------------------------------------------------- */}
      {drilldownCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: drilldownCategory.color || "#6366f1" }}
                ></span>
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    {drilldownCategory.name} Transactions
                  </h3>
                  <p className="text-xs text-slate-400">
                    Actual charges in {monthName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrilldownCategory(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Transaction List */}
            <div className="p-5 flex-1 overflow-y-auto space-y-2">
              {isLoadingTransactions ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mx-auto mb-2"></div>
                  Fetching matching transactions...
                </div>
              ) : drilldownTransactions.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No transactions recorded for {drilldownCategory.name} in {monthName}.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-slate-400 font-semibold mb-2">
                    {drilldownTransactions.length} transaction(s) recorded:
                  </div>
                  {drilldownTransactions.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-200">
                          {t.normalized_payee || t.raw_payee}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {t.transaction_date} • {t.raw_payee}
                        </div>
                      </div>
                      <div className="font-bold font-mono text-rose-300 text-sm">
                        ${Math.abs(t.amount).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end">
              <button
                onClick={() => setDrilldownCategory(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
