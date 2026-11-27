import React, { useState, useEffect, useMemo, useCallback } from "react";
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
import { NumberField } from "../common/NumberField";
import { useChartTheme } from "../../hooks/useChartTheme";
import { formatMoney, formatMoneyCompact, getDateLocale } from "../../utils/format";
import { CashFlowForecastView } from "./CashFlowForecastView";
import type { Budget, BudgetItem, Category, Transaction } from "../../types";
import { api } from "../../services/api";
import { useCanEdit } from "../../hooks/useSession";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { budgetLineState } from "./budgetLine";
import { ActionSheet, DetailList } from "../common/ActionSheet";
import {
  chipTab,
  hairline,
  iconButton,
  labelText,
  loneText,
  pageStack,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
  primaryButton,
  secondaryButton,
  inputClass,
  fieldLabel,
  segmentTrack,

  segmentButton,
  modalOverlay,
  wrapOnPhone,
} from "../common/ui";

interface BudgetingViewProps {
  categories: Category[];
  onCategoriesModified?: () => void;
}

type FilterStatus = "ALL" | "OVER" | "WARNING" | "ON_TRACK" | "UNSPENT";
type SortField = "NAME" | "PLANNED" | "ACTUAL" | "REMAINING" | "PERCENT";
type SortDirection = "ASC" | "DESC";

/** Sectioned modal panel: a bottom sheet on phones, a dialog from md up. */
const sectionedPanel =
  "w-full flex flex-col max-h-[92dvh] md:max-h-[85vh] overflow-hidden rounded-t-2xl md:rounded-2xl bg-surface elevation-3 pb-[env(safe-area-inset-bottom)] md:pb-0 animate-in sheet-enter";

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
  const canEdit = useCanEdit();
  const chartTheme = useChartTheme();
  const isPhone = useIsPhone();

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
  const [targetInput, setTargetInput] = useState<number | null>(null);

  // Phone: the budget line whose details and actions are open in a sheet
  const [sheetCategoryId, setSheetCategoryId] = useState<string | null>(null);
  const closeSheet = useCallback(() => {
    setSheetCategoryId(null);
    setEditingTargetId(null);
  }, []);

  // Add / Create Category Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalTab, setAddModalTab] = useState<"existing" | "new">("existing");
  const [selectedExistingCatId, setSelectedExistingCatId] = useState<string>("");
  const [existingCatTarget, setExistingCatTarget] = useState<number | null>(100);

  // New Category Form
  const [newCatName, setNewCatName] = useState("");
  const [newCatParentId, setNewCatParentId] = useState<string>("");
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [newCatTarget, setNewCatTarget] = useState<number | null>(100);
  const [isSubmittingCat, setIsSubmittingCat] = useState(false);

  // Transaction Drilldown Modal
  const [drilldownCategory, setDrilldownCategory] = useState<Category | null>(null);
  const [drilldownTransactions, setDrilldownTransactions] = useState<Transaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const monthName = currentDate.toLocaleString(getDateLocale(), { month: "long", year: "numeric" });

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
  const handleSavePlannedAmount = async (categoryId: string, plannedAmount: number | null) => {
    try {
      await api.upsertBudgetItem(year, month, {
        category_id: categoryId,
        planned_amount: plannedAmount ?? 0,
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
        planned_amount: existingCatTarget ?? 0,
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
        planned_amount: newCatTarget ?? 0,
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
      const { status, isOver, percentUsed, usedLabel } = budgetLineState(item.planned_amount, item.actual_amount);

      return {
        ...item,
        category: cat,
        percentUsed,
        usedLabel,
        isOver,
        status: status as FilterStatus,
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
    textStyle: { color: chartTheme.tooltipText, fontSize: chartTheme.labelFontSize, fontFamily: chartTheme.fontFamily },
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
          `${p.name}<div style="margin-top:4px;font-family:${chartTheme.figureFontFamily}">${formatMoney(Number(p.value))} · ${p.percent}%</div>`,
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
            str += `<div style="margin-top:4px">${p.marker} ${p.seriesName} <span style="font-family:${chartTheme.figureFontFamily}">${formatMoney(
              Number(p.value)
            )}</span></div>`;
          });
          return str;
        },
      },
      legend: {
        // "Spent" is coloured per bar, so give its swatch the usual colour.
        data: ["Target", { name: "Spent", itemStyle: { color: chartTheme.accentColor } }],
        textStyle: { color: chartTheme.subtleTextColor, fontSize: chartTheme.axisFontSize },
        itemWidth: 10,
        itemHeight: 10,
        top: 0,
        right: 0,
      },
      // Category names may take up to 40% of the width (ECharts caps them at 25%).
      grid: { left: 8, right: 16, bottom: 8, top: 32, containLabel: true, outerBoundsClampWidth: "40%" },
      xAxis: {
        type: "value",
        axisLabel: {
          color: chartTheme.subtleTextColor,
          fontSize: chartTheme.axisFontSize,
          fontFamily: chartTheme.figureFontFamily,
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
          fontSize: chartTheme.labelFontSize,
          fontFamily: chartTheme.fontFamily,
          // A fixed width, so long names end in an ellipsis only when they
          // really don't fit; the tooltip shows them in full.
          width: isPhone ? 120 : 260,
          overflow: "truncate",
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
              if (it && budgetLineState(it.planned, it.actual).isOver) {
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
  }, [budget?.items, categories, chartMode, chartTheme, isPhone]);

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
      const { status } = budgetLineState(it.planned_amount, it.actual_amount);
      if (status === "OVER") over++;
      else if (status === "WARNING") warning++;
      else if (status === "UNSPENT") unspent++;
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
  const statusLabel = (item: { isOver: boolean; percentUsed: number; actual_amount: number }) =>
    item.isOver
      ? "Over limit"
      : item.percentUsed >= 80
      ? "Near limit"
      : item.actual_amount === 0
      ? "Unspent"
      : "On track";

  const sheetItem = sheetCategoryId
    ? filteredAndSortedItems.find((it) => it.category_id === sheetCategoryId) ?? null
    : null;

  const sortHeader = (
    field: SortField,
    label: string,
    defaultDirection: SortDirection,
    align: "left" | "right" = "left",
    extra = ""
  ) => (
    <th
      className={`h-10 px-2 sm:px-3 font-normal cursor-pointer hover:text-main ${
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
        <ArrowUpDown className="w-4 h-4 text-sub" strokeWidth={1.5} />
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
      className={chipTab(statusFilter === status)}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span>{label}</span>
      <span className="tabular-nums text-sub font-normal">{count}</span>
    </button>
  );

  const overallTone =
    overallPercentSpent > 100 ? "negative" : overallPercentSpent > monthElapsedPercent ? "warning" : "positive";

  return (
    <div className={`max-w-7xl mx-auto pb-12 ${pageStack}`}>
      {/* View switcher: monthly envelopes vs cash flow forecast */}
      <div className={segmentTrack}>
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
          <h1 className="text-2xl md:text-3xl font-semibold text-main">Monthly budget</h1>
          <p className="text-sm text-sub mt-1">
            Spending ceilings, burn pace and live category actuals
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {canEdit && (
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
          )}

          {/* Month switcher */}
          <div className="flex items-center gap-1">
            <button onClick={handlePrevMonth} className={iconButton} title="Previous month">
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="text-base font-semibold text-main px-2 min-w-[148px] text-center">{monthName}</span>
            <button onClick={handleNextMonth} className={iconButton} title="Next month">
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* Burn rate overview and category chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
        {/* Burn rate and radial gauge */}
        <section className={`${section} lg:col-span-4 flex flex-col justify-between`}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={sectionTitle}>Overall budget health</h2>
              <span className={`rounded-md px-2 py-0.5 text-sm ${chipClass[overallTone]}`}>
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
                <span className="font-display text-3xl font-medium tabular-nums text-main">
                  {overallPercentSpent}%
                </span>
                <span className="text-sm text-sub">used</span>
              </div>
            </div>
          </div>

          <div className={`space-y-2 pt-4 ${hairline} text-sm`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span className="text-sub">Month timeline</span>
              <span className="text-main tabular-nums">
                Day {currentDay} of {daysInMonth} · {monthElapsedPercent}%
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span className="text-sub">Daily allowance</span>
              <span className="text-main">
                <Money value={dailySafeSpend} /> <span className="text-sub">per day</span>
              </span>
            </div>
          </div>
        </section>

        {/* Category breakdown bar chart */}
        <section className={`${section} lg:col-span-8 flex flex-col`}>
          <div className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${sectionHeader}`}>
            <h2 className={sectionTitle}>Spending vs target</h2>
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
              <div className={`flex items-center justify-center h-full px-4 text-center ${loneText}`}>
                No budget targets or spending this month
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Key figures, set straight on the page */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-8">
        <div className="min-w-0">
          <div className={labelText}>Planned</div>
          <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none">
            <Money value={totalPlannedExpenses} className="text-main" />
          </div>
          <div className="mt-2 text-sm text-sub">Sum of all category targets</div>
        </div>

        <div className="min-w-0">
          <div className={labelText}>Spent so far</div>
          <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none">
            <Money value={totalActualExpenses} className="text-main" />
          </div>
          <div className="mt-2 text-sm text-sub">
            {totalPlannedExpenses > 0
              ? `${overallPercentSpent}% of planned`
              : "No target set"}
          </div>
        </div>

        <div className="min-w-0">
          <div className={labelText}>Remaining</div>
          <div className="mt-2 font-display text-2xl md:text-3xl font-medium leading-none">
            <Money
              value={remainingBudget}
              className={remainingBudget >= 0 ? "text-main" : "text-negative"}
            />
          </div>
          <div className="mt-2 text-sm text-sub">
            {remainingBudget >= 0 ? "Within budget" : "Over the planned total"}
          </div>
        </div>
      </div>

      {/* Main budget ledger section */}
      <section className={section}>
        {/* Controls toolbar: filters, search, view mode */}
        <div className="pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
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
            <div className="relative flex-1 md:flex-none">
              <Search
                className="w-4 h-4 text-sub absolute left-3 top-1/2 -translate-y-1/2"
                strokeWidth={1.5}
              />
              <input
                type="text"
                placeholder="Filter categories"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${inputClass} pl-9 pr-10 md:w-56`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-0 top-1/2 -translate-y-1/2 size-11 md:size-8 inline-flex items-center justify-center text-sub hover:text-main cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              )}
            </div>

            {!isPhone && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                className={`${iconButton} ${viewMode === "table" ? "bg-accent-subtle text-accent-subtle" : ""}`}
                title="Table"
              >
                <LayoutList className="w-4 h-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setViewMode("cards")}
                aria-pressed={viewMode === "cards"}
                className={`${iconButton} ${viewMode === "cards" ? "bg-accent-subtle text-accent-subtle" : ""}`}
                title="Cards"
              >
                <LayoutGrid className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            )}
          </div>
        </div>

        {/* Content area */}
        {isLoading ? (
          <div role="status" className={`py-20 flex items-center justify-center ${loneText}`}>
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
            Loading budget…
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="text-lg font-semibold text-main">No matching budget categories</div>
            <p className={`mt-1 max-w-md mx-auto ${loneText}`}>
              Add a budget target, or clear the search and filters
            </p>
            <button onClick={() => setIsAddModalOpen(true)} className={`${primaryButton} mt-4`}>
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              Add category target
            </button>
          </div>
        ) : isPhone ? (
          /* Phone: one read-only envelope per row; tap for details and actions */
          <ul className="border-y border-subtle divide-y divide-subtle" data-testid="budget-phone-list">
            {filteredAndSortedItems.map((item) => {
              const cat = item.category;
              if (!cat) return null;
              const parentCat = categories.find((c) => c.id === cat.parent_id);
              const tone = statusTone(item.isOver, item.percentUsed);
              return (
                <li key={item.category_id}>
                  <button
                    type="button"
                    onClick={() => setSheetCategoryId(item.category_id)}
                    className="w-full text-left py-4 flex flex-col gap-3 cursor-pointer active:bg-[var(--bg-surface-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-3 w-full">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-2"
                        style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                      ></span>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-medium text-main break-words">{cat.name}</div>
                        {parentCat && <div className="text-sm text-sub break-words">{parentCat.name}</div>}
                        <span className="sr-only">, details and actions</span>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-sm ${chipClass[tone]}`}>
                        {statusLabel(item)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-sm w-full">
                      <div>
                        <dt className="text-sub">Target</dt>
                        <dd className="text-main">
                          <Money value={item.planned_amount} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sub">Spent</dt>
                        <dd className="text-main">
                          <Money value={item.actual_amount} />{" "}
                          <span className="text-sub tabular-nums">{item.usedLabel}</span>
                        </dd>
                      </div>
                      <div className="text-right">
                        <dt className="text-sub">Remaining</dt>
                        <dd>
                          <Money
                            value={item.remaining_amount}
                            className={item.remaining_amount >= 0 ? "text-main" : "text-negative"}
                          />
                        </dd>
                      </div>
                    </dl>
                    {((item.rollover_amount !== undefined && item.rollover_amount !== 0) ||
                      (item.available_amount !== undefined && item.available_amount !== item.planned_amount)) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-sub">
                        {item.rollover_amount !== undefined && item.rollover_amount !== 0 && (
                          <span>
                            <Money
                              value={item.rollover_amount}
                              signed
                              className={item.rollover_amount > 0 ? "text-positive" : "text-negative"}
                            />{" "}
                            rolled over
                          </span>
                        )}
                        {item.available_amount !== undefined && item.available_amount !== item.planned_amount && (
                          <span>
                            Available <Money value={item.available_amount} className="text-main" />
                          </span>
                        )}
                      </div>
                    )}
                    <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${meterClass[tone]}`}
                        style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                      ></div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : viewMode === "table" ? (
          /* Tabular ledger for tablet and desktop */
          <div className="border-b border-subtle">
            <table className="w-full table-fixed text-left text-sm border-collapse">
              <thead>
                <tr className="border-y border-subtle text-sm text-sub">
                  {sortHeader("NAME", "Category", "ASC")}
                  <th className="hidden md:table-cell h-10 px-2 sm:px-3 w-24 font-normal">Status</th>
                  {sortHeader("PLANNED", "Target", "DESC", "right", "w-24 sm:w-28")}
                  {sortHeader("ACTUAL", "Spent", "DESC", "right", "w-20 sm:w-24")}
                  {sortHeader("REMAINING", "Remaining", "ASC", "right", "hidden sm:table-cell w-24")}
                  {sortHeader("PERCENT", "Used", "DESC", "left", "hidden xl:table-cell w-32")}
                  <th className="h-10 px-2 sm:px-3 w-[120px] pointer-coarse:w-[152px] font-normal">
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
                      <td className="py-3 px-2 sm:px-3 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                          ></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-main truncate" title={cat.name}>
                                {cat.name}
                              </span>
                              {cat.is_rollover && (
                                <span
                                  className="rounded-md px-1.5 py-0.5 text-sm bg-surface-subtle text-sub shrink-0"
                                  title="Envelope rollover enabled"
                                >
                                  Rollover
                                </span>
                              )}
                            </div>
                            {parentCat && (
                              <div className="text-sm text-sub truncate">{parentCat.name}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status chip */}
                      <td className="hidden md:table-cell py-3 px-2 sm:px-3">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-sm whitespace-nowrap ${
                            !item.isOver && item.percentUsed < 80 && item.actual_amount === 0
                              ? "bg-surface-subtle text-sub"
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
                      <td className="py-3 px-2 sm:px-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-sub tabular-nums">$</span>
                            <NumberField
                              step="0.01"
                              value={targetInput}
                              onValueChange={setTargetInput}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSavePlannedAmount(item.category_id, targetInput);
                                if (e.key === "Escape") setEditingTargetId(null);
                              }}
                              autoFocus
                              className="w-20 h-8 px-2 rounded-lg border border-[var(--accent-primary)] bg-input text-sm text-main tabular-nums text-right focus:outline-none"
                            />
                            <button
                              onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                              className="h-8 w-8 flex items-center justify-center rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast transition-colors cursor-pointer shrink-0"
                              title="Save target"
                            >
                              <Save className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => setEditingTargetId(null)}
                              className={`${iconButton} shrink-0`}
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
                                className="w-4 h-4 text-sub opacity-0 group-hover/edit:opacity-100 pointer-coarse:opacity-100 transition-opacity shrink-0"
                                strokeWidth={1.5}
                              />
                              <Money value={item.planned_amount} className="text-main" />
                            </div>
                            {item.rollover_amount !== undefined && item.rollover_amount !== 0 && (
                              <div className="text-sm text-sub mt-0.5 truncate">
                                <Money
                                  value={item.rollover_amount}
                                  signed
                                  className={item.rollover_amount > 0 ? "text-positive" : "text-negative"}
                                />{" "}
                                rollover
                              </div>
                            )}
                            {item.available_amount !== undefined && item.available_amount !== item.planned_amount && (
                              <div className="text-sm text-sub mt-0.5 truncate">
                                Available <Money value={item.available_amount} />
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Spent */}
                      <td className="py-3 px-2 sm:px-3 text-right whitespace-nowrap">
                        <Money value={item.actual_amount} className="text-main" />
                        <div className="text-sm text-sub tabular-nums">{item.usedLabel}</div>
                      </td>

                      {/* Remaining */}
                      <td className="hidden sm:table-cell py-3 px-2 sm:px-3 text-right whitespace-nowrap">
                        <Money
                          value={item.remaining_amount}
                          className={item.remaining_amount >= 0 ? "text-main" : "text-negative"}
                        />
                      </td>

                      {/* Progress meter */}
                      <td className="hidden xl:table-cell py-3 px-2 sm:px-3">
                        <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${meterClass[tone]}`}
                            style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                          ></div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-2 sm:px-3">
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
          /* Card / envelope view (tablet and desktop, by choice) */
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
            {filteredAndSortedItems.map((item) => {
              const cat = item.category;
              if (!cat) return null;
              const isEditing = editingTargetId === item.category_id;
              const tone = statusTone(item.isOver, item.percentUsed);

              return (
                <div
                  key={item.category_id}
                  className={`min-w-0 pt-4 ${hairline} space-y-3 flex flex-col justify-between`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-2"
                        style={{ backgroundColor: cat.color || chartTheme.accentColor }}
                      ></span>
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-main break-words">{cat.name}</div>
                        <span
                          className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-sm ${chipClass[tone]}`}
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
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sub">Spent</span>
                      <Money value={item.actual_amount} className="text-main" />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sub">Target</span>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span className="text-sub tabular-nums">$</span>
                          <NumberField
                            step="0.01"
                            value={targetInput}
                            onValueChange={setTargetInput}
                            className="w-24 h-9 pointer-coarse:h-10 px-2 rounded-lg border border-[var(--accent-primary)] bg-input text-sm text-main tabular-nums text-right focus:outline-none"
                          />
                          <button
                            onClick={() => handleSavePlannedAmount(item.category_id, targetInput)}
                            className="size-9 pointer-coarse:size-10 flex items-center justify-center rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast transition-colors cursor-pointer"
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
                          <Edit2 className="w-4 h-4 text-sub" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>

                    {item.rollover_amount !== undefined && item.rollover_amount !== 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-sub">Rollover balance</span>
                        <Money
                          value={item.rollover_amount}
                          signed
                          className={item.rollover_amount > 0 ? "text-positive" : "text-negative"}
                        />
                      </div>
                    )}
                    {item.available_amount !== undefined && item.available_amount !== item.planned_amount && (
                      <div className="flex items-center justify-between">
                        <span className="text-sub">Available</span>
                        <Money value={item.available_amount} className="text-main" />
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sub font-semibold">Remaining</span>
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
      </section>

        </>

      )}

      {/* Phone: details and actions for one budget line */}
      {sheetItem?.category && (
        <ActionSheet
          open
          onClose={closeSheet}
          title={sheetItem.category.name}
          subtitle={`${statusLabel(sheetItem)} · ${monthName}`}
          actions={[
            ...(canEdit
              ? [
                  {
                    label: "Edit target",
                    icon: Edit2,
                    keepOpen: true,
                    onSelect: () => {
                      setEditingTargetId(sheetItem.category_id);
                      setTargetInput(sheetItem.planned_amount);
                    },
                  },
                  {
                    label: "Roll over unspent budget",
                    icon: RefreshCw,
                    keepOpen: true,
                    detail: sheetItem.category.is_rollover ? "On" : "Off",
                    onSelect: () => handleToggleCategoryRollover(sheetItem.category!),
                  },
                ]
              : []),
            {
              label: "View transactions",
              icon: ExternalLink,
              onSelect: () => handleOpenDrilldown(sheetItem.category!),
            },
            ...(canEdit
              ? [
                  {
                    label: "Remove from budget",
                    icon: Trash2,
                    destructive: true,
                    onSelect: () => handleRemoveCategoryFromBudget(sheetItem.category_id),
                  },
                ]
              : []),
          ]}
        >
          {editingTargetId === sheetItem.category_id ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSavePlannedAmount(sheetItem.category_id, targetInput);
              }}
            >
              <label className="flex-1 min-w-0">
                <span className="block text-sm text-sub mb-1">Monthly target</span>
                <NumberField
                  min="0"
                  step="0.01"
                  value={targetInput}
                  onValueChange={setTargetInput}
                  autoFocus
                  className={`${inputClass} tabular-nums text-right`}
                />
              </label>
              <button type="submit" className={primaryButton}>
                <Save className="w-4 h-4" strokeWidth={1.5} />
                Save
              </button>
              <button type="button" onClick={() => setEditingTargetId(null)} className={iconButton} aria-label="Cancel">
                <X className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </form>
          ) : (
            <DetailList
              items={[
                ["Target", <Money value={sheetItem.planned_amount} />],
                [
                  "Spent",
                  <>
                    <Money value={sheetItem.actual_amount} />{" "}
                    <span className="text-sub tabular-nums">{sheetItem.usedLabel}</span>
                  </>,
                ],
                [
                  "Remaining",
                  <Money
                    value={sheetItem.remaining_amount}
                    className={sheetItem.remaining_amount >= 0 ? "text-main" : "text-negative"}
                  />,
                ],
                sheetItem.rollover_amount !== undefined &&
                  sheetItem.rollover_amount !== 0 && [
                    "Rolled over",
                    <Money
                      value={sheetItem.rollover_amount}
                      signed
                      className={sheetItem.rollover_amount > 0 ? "text-positive" : "text-negative"}
                    />,
                  ],
                sheetItem.available_amount !== undefined &&
                  sheetItem.available_amount !== sheetItem.planned_amount && [
                    "Available",
                    <Money value={sheetItem.available_amount} />,
                  ],
              ]}
            />
          )}
        </ActionSheet>
      )}

      {/* ------------------------------------------------------------- */}
      {/* ADD / CREATE CATEGORY MODAL                                   */}
      {/* ------------------------------------------------------------- */}
      {isAddModalOpen && (
        <div className={modalOverlay}>
          <div className={`${sectionedPanel} md:max-w-lg`}>
            {/* Modal header */}
            <div className="p-5 border-b border-subtle flex items-start justify-between gap-4">
              <div>
                <h3 className={sectionTitle}>Add category to budget</h3>
                <p className={sectionSub}>
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
                  <span className="tabular-nums text-sub font-normal">{unbudgetedCategories.length}</span>
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
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              {addModalTab === "existing" ? (
                /* Tab 1: pick an existing category */
                <div className="space-y-4">
                  {unbudgetedCategories.length === 0 ? (
                    <div className={`text-center py-6 ${loneText}`}>
                      All expense categories are already in your budget. Switch to “New category” to
                      add one.
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className={fieldLabel}>Category</label>
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
                        <label className={fieldLabel}>Monthly target</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sub text-base md:text-sm tabular-nums">
                            $
                          </span>
                          <NumberField
                            min="0"
                            step="0.01"
                            value={existingCatTarget}
                            onValueChange={setExistingCatTarget}
                            className={`${inputClass} pl-7 tabular-nums`}
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
                    <label className={fieldLabel}>Category name</label>
                    <input
                      type="text"
                      placeholder="Pet care"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={fieldLabel}>Parent group (optional)</label>
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
                    <label className={fieldLabel}>Category color</label>
                    <div className="flex items-center flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewCatColor(color)}
                          aria-label={`Color ${color}`}
                          aria-pressed={newCatColor === color}
                          className={`size-10 md:size-6 rounded-full transition-opacity cursor-pointer ${
                            newCatColor === color
                              ? "ring-2 ring-accent-main ring-offset-2 ring-offset-surface"
                              : "opacity-70 hover:opacity-100"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-3 py-2">
                    <input
                      type="checkbox"
                      id="newCatIsRollover"
                      checked={newCatIsRollover}
                      onChange={(e) => setNewCatIsRollover(e.target.checked)}
                      className="mt-0.5 size-5 md:size-4 rounded-md border-default text-accent-main focus:ring-accent-main cursor-pointer"
                    />
                    <label htmlFor="newCatIsRollover" className="text-base md:text-sm cursor-pointer">
                      <span className="text-main block">Roll over unspent budget</span>
                      <span className="text-sub block text-sm mt-1">
                        Surplus adds to next month's envelope; overspending reduces it
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className={fieldLabel}>Monthly target</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sub text-base md:text-sm tabular-nums">
                        $
                      </span>
                      <NumberField
                        min="0"
                        step="0.01"
                        value={newCatTarget}
                        onValueChange={setNewCatTarget}
                        className={`${inputClass} pl-7 tabular-nums`}
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
        <div className={modalOverlay}>
          <div className={`${sectionedPanel} md:max-w-2xl`}>
            {/* Header */}
            <div className="p-5 border-b border-subtle flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span
                  className="w-2 h-2 rounded-full mt-2 shrink-0"
                  style={{ backgroundColor: drilldownCategory.color || chartTheme.accentColor }}
                ></span>
                <div>
                  <h3 className={`${sectionTitle} break-words`}>
                    {drilldownCategory.name} transactions
                  </h3>
                  <p className={sectionSub}>Charges in {monthName}</p>
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
                <div role="status" className={`py-12 flex items-center justify-center ${loneText}`}>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
                  Loading transactions…
                </div>
              ) : drilldownTransactions.length === 0 ? (
                <div className={`py-12 px-4 text-center break-words ${loneText}`}>
                  No {drilldownCategory.name} transactions in {monthName}
                </div>
              ) : (
                <div>
                  <div className="text-sm text-sub mb-2">
                    <span className="tabular-nums">{drilldownTransactions.length}</span>{" "}
                    {drilldownTransactions.length === 1 ? "transaction" : "transactions"}
                  </div>
                  <ul className="divide-y divide-subtle">
                    {drilldownTransactions.map((t) => (
                      <li key={t.id} className="min-h-14 py-2 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className={`text-base md:text-sm text-main ${wrapOnPhone}`}>
                            {t.normalized_payee || t.raw_payee}
                          </div>
                          <div className={`text-sm text-sub tabular-nums ${wrapOnPhone}`}>
                            {t.transaction_date} · {t.raw_payee}
                          </div>
                        </div>
                        <Money value={Math.abs(t.amount)} className="text-base md:text-sm text-main shrink-0" />
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
