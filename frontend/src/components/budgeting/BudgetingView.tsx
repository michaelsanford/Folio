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
import { LazyChart } from "../common/LazyChart";
import { useChartTheme } from "../../hooks/useChartTheme";
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
  "#10B981", // Emerald
  "#059669", // Dark Emerald
  "#F59E0B", // Amber
  "#EF4444", // Rose
  "#3B82F6", // Blue
  "#06B6D4", // Cyan
  "#14B8A6", // Teal
  "#F97316", // Orange
  "#64748B", // Slate
  "#8B5CF6", // Purple
  "#EC4899", // Pink
];

export const BudgetingView: React.FC<BudgetingViewProps> = ({
  categories,
  onCategoriesModified,
}) => {
  const chartTheme = useChartTheme();

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
    } catch (err) {
      console.error("Failed to load budget:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBudget();
  }, [year, month]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
  };

  // Inline Planned Amount Update
  const handleSavePlannedAmount = async (categoryId: string, plannedAmount: number) => {
    try {
      await api.upsertBudgetItem(year, month, {
        category_id: categoryId,
        planned_amount: plannedAmount,
      });
      setEditingTargetId(null);
      await loadBudget();
    } catch (err: any) {
      alert(`Failed to update budget target: ${err.message}`);
    }
  };

  // Add existing category to budget
  const handleAddExistingCategory = async () => {
    if (!selectedExistingCatId) return;
    setIsSubmittingCat(true);
    try {
      await api.upsertBudgetItem(year, month, {
        category_id: selectedExistingCatId,
        planned_amount: existingCatTarget,
      });
      setIsAddModalOpen(false);
      await loadBudget();
      if (onCategoriesModified) onCategoriesModified();
    } catch (err: any) {
      alert(`Failed to add category to budget: ${err.message}`);
    } finally {
      setIsSubmittingCat(false);
    }
  };

  // Create brand new category and budget it
  const handleCreateNewCategory = async () => {
    if (!newCatName.trim()) return;
    setIsSubmittingCat(true);
    try {
      const created = await api.createCategory({
        name: newCatName.trim(),
        type: "EXPENSE",
        parent_id: newCatParentId || null,
        color: newCatColor,
        is_budgeted: true,
      });

      await api.upsertBudgetItem(year, month, {
        category_id: created.id,
        planned_amount: newCatTarget,
      });

      setIsAddModalOpen(false);
      setNewCatName("");
      setNewCatParentId("");
      await loadBudget();
      if (onCategoriesModified) onCategoriesModified();
    } catch (err: any) {
      alert(`Failed to create category: ${err.message}`);
    } finally {
      setIsSubmittingCat(false);
    }
  };

  // Delete category from budget
  const handleRemoveCategoryFromBudget = async (categoryId: string) => {
    if (!confirm("Are you sure you want to remove this target from your monthly budget?")) return;
    try {
      if (budget?.id) {
        await api.deleteBudgetItem(budget.id, categoryId);
      } else {
        await api.upsertBudgetItem(year, month, {
          category_id: categoryId,
          planned_amount: 0,
        });
      }
      await loadBudget();
    } catch (err: any) {
      alert(`Failed to remove category: ${err.message}`);
    }
  };

  // Drilldown to transactions
  const handleOpenDrilldown = async (cat: Category) => {
    setDrilldownCategory(cat);
    setIsLoadingTransactions(true);
    try {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      const res = await api.getTransactions({
        category_id: cat.id,
        start_date: startDate,
        end_date: endDate,
        page_size: 100,
      });
      setDrilldownTransactions(res.items);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  // KPI Computations
  const totalPlannedExpenses = budget?.total_expense_target || 0;
  const totalActualExpenses = budget?.total_actual_expense || 0;
  const remainingBudget = totalPlannedExpenses - totalActualExpenses;
  const overallPercentSpent =
    totalPlannedExpenses > 0
      ? Math.round((totalActualExpenses / totalPlannedExpenses) * 100)
      : 0;

  const daysRemaining = Math.max(1, daysInMonth - currentDay);
  const dailySafeSpend = Math.max(0, remainingBudget / daysRemaining);

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
    const spentColor = isOver ? chartTheme.negativeColor : overallPercentSpent > 80 ? "#f59e0b" : chartTheme.positiveColor;
    const remainingVal = Math.max(0, totalPlannedExpenses - totalActualExpenses);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        formatter: "{b}: <b>${c}</b> ({d}%)",
      },
      series: [
        {
          name: "Budget Burn",
          type: "pie",
          radius: ["65%", "85%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: chartTheme.tooltipBg,
            borderWidth: 2,
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
              name: "Remaining Cushion",
              itemStyle: { color: chartTheme.gridLineColor },
            },
          ],
        },
      ],
    };
  }, [totalActualExpenses, totalPlannedExpenses, overallPercentSpent, chartTheme]);

  // Category Target vs Actual Comparison Bar Chart Options
  const categoryBarChartOptions = useMemo(() => {
    const rawItems = (budget?.items || [])
      .map((it) => {
        const cat = categories.find((c) => c.id === it.category_id);
        return {
          name: cat?.name || "Other",
          color: cat?.color || chartTheme.accentColor,
          planned: it.planned_amount,
          actual: it.actual_amount,
          percent: it.planned_amount > 0 ? (it.actual_amount / it.planned_amount) * 100 : 0,
        };
      })
      .filter((it) => it.planned > 0 || it.actual > 0);

    rawItems.sort((a, b) => b.actual - a.actual);
    const displayItems = chartMode === "top8" ? rawItems.slice(0, 8) : rawItems;

    const names = displayItems.map((i) => i.name).reverse();
    const plannedData = displayItems.map((i) => i.planned).reverse();
    const actualData = displayItems.map((i) => i.actual).reverse();

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        formatter: (params: any[]) => {
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
        textStyle: { color: chartTheme.textColor, fontSize: 11 },
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
          color: chartTheme.subtleTextColor,
          fontSize: 10,
          formatter: (v: number) => `$${v}`,
        },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLabel: {
          color: chartTheme.textColor,
          fontSize: 11,
          formatter: (value: string) =>
            value.length > 18 ? `${value.substring(0, 18)}...` : value,
        },
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
      },
      series: [
        {
          name: "Target (Planned)",
          type: "bar",
          data: plannedData,
          itemStyle: {
            color: chartTheme.neutralColor,
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
                return chartTheme.negativeColor;
              }
              return it?.color || chartTheme.accentColor;
            },
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 14,
        },
      ],
    };
  }, [budget?.items, categories, chartMode, chartTheme]);

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-surface border border-default shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-accent-subtle border border-accent-main/30 text-accent-subtle">
            <PiggyBank className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-main flex items-center gap-2">
              Monthly Budget & Expense Envelopes
            </h1>
            <p className="text-xs text-muted mt-0.5">
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
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Category</span>
          </button>

          {/* Month Switcher */}
          <div className="flex items-center bg-surface-subtle p-1 rounded-xl border border-default">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold font-mono text-main px-3.5 min-w-[130px] text-center">
              {monthName}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface transition-colors cursor-pointer"
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
        <div className="lg:col-span-4 p-6 rounded-2xl bg-surface border border-default shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Overall Budget Health
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                  overallPercentSpent > 100
                    ? "bg-negative-subtle text-negative border border-rose-500/30"
                    : overallPercentSpent > monthElapsedPercent
                    ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                    : "bg-positive-subtle text-positive border border-emerald-500/30"
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
              <LazyChart option={overallGaugeOptions} className="h-full" />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black font-mono text-main">
                  {overallPercentSpent}%
                </span>
                <span className="text-[10px] font-medium text-muted uppercase tracking-wider">
                  Used
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-subtle text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Month Timeline:</span>
              <span className="text-main font-medium">
                Day {currentDay} of {daysInMonth} ({monthElapsedPercent}%)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Daily Allowance:</span>
              <span className="text-positive font-bold font-mono">
                ${dailySafeSpend.toFixed(2)} / day
              </span>
            </div>
          </div>
        </div>

        {/* Category Breakdown Bar Chart */}
        <div className="lg:col-span-8 p-6 rounded-2xl bg-surface border border-default shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent-main" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Category Spending vs. Target Comparison
              </span>
            </div>
            <div className="flex items-center gap-1 bg-surface-subtle p-0.5 rounded-lg border border-default text-[11px]">
              <button
                onClick={() => setChartMode("top8")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  chartMode === "top8"
                    ? "bg-accent-main text-accent-contrast font-semibold shadow-xs"
                    : "text-muted hover:text-main"
                }`}
              >
                Top Spenders
              </button>
              <button
                onClick={() => setChartMode("all")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  chartMode === "all"
                    ? "bg-accent-main text-accent-contrast font-semibold shadow-xs"
                    : "text-muted hover:text-main"
                }`}
              >
                All
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-[220px]">
            {budget?.items && budget.items.length > 0 ? (
              <LazyChart option={categoryBarChartOptions} className="h-full" />
            ) : (
              <div className="flex items-center justify-center h-full text-muted text-xs">
                No budget targets or expenses recorded for this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted font-semibold uppercase tracking-wider">Total Planned Target</span>
            <DollarSign className="w-4 h-4 text-accent-main" />
          </div>
          <div className="mt-2 text-2xl font-bold text-main font-mono">
            ${totalPlannedExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">Sum of all category targets</div>
        </div>

        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted font-semibold uppercase tracking-wider">Actual Spent So Far</span>
            <TrendingDown className="w-4 h-4 text-negative" />
          </div>
          <div className="mt-2 text-2xl font-bold text-negative font-mono">
            ${totalActualExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {totalPlannedExpenses > 0
              ? `${overallPercentSpent}% of total planned envelope`
              : "No target set"}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted font-semibold uppercase tracking-wider">Remaining Cushion</span>
            <TrendingUp
              className={`w-4 h-4 ${remainingBudget >= 0 ? "text-positive" : "text-negative"}`}
            />
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono ${
              remainingBudget >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            ${remainingBudget.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {remainingBudget >= 0 ? "Within budget parameters" : "Over total planned budget"}
          </div>
        </div>
      </div>

      {/* Main Budget Ledger Section */}
      <div className="rounded-2xl border border-default bg-surface overflow-hidden shadow-xs">
        {/* Controls Toolbar: Search, Filters, View Mode Toggle */}
        <div className="p-4 sm:p-5 border-b border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-subtle/50">
          {/* Status Filter Pills */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                statusFilter === "ALL"
                  ? "bg-accent-main text-accent-contrast shadow-xs"
                  : "bg-surface text-sub border border-default hover:bg-surface-hover"
              }`}
            >
              All ({statusCounts.total})
            </button>
            {statusCounts.over > 0 && (
              <button
                onClick={() => setStatusFilter("OVER")}
                className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                  statusFilter === "OVER"
                    ? "bg-negative-subtle text-negative border border-rose-500/40"
                    : "bg-surface text-negative border border-default hover:bg-surface-hover"
                }`}
              >
                Over ({statusCounts.over})
              </button>
            )}
            {statusCounts.warning > 0 && (
              <button
                onClick={() => setStatusFilter("WARNING")}
                className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                  statusFilter === "WARNING"
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/40"
                    : "bg-surface text-amber-500 border border-default hover:bg-surface-hover"
                }`}
              >
                Near Limit ({statusCounts.warning})
              </button>
            )}
            <button
              onClick={() => setStatusFilter("ON_TRACK")}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                statusFilter === "ON_TRACK"
                  ? "bg-positive-subtle text-positive border border-emerald-500/40"
                  : "bg-surface text-positive border border-default hover:bg-surface-hover"
              }`}
            >
              On Track ({statusCounts.onTrack})
            </button>
            <button
              onClick={() => setStatusFilter("UNSPENT")}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                statusFilter === "UNSPENT"
                  ? "bg-surface-subtle text-main border border-default"
                  : "bg-surface text-muted border border-default hover:bg-surface-hover"
              }`}
            >
              Unspent ({statusCounts.unspent})
            </button>
          </div>

          {/* Search & Layout Switcher */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl bg-input border border-default text-main text-xs focus:outline-hidden focus:border-accent-main w-48 sm:w-56"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-main"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Desktop / Mobile View Mode Switcher */}
            <div className="flex items-center bg-surface-subtle p-0.5 rounded-xl border border-default">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === "table"
                    ? "bg-accent-main text-accent-contrast shadow-xs"
                    : "text-muted hover:text-main"
                }`}
                title="Tabular Ledger (Desktop view)"
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-accent-main text-accent-contrast shadow-xs"
                    : "text-muted hover:text-main"
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
          <div className="py-20 text-center text-muted">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main mx-auto mb-3"></div>
            Loading monthly budget ledger...
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-16 text-center text-muted px-4">
            <PiggyBank className="w-12 h-12 text-muted mx-auto mb-3 opacity-40" />
            <div className="text-sm font-semibold text-main">No matching budget categories</div>
            <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
              Add your first budget target or clear active search filters to view your envelopes.
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer"
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
                <tr className="border-b border-subtle bg-surface-subtle text-muted uppercase tracking-wider font-semibold">
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-main"
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
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-main"
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
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-main"
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
                    className="py-3.5 px-4 text-right cursor-pointer hover:text-main"
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
                    className="py-3.5 px-4 w-48 cursor-pointer hover:text-main"
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
              <tbody className="divide-y divide-subtle font-sans">
                {filteredAndSortedItems.map((item) => {
                  const cat = item.category;
                  if (!cat) return null;
                  const isEditing = editingTargetId === item.category_id;
                  const parentCat = categories.find((c) => c.id === cat.parent_id);

                  return (
                    <tr
                      key={item.category_id}
                      className="hover:bg-surface-hover transition-colors group"
                    >
                      {/* Category Name & Parent Group */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                            style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                          ></span>
                          <div>
                            <div className="font-semibold text-main">
                              {cat.name}
                            </div>
                            {parentCat && (
                              <div className="text-[10px] text-muted font-medium">
                                {parentCat.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-mono inline-flex items-center gap-1 ${
                            item.isOver
                              ? "bg-negative-subtle text-negative border border-rose-500/30"
                              : item.percentUsed >= 80
                              ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                              : item.actual_amount === 0
                              ? "bg-surface-subtle text-muted"
                              : "bg-positive-subtle text-positive border border-emerald-500/30"
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
                            <span className="text-muted">$</span>
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
                              className="w-20 px-1.5 py-0.5 bg-input border border-accent-main rounded text-main text-xs font-mono text-right"
                            />
                            <button
                              onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                              className="p-1 rounded bg-accent-main text-accent-contrast cursor-pointer"
                              title="Save Target"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingTargetId(null)}
                              className="p-1 rounded bg-surface text-muted hover:text-main cursor-pointer"
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
                            className="cursor-pointer hover:text-accent-main flex items-center justify-end gap-1.5 group/edit"
                            title="Click to edit target"
                          >
                            <span className="font-semibold text-main">
                              ${item.planned_amount.toFixed(2)}
                            </span>
                            <Edit2 className="w-3 h-3 text-muted opacity-0 group-hover/edit:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>

                      {/* Actual Spent */}
                      <td className="py-3 px-4 text-right font-mono">
                        <span className="font-semibold text-main">
                          ${item.actual_amount.toFixed(2)}
                        </span>
                        <div className="text-[10px] text-muted font-sans">
                          {item.percentUsed}%
                        </div>
                      </td>

                      {/* Remaining */}
                      <td className="py-3 px-4 text-right font-mono">
                        <span
                          className={`font-semibold ${
                            item.remaining_amount >= 0 ? "text-positive" : "text-negative"
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
                          <div className="w-full h-2 rounded-full bg-surface-subtle overflow-hidden border border-default">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.isOver
                                  ? "bg-rose-500"
                                  : item.percentUsed >= 80
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
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
                            className="p-1.5 rounded-lg text-muted hover:text-accent-main hover:bg-surface transition-colors cursor-pointer"
                            title="View category transactions"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                            className="p-1.5 rounded-lg text-muted hover:text-negative hover:bg-negative-subtle transition-colors cursor-pointer"
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
          <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedItems.map((item) => {
              const cat = item.category;
              if (!cat) return null;
              const isEditing = editingTargetId === item.category_id;

              return (
                <div
                  key={item.category_id}
                  className="p-4 rounded-2xl bg-surface-subtle border border-subtle space-y-3 shadow-xs flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                      ></span>
                      <div>
                        <div className="text-sm font-semibold text-main">{cat.name}</div>
                        <span
                          className={`mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold font-mono inline-block ${
                            item.isOver
                              ? "bg-negative-subtle text-negative border border-rose-500/30"
                              : item.percentUsed >= 80
                              ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                              : "bg-positive-subtle text-positive border border-emerald-500/30"
                          }`}
                        >
                          {item.isOver ? "Over Budget" : `${item.percentUsed}% Spent`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenDrilldown(cat)}
                        className="p-1 text-muted hover:text-accent-main cursor-pointer"
                        title="View transactions"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                        className="p-1 text-muted hover:text-negative cursor-pointer"
                        title="Remove category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Numbers */}
                  <div className="space-y-1.5 text-xs font-mono">
                    <div className="flex items-center justify-between text-muted">
                      <span>Spent:</span>
                      <span className="font-bold text-main">
                        ${item.actual_amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted">Target:</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span>$</span>
                          <input
                            type="number"
                            step="10"
                            value={targetInput}
                            onChange={(e) => setTargetInput(parseFloat(e.target.value) || 0)}
                            className="w-16 px-1 py-0.5 bg-input border border-accent-main rounded text-main text-xs font-mono text-right"
                          />
                          <button
                            onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                            className="p-1 rounded bg-accent-main text-accent-contrast cursor-pointer"
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
                          className="font-bold text-main hover:text-accent-main flex items-center gap-1 cursor-pointer"
                        >
                          <span>${item.planned_amount.toFixed(2)}</span>
                          <Edit2 className="w-3 h-3 text-muted" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-subtle">
                      <span className="text-muted">Remaining:</span>
                      <span
                        className={`font-bold ${
                          item.remaining_amount >= 0 ? "text-positive" : "text-negative"
                        }`}
                      >
                        {item.remaining_amount >= 0
                          ? `$${item.remaining_amount.toFixed(2)}`
                          : `-$${Math.abs(item.remaining_amount).toFixed(2)}`}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-2 rounded-full bg-surface overflow-hidden border border-default">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        item.isOver
                          ? "bg-rose-500"
                          : item.percentUsed >= 80
                          ? "bg-amber-400"
                          : "bg-emerald-500"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface border border-default rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-5 border-b border-subtle bg-surface-subtle flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-accent-subtle text-accent-subtle">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-main">Add Category to Budget</h3>
                  <p className="text-xs text-muted">
                    Configure a monthly spending envelope for {monthName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-main"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex border-b border-subtle bg-surface-subtle/50 p-1.5 gap-2 text-xs">
              <button
                onClick={() => setAddModalTab("existing")}
                className={`flex-1 py-2 rounded-xl font-semibold transition-all cursor-pointer ${
                  addModalTab === "existing"
                    ? "bg-accent-main text-accent-contrast shadow-xs"
                    : "text-muted hover:text-main"
                }`}
              >
                Existing Category ({unbudgetedCategories.length})
              </button>
              <button
                onClick={() => setAddModalTab("new")}
                className={`flex-1 py-2 rounded-xl font-semibold transition-all cursor-pointer ${
                  addModalTab === "new"
                    ? "bg-accent-main text-accent-contrast shadow-xs"
                    : "text-muted hover:text-main"
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
                    <div className="text-center py-6 text-muted text-xs">
                      All existing expense categories are already in your budget. Switch to "Create
                      New Category" to add a new one.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1.5">
                          Select Category
                        </label>
                        <select
                          value={selectedExistingCatId}
                          onChange={(e) => setSelectedExistingCatId(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-input border border-default text-main text-xs focus:outline-hidden focus:border-accent-main"
                        >
                          {unbudgetedCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-muted mb-1.5">
                          Monthly Planned Target ($)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted text-xs">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={existingCatTarget}
                            onChange={(e) => setExistingCatTarget(parseFloat(e.target.value) || 0)}
                            className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-input border border-default text-main text-xs font-mono focus:outline-hidden focus:border-accent-main"
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
                    <label className="block text-xs font-semibold text-muted mb-1.5">
                      Category Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Pet Care, Gym & Fitness, House Cleaning"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-input border border-default text-main text-xs focus:outline-hidden focus:border-accent-main"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">
                      Parent Group (Optional)
                    </label>
                    <select
                      value={newCatParentId}
                      onChange={(e) => setNewCatParentId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-input border border-default text-main text-xs focus:outline-hidden focus:border-accent-main"
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
                    <label className="block text-xs font-semibold text-muted mb-1.5">
                      Category Color
                    </label>
                    <div className="flex items-center flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewCatColor(color)}
                          className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                            newCatColor === color
                              ? "scale-125 ring-2 ring-accent-main ring-offset-2 ring-offset-surface"
                              : "hover:scale-110 opacity-80"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">
                      Monthly Planned Target ($)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted text-xs">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={newCatTarget}
                        onChange={(e) => setNewCatTarget(parseFloat(e.target.value) || 0)}
                        className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-input border border-default text-main text-xs font-mono focus:outline-hidden focus:border-accent-main"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-subtle bg-surface-subtle flex items-center justify-end gap-2.5">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-default text-sub text-xs font-semibold hover:bg-surface-hover"
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
                className="px-5 py-2 rounded-xl bg-accent-main hover:bg-accent-main disabled:opacity-50 text-accent-contrast text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-surface border border-default rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
            {/* Header */}
            <div className="p-5 border-b border-subtle bg-surface-subtle flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: drilldownCategory.color || chartTheme.accentColor }}
                ></span>
                <div>
                  <h3 className="text-base font-bold text-main">
                    {drilldownCategory.name} Transactions
                  </h3>
                  <p className="text-xs text-muted">
                    Actual charges in {monthName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrilldownCategory(null)}
                className="p-1.5 rounded-lg text-muted hover:text-main"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Transaction List */}
            <div className="p-5 flex-1 overflow-y-auto space-y-2">
              {isLoadingTransactions ? (
                <div className="py-12 text-center text-muted text-xs">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-main mx-auto mb-2"></div>
                  Fetching matching transactions...
                </div>
              ) : drilldownTransactions.length === 0 ? (
                <div className="py-12 text-center text-muted text-xs">
                  No transactions recorded for {drilldownCategory.name} in {monthName}.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-muted font-semibold mb-2">
                    {drilldownTransactions.length} transaction(s) recorded:
                  </div>
                  {drilldownTransactions.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-surface-subtle border border-subtle flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-main">
                          {t.normalized_payee || t.raw_payee}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5 font-mono">
                          {t.transaction_date} • {t.raw_payee}
                        </div>
                      </div>
                      <div className="font-bold font-mono text-main text-sm">
                        ${Math.abs(t.amount).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-subtle bg-surface-subtle flex justify-end">
              <button
                onClick={() => setDrilldownCategory(null)}
                className="px-4 py-2 rounded-xl border border-default text-sub text-xs font-semibold hover:bg-surface-hover cursor-pointer"
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
