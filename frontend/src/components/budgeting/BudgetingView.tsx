import React, { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
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
  RefreshCw,
} from "lucide-react";
import { LazyChart } from "../common/LazyChart";
import { Money } from "../common/Money";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact } from "../../utils/format";
import { CashFlowForecastView } from "./CashFlowForecastView";
import type { Budget, BudgetItem, Category, Transaction } from "../../types";
import { api } from "../../services/api";

interface BudgetingViewProps {
  categories: Category[];
  onCategoriesModified?: () => void;
}

type FilterStatus = "ALL" | "OVER" | "WARNING" | "ON_TRACK" | "UNSPENT";
type SortField = "NAME" | "PLANNED" | "ACTUAL" | "REMAINING" | "PERCENT";
type SortDirection = "ASC" | "DESC";

const card = "rounded-xl bg-surface border border-subtle";
const mono = "IBM Plex Mono, ui-monospace, monospace";
const iconButton =
  "h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer";
const primaryButton =
  "h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-50";
const secondaryButton =
  "h-9 px-4 inline-flex items-center justify-center rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer";
const inputClass =
  "w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";
const segmentTrack = "flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-subtle border border-default";
const segmentButton = (active: boolean) =>
  `h-7 px-3 rounded-md text-xs transition-colors cursor-pointer ${
    active ? "bg-surface text-main" : "text-muted hover:text-main"
  }`;

/** Reads a CSS custom property so ECharts can use theme tokens it has no slot for. */
const readCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

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
  const [budgetSubTab, setBudgetSubTab] = useState<"ledger" | "forecast">("ledger");
  const [newCatIsRollover, setNewCatIsRollover] = useState(true);
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

  const handleToggleCategoryRollover = async (cat: Category) => {
    try {
      await api.updateCategory(cat.id, {
        is_rollover: !cat.is_rollover,
      });
      if (onCategoriesModified) onCategoriesModified();
      await loadBudget();
    } catch (err: any) {
      alert("Failed to toggle category rollover: " + err?.message);
    }
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
        is_rollover: newCatIsRollover,
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
    if (!confirm("Remove this target from your monthly budget?")) return;
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

  // The chart theme has no warning slot; read the CSS token once the theme attribute has applied.
  const [warningColor, setWarningColor] = useState(() => readCssVar("--fin-warning", "#e5a83b"));
  useEffect(() => {
    const id = requestAnimationFrame(() => setWarningColor(readCssVar("--fin-warning", "#e5a83b")));
    return () => cancelAnimationFrame(id);
  }, [chartTheme]);

  const tooltipBase = {
    backgroundColor: chartTheme.tooltipBg,
    borderColor: chartTheme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: "border-radius: 8px; box-shadow: none;",
    textStyle: { color: chartTheme.tooltipText, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
  };

  // Overall donut gauge chart options
  const overallGaugeOptions = useMemo(() => {
    const isOver = totalActualExpenses > totalPlannedExpenses && totalPlannedExpenses > 0;
    const spentColor = isOver
      ? chartTheme.negativeColor
      : overallPercentSpent > 80
      ? warningColor
      : chartTheme.positiveColor;
    const remainingVal = Math.max(0, totalPlannedExpenses - totalActualExpenses);

    return {
      backgroundColor: "transparent",
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (p: any) =>
          `${p.name}<div style="margin-top:4px;font-family:${mono}">${formatMoney(Number(p.value))} · ${p.percent}%</div>`,
      },
      series: [
        {
          name: "Budget used",
          type: "pie",
          radius: ["68%", "82%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 2,
            borderColor: chartTheme.tooltipBg,
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: { label: { show: false } },
          data: [
            {
              value: Number(totalActualExpenses.toFixed(2)),
              name: "Spent",
              itemStyle: { color: spentColor },
            },
            {
              value: Number(remainingVal.toFixed(2)),
              name: "Remaining",
              itemStyle: { color: chartTheme.gridLineColor },
            },
          ],
        },
      ],
    };
  }, [totalActualExpenses, totalPlannedExpenses, overallPercentSpent, chartTheme, warningColor]);

  // Category target vs actual comparison bar chart options
  const categoryBarChartOptions = useMemo(() => {
    const rawItems = (budget?.items || [])
      .map((it) => {
        const cat = categories.find((c) => c.id === it.category_id);
        return {
          name: cat?.name || "Other",
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
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: chartTheme.gridLineColor } },
        formatter: (params: any[]) => {
          let str = `<div style="color:${chartTheme.subtleTextColor}">${params[0].name}</div>`;
          params.forEach((p: any) => {
            str += `<div style="margin-top:4px">${p.marker} ${p.seriesName} <span style="font-family:${mono}">${formatMoney(
              Number(p.value)
            )}</span></div>`;
          });
          return str;
        },
      },
      legend: {
        data: ["Target", "Spent"],
        textStyle: { color: chartTheme.subtleTextColor, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
        top: 0,
        right: 0,
      },
      grid: { left: 8, right: 16, bottom: 8, top: 32, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: 11,
          fontFamily: mono,
          formatter: (v: number) => formatMoneyCompact(v),
        },
        splitLine: { lineStyle: { color: chartTheme.gridLineColor } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisTick: { show: false },
        axisLabel: {
          color: chartTheme.textColor,
          fontSize: 11,
          formatter: (value: string) =>
            value.length > 18 ? `${value.substring(0, 18)}…` : value,
        },
        axisLine: { lineStyle: { color: chartTheme.axisLineColor } },
      },
      series: [
        {
          name: "Target",
          type: "bar",
          data: plannedData,
          itemStyle: {
            color: chartTheme.neutralColor,
            opacity: 0.35,
            borderRadius: [0, 2, 2, 0],
          },
          barMaxWidth: 12,
        },
        {
          name: "Spent",
          type: "bar",
          data: actualData,
          itemStyle: {
            color: (params: any) => {
              const idx = displayItems.length - 1 - params.dataIndex;
              const it = displayItems[idx];
              if (it && it.actual > it.planned && it.planned > 0) {
                return chartTheme.negativeColor;
              }
              return chartTheme.accentColor;
            },
            borderRadius: [0, 2, 2, 0],
          },
          barMaxWidth: 12,
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

  /** Status chip and meter tones: over → negative, near limit → warning, under → positive. */
  const statusTone = (isOver: boolean, percentUsed: number) =>
    isOver ? "negative" : percentUsed >= 80 ? "warning" : "positive";
  const chipClass = {
    negative: "bg-negative-subtle text-negative",
    warning: "bg-warning-subtle text-warning",
    positive: "bg-positive-subtle text-positive",
  } as const;
  const meterClass = {
    negative: "bg-negative",
    warning: "bg-warning",
    positive: "bg-positive",
  } as const;

  const sortHeader = (
    field: SortField,
    label: string,
    defaultDirection: SortDirection,
    align: "left" | "right" = "left",
    extra = ""
  ) => (
    <th
      className={`h-10 px-4 font-normal cursor-pointer hover:text-main ${
        align === "right" ? "text-right" : ""
      } ${extra}`}
      onClick={() => {
        if (sortField === field) setSortDirection((d) => (d === "ASC" ? "DESC" : "ASC"));
        else {
          setSortField(field);
          setSortDirection(defaultDirection);
        }
      }}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        <span>{label}</span>
        <ArrowUpDown className="w-4 h-4 text-muted" strokeWidth={1.5} />
      </div>
    </th>
  );

  const filterButton = (
    status: FilterStatus,
    label: string,
    count: number,
    dot?: string
  ) => (
    <button
      onClick={() => setStatusFilter(status)}
      className={`h-8 px-3 inline-flex items-center gap-2 rounded-lg text-xs transition-colors cursor-pointer ${
        statusFilter === status
          ? "bg-surface text-main border border-default"
          : "text-sub border border-transparent hover:text-main"
      }`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span>{label}</span>
      <span className="font-mono text-muted">{count}</span>
    </button>
  );

  const overallTone =
    overallPercentSpent > 100 ? "negative" : overallPercentSpent > monthElapsedPercent ? "warning" : "positive";

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* View switcher: monthly envelopes vs cash flow forecast */}
      <div className={`${segmentTrack} w-fit`}>
        <button
          onClick={() => setBudgetSubTab("ledger")}
          className={segmentButton(budgetSubTab === "ledger")}
        >
          Monthly envelopes
        </button>
        <button
          onClick={() => setBudgetSubTab("forecast")}
          className={segmentButton(budgetSubTab === "forecast")}
        >
          Cash flow forecast
        </button>
      </div>

      {budgetSubTab === "forecast" ? (
        <CashFlowForecastView />
      ) : (
        <>
      {/* Header and month navigator */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-main">Monthly budget</h1>
          <p className="text-sm text-sub mt-1">
            Spending ceilings, burn pace and live category actuals
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => {
              setIsAddModalOpen(true);
              if (unbudgetedCategories.length > 0) {
                setSelectedExistingCatId(unbudgetedCategories[0].id);
              }
            }}
            className={primaryButton}
          >
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            <span>Add category</span>
          </button>

          {/* Month switcher */}
          <div className="flex items-center h-9 px-0.5 rounded-lg border border-default bg-surface">
            <button onClick={handlePrevMonth} className={iconButton} title="Previous month">
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-sm text-main px-2 min-w-[132px] text-center">{monthName}</span>
            <button onClick={handleNextMonth} className={iconButton} title="Next month">
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* Burn rate overview and category chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Burn rate and radial gauge card */}
        <div className={`${card} lg:col-span-4 p-6 flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium text-main">Overall budget health</h2>
              <span className={`rounded-md px-1.5 py-0.5 text-xs ${chipClass[overallTone]}`}>
                {overallPercentSpent > 100
                  ? "Over budget"
                  : overallPercentSpent > monthElapsedPercent
                  ? "Over pace"
                  : "On track"}
              </span>
            </div>

            {/* Gauge and central figure */}
            <div className="relative h-44 my-2 flex items-center justify-center">
              <LazyChart option={overallGaugeOptions} className="h-full" />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-medium font-mono text-main">
                  {overallPercentSpent}%
                </span>
                <span className="text-xs text-muted">used</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t border-subtle text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Month timeline</span>
              <span className="text-main font-mono">
                Day {currentDay} of {daysInMonth} · {monthElapsedPercent}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Daily allowance</span>
              <span className="text-main">
                <Money value={dailySafeSpend} /> <span className="text-muted">per day</span>
              </span>
            </div>
          </div>
        </div>

        {/* Category breakdown bar chart */}
        <div className={`${card} lg:col-span-8 p-6 flex flex-col`}>
          <div className="flex items-center justify-between pb-2">
            <h2 className="text-base font-medium text-main">Spending vs target</h2>
            <div className={segmentTrack}>
              <button onClick={() => setChartMode("top8")} className={segmentButton(chartMode === "top8")}>
                Top spenders
              </button>
              <button onClick={() => setChartMode("all")} className={segmentButton(chartMode === "all")}>
                All
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-[220px]">
            {budget?.items && budget.items.length > 0 ? (
              <LazyChart option={categoryBarChartOptions} className="h-full" />
            ) : (
              <div className="flex items-center justify-center h-full text-muted text-sm">
                No budget targets or spending this month
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Planned</div>
          <div className="mt-2 text-2xl font-medium leading-none">
            <Money value={totalPlannedExpenses} className="text-main" />
          </div>
          <div className="mt-2 text-xs text-muted">Sum of all category targets</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Spent so far</div>
          <div className="mt-2 text-2xl font-medium leading-none">
            <Money value={totalActualExpenses} className="text-main" />
          </div>
          <div className="mt-2 text-xs text-muted">
            {totalPlannedExpenses > 0
              ? `${overallPercentSpent}% of planned`
              : "No target set"}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="text-sm text-sub">Remaining</div>
          <div className="mt-2 text-2xl font-medium leading-none">
            <Money
              value={remainingBudget}
              className={remainingBudget >= 0 ? "text-main" : "text-negative"}
            />
          </div>
          <div className="mt-2 text-xs text-muted">
            {remainingBudget >= 0 ? "Within budget" : "Over the planned total"}
          </div>
        </div>
      </div>

      {/* Main budget ledger section */}
      <div className={`${card} overflow-hidden`}>
        {/* Controls toolbar: filters, search, view mode */}
        <div className="p-4 border-b border-subtle flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Status filters */}
          <div className="flex items-center flex-wrap gap-1">
            {filterButton("ALL", "All", statusCounts.total)}
            {statusCounts.over > 0 && filterButton("OVER", "Over", statusCounts.over, "bg-negative")}
            {statusCounts.warning > 0 &&
              filterButton("WARNING", "Near limit", statusCounts.warning, "bg-warning")}
            {filterButton("ON_TRACK", "On track", statusCounts.onTrack, "bg-positive")}
            {filterButton("UNSPENT", "Unspent", statusCounts.unspent, "bg-[var(--text-muted)]")}
          </div>

          {/* Search and layout switcher */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2"
                strokeWidth={1.5}
              />
              <input
                type="text"
                placeholder="Filter categories"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputClass} pl-9 pr-8 w-48 sm:w-56`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-main cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              )}
            </div>

            <div className={segmentTrack}>
              <button
                onClick={() => setViewMode("table")}
                className={`h-7 w-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                  viewMode === "table" ? "bg-surface text-main" : "text-muted hover:text-main"
                }`}
                title="Table"
              >
                <LayoutList className="w-4 h-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={`h-7 w-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                  viewMode === "cards" ? "bg-surface text-main" : "text-muted hover:text-main"
                }`}
                title="Cards"
              >
                <LayoutGrid className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Content area */}
        {isLoading ? (
          <div className="py-20 flex items-center justify-center text-sm text-muted">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
            Loading budget…
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="text-sm font-medium text-main">No matching budget categories</div>
            <p className="text-sm text-sub mt-1 max-w-sm mx-auto">
              Add a budget target, or clear the search and filters
            </p>
            <button onClick={() => setIsAddModalOpen(true)} className={`${primaryButton} mt-4`}>
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              Add category target
            </button>
          </div>
        ) : viewMode === "table" ? (
          /* Tabular ledger for desktop */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-subtle text-xs text-muted">
                  {sortHeader("NAME", "Category", "ASC")}
                  <th className="h-10 px-4 font-normal">Status</th>
                  {sortHeader("PLANNED", "Target", "DESC", "right")}
                  {sortHeader("ACTUAL", "Spent", "DESC", "right")}
                  {sortHeader("REMAINING", "Remaining", "ASC", "right")}
                  {sortHeader("PERCENT", "Used", "DESC", "left", "w-48")}
                  <th className="h-10 px-4 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {filteredAndSortedItems.map((item) => {
                  const cat = item.category;
                  if (!cat) return null;
                  const isEditing = editingTargetId === item.category_id;
                  const parentCat = categories.find((c) => c.id === cat.parent_id);
                  const tone = statusTone(item.isOver, item.percentUsed);

                  return (
                    <tr key={item.category_id} className="bg-surface-hover transition-colors group">
                      {/* Category name and parent group */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                          ></span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-main">{cat.name}</span>
                              {cat.is_rollover && (
                                <span
                                  className="rounded-md px-1.5 py-0.5 text-[11px] bg-surface-subtle text-sub"
                                  title="Envelope rollover enabled"
                                >
                                  Rollover
                                </span>
                              )}
                            </div>
                            {parentCat && (
                              <div className="text-xs text-muted">{parentCat.name}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status chip */}
                      <td className="py-3 px-4">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap ${
                            !item.isOver && item.percentUsed < 80 && item.actual_amount === 0
                              ? "bg-surface-subtle text-muted"
                              : chipClass[tone]
                          }`}
                        >
                          {item.isOver
                            ? "Over limit"
                            : item.percentUsed >= 80
                            ? "Near limit"
                            : item.actual_amount === 0
                            ? "Unspent"
                            : "On track"}
                        </span>
                      </td>

                      {/* Target (inline editable) */}
                      <td className="py-3 px-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-muted font-mono">$</span>
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
                              className="w-24 h-8 px-2 rounded-lg border border-[var(--accent-primary)] bg-input text-sm text-main font-mono text-right focus:outline-none"
                            />
                            <button
                              onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                              className="h-8 w-8 flex items-center justify-center rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast transition-colors cursor-pointer"
                              title="Save target"
                            >
                              <Save className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => setEditingTargetId(null)}
                              className={iconButton}
                              title="Cancel"
                            >
                              <X className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div
                              onClick={() => {
                                setEditingTargetId(item.category_id);
                                setTargetInput(item.planned_amount);
                              }}
                              className="cursor-pointer flex items-center justify-end gap-1 group/edit"
                              title="Click to edit target"
                            >
                              <Edit2
                                className="w-4 h-4 text-muted opacity-0 group-hover/edit:opacity-100 transition-opacity"
                                strokeWidth={1.5}
                              />
                              <Money value={item.planned_amount} className="text-main" />
                            </div>
                            {item.rollover_amount !== undefined && item.rollover_amount !== 0 && (
                              <div className="text-[11px] text-muted mt-0.5">
                                <Money
                                  value={item.rollover_amount}
                                  signed
                                  className={item.rollover_amount > 0 ? "text-positive" : "text-negative"}
                                />{" "}
                                rollover
                              </div>
                            )}
                            {item.available_amount !== undefined && item.available_amount !== item.planned_amount && (
                              <div className="text-[11px] text-muted mt-0.5">
                                Available <Money value={item.available_amount} />
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Spent */}
                      <td className="py-3 px-4 text-right">
                        <Money value={item.actual_amount} className="text-main" />
                        <div className="text-[11px] text-muted font-mono">{item.percentUsed}%</div>
                      </td>

                      {/* Remaining */}
                      <td className="py-3 px-4 text-right">
                        <Money
                          value={item.remaining_amount}
                          className={item.remaining_amount >= 0 ? "text-main" : "text-negative"}
                        />
                      </td>

                      {/* Progress meter */}
                      <td className="py-3 px-4">
                        <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${meterClass[tone]}`}
                            style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                          ></div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleToggleCategoryRollover(cat)}
                            aria-pressed={cat.is_rollover}
                            className={
                              cat.is_rollover
                                ? "h-8 w-8 flex items-center justify-center rounded-lg bg-accent-subtle text-accent-subtle transition-colors cursor-pointer"
                                : iconButton
                            }
                            title={cat.is_rollover ? "Rollover on (click to turn off)" : "Rollover off (click to turn on)"}
                          >
                            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => handleOpenDrilldown(cat)}
                            className={iconButton}
                            title="View category transactions"
                          >
                            <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                            className={`${iconButton} hover:text-negative`}
                            title="Remove category target from budget"
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
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
          /* Card / envelope view for mobile and tablet */
          <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedItems.map((item) => {
              const cat = item.category;
              if (!cat) return null;
              const isEditing = editingTargetId === item.category_id;
              const tone = statusTone(item.isOver, item.percentUsed);

              return (
                <div
                  key={item.category_id}
                  className="p-4 rounded-xl border border-subtle space-y-3 flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                        style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                      ></span>
                      <div>
                        <div className="text-sm font-medium text-main">{cat.name}</div>
                        <span
                          className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-xs ${chipClass[tone]}`}
                        >
                          {item.isOver ? "Over budget" : `${item.percentUsed}% spent`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenDrilldown(cat)}
                        className={iconButton}
                        title="View transactions"
                      >
                        <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleRemoveCategoryFromBudget(item.category_id)}
                        className={`${iconButton} hover:text-negative`}
                        title="Remove category"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>

                  {/* Figures */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Spent</span>
                      <Money value={item.actual_amount} className="text-main" />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted">Target</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span className="text-muted font-mono">$</span>
                          <input
                            type="number"
                            step="10"
                            value={targetInput}
                            onChange={(e) => setTargetInput(parseFloat(e.target.value) || 0)}
                            className="w-20 h-7 px-2 rounded-lg border border-[var(--accent-primary)] bg-input text-xs text-main font-mono text-right focus:outline-none"
                          />
                          <button
                            onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast transition-colors cursor-pointer"
                            title="Save target"
                          >
                            <Save className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTargetId(item.category_id);
                            setTargetInput(item.planned_amount);
                          }}
                          className="text-main hover:text-accent-subtle flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Money value={item.planned_amount} />
                          <Edit2 className="w-4 h-4 text-muted" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>

                    {item.rollover_amount !== undefined && item.rollover_amount !== 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Rollover balance</span>
                        <Money
                          value={item.rollover_amount}
                          signed
                          className={item.rollover_amount > 0 ? "text-positive" : "text-negative"}
                        />
                      </div>
                    )}
                    {item.available_amount !== undefined && item.available_amount !== item.planned_amount && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Available</span>
                        <Money value={item.available_amount} className="text-main" />
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-subtle">
                      <span className="text-muted">Remaining</span>
                      <Money
                        value={item.remaining_amount}
                        className={item.remaining_amount >= 0 ? "text-main" : "text-negative"}
                      />
                    </div>
                  </div>

                  {/* Progress meter */}
                  <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${meterClass[tone]}`}
                      style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

        </>
      )}

      {/* ------------------------------------------------------------- */}
      {/* ADD / CREATE CATEGORY MODAL                                   */}
      {/* ------------------------------------------------------------- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
          <div className="bg-surface border border-default rounded-xl w-full max-w-lg shadow-xl overflow-hidden animate-in zoom-in-95">
            {/* Modal header */}
            <div className="p-5 border-b border-subtle flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-medium text-main">Add category to budget</h3>
                <p className="text-sm text-sub mt-1">
                  Set a monthly spending envelope for {monthName}
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className={iconButton}
                aria-label="Close"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Tab switcher */}
            <div className="px-5 pt-4">
              <div className={segmentTrack}>
                <button
                  onClick={() => setAddModalTab("existing")}
                  className={`flex-1 ${segmentButton(addModalTab === "existing")}`}
                >
                  Existing category{" "}
                  <span className="font-mono text-muted">{unbudgetedCategories.length}</span>
                </button>
                <button
                  onClick={() => setAddModalTab("new")}
                  className={`flex-1 ${segmentButton(addModalTab === "new")}`}
                >
                  New category
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              {addModalTab === "existing" ? (
                /* Tab 1: pick an existing category */
                <div className="space-y-4">
                  {unbudgetedCategories.length === 0 ? (
                    <div className="text-center py-6 text-muted text-sm">
                      All expense categories are already in your budget. Switch to “New category” to
                      add one.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs text-sub mb-2">Category</label>
                        <select
                          value={selectedExistingCatId}
                          onChange={(e) => setSelectedExistingCatId(e.target.value)}
                          className={inputClass}
                        >
                          {unbudgetedCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-sub mb-2">Monthly target</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-mono">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={existingCatTarget}
                            onChange={(e) => setExistingCatTarget(parseFloat(e.target.value) || 0)}
                            className={`${inputClass} pl-7 font-mono`}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                /* Tab 2: create a new category */
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-sub mb-2">Category name</label>
                    <input
                      type="text"
                      placeholder="Pet care"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-sub mb-2">Parent group (optional)</label>
                    <select
                      value={newCatParentId}
                      onChange={(e) => setNewCatParentId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">None (top-level category)</option>
                      {parentCategories.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-sub mb-2">Category color</label>
                    <div className="flex items-center flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewCatColor(color)}
                          aria-label={`Color ${color}`}
                          aria-pressed={newCatColor === color}
                          className={`w-6 h-6 rounded-full transition-opacity cursor-pointer ${
                            newCatColor === color
                              ? "ring-2 ring-accent-main ring-offset-2 ring-offset-surface"
                              : "opacity-70 hover:opacity-100"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-subtle">
                    <input
                      type="checkbox"
                      id="newCatIsRollover"
                      checked={newCatIsRollover}
                      onChange={(e) => setNewCatIsRollover(e.target.checked)}
                      className="mt-0.5 rounded-md border-default text-accent-main focus:ring-accent-main cursor-pointer"
                    />
                    <label htmlFor="newCatIsRollover" className="text-sm cursor-pointer">
                      <span className="text-main block">Roll over unspent budget</span>
                      <span className="text-muted block text-xs mt-1">
                        Surplus adds to next month's envelope; overspending reduces it
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs text-sub mb-2">Monthly target</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm font-mono">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={newCatTarget}
                        onChange={(e) => setNewCatTarget(parseFloat(e.target.value) || 0)}
                        className={`${inputClass} pl-7 font-mono`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="p-5 border-t border-subtle flex items-center justify-end gap-2">
              <button onClick={() => setIsAddModalOpen(false)} className={secondaryButton}>
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
                className={primaryButton}
              >
                {isSubmittingCat && (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                )}
                <span>
                  {addModalTab === "existing" ? "Add to budget" : "Create and add to budget"}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
          <div className="bg-surface border border-default rounded-xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
            {/* Header */}
            <div className="p-5 border-b border-subtle flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span
                  className="w-2 h-2 rounded-full mt-2 shrink-0"
                  style={{ backgroundColor: drilldownCategory.color || chartTheme.accentColor }}
                ></span>
                <div>
                  <h3 className="text-base font-medium text-main">
                    {drilldownCategory.name} transactions
                  </h3>
                  <p className="text-sm text-sub mt-1">Charges in {monthName}</p>
                </div>
              </div>
              <button
                onClick={() => setDrilldownCategory(null)}
                className={iconButton}
                aria-label="Close"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Transaction list */}
            <div className="p-5 flex-1 overflow-y-auto">
              {isLoadingTransactions ? (
                <div className="py-12 flex items-center justify-center text-muted text-sm">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
                  Loading transactions…
                </div>
              ) : drilldownTransactions.length === 0 ? (
                <div className="py-12 text-center text-muted text-sm">
                  No {drilldownCategory.name} transactions in {monthName}
                </div>
              ) : (
                <div>
                  <div className="text-xs text-muted mb-2">
                    <span className="font-mono">{drilldownTransactions.length}</span>{" "}
                    {drilldownTransactions.length === 1 ? "transaction" : "transactions"}
                  </div>
                  <ul className="divide-y divide-subtle">
                    {drilldownTransactions.map((t) => (
                      <li key={t.id} className="h-14 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm text-main truncate">
                            {t.normalized_payee || t.raw_payee}
                          </div>
                          <div className="text-xs text-muted font-mono truncate">
                            {t.transaction_date} · {t.raw_payee}
                          </div>
                        </div>
                        <Money value={Math.abs(t.amount)} className="text-sm text-main shrink-0" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-subtle flex justify-end">
              <button onClick={() => setDrilldownCategory(null)} className={secondaryButton}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
