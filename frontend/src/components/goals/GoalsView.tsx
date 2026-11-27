import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Calculator,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ArrowRight,
  X,
  MoreHorizontal,
} from "lucide-react";
import type {
  Goal,
  GoalType,
  Account,
  Category,
  HouseholdMember,
  CraSummaryResponse,
  EmergencyFundCalcResponse,
} from "../../types";
import { api } from "../../services/api";
import { Money } from "../common/Money";
import { NumberField } from "../common/NumberField";
import { formatMoney, getDateLocale } from "../../utils/format";
import { useCanEdit } from "../../hooks/useSession";
import { getSession } from "../../utils/session";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { ActionSheet } from "../common/ActionSheet";
import {
  chipTab,
  dangerIconButton,
  hairline,
  iconButton,
  inputClass,
  labelText,
  loneText,
  modalOverlay,
  pageStack,
  primaryButton,
  secondaryButton,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
  segmentButton,
  segmentTrack,
} from "../common/ui";

interface GoalsViewProps {
  accounts: Account[];
  categories: Category[];
  householdMembers: HouseholdMember[];
  onDataModified?: () => void;
}

const GOAL_TYPE_META: Record<GoalType, { label: string; color: string; description: string }> = {
  SAVINGS: {
    label: "General savings",
    color: "#3B82F6",
    description: "General goal (e.g. down payment, car, vacation, large purchase)",
  },
  EMERGENCY_FUND: {
    label: "Emergency fund",
    color: "#10B981",
    description: "Liquid safety buffer (typically 3–6 months of essential living expenses)",
  },
  TFSA_ANNUAL: {
    label: "TFSA contribution",
    color: "#8B5CF6",
    description: "Tax-Free Savings Account annual contribution room ($7,000 for 2024–2026)",
  },
  FHSA_ANNUAL: {
    label: "FHSA contribution",
    color: "#EC4899",
    description: "First Home Savings Account annual room ($8,000/yr, $40k lifetime max)",
  },
  HBP_REPAYMENT: {
    label: "Home Buyers' Plan",
    color: "#F59E0B",
    description: "Annual RRSP Home Buyers' Plan repayment schedule (1/15th per year)",
  },
  DEBT_PAYOFF: {
    label: "Debt payoff",
    color: "#EF4444",
    description: "Targeted liability acceleration (loan, line of credit, or mortgage prepay)",
  },
};

const btnPrimary = primaryButton;
const btnSecondary = secondaryButton;
const inputCls = inputClass;
const labelCls = `block ${labelText} mb-1`;
const segment = segmentButton;

interface CraRoomCardProps {
  title: string;
  tag: string;
  contributed: number;
  limit: number;
  remainingRaw: number | undefined;
  defaultLimit: number;
  warning: string;
  footnote: string;
  onTrack: () => void;
}

/** One CRA statutory room section (TFSA or FHSA). */
const CraRoomCard: React.FC<CraRoomCardProps> = ({
  title,
  tag,
  contributed,
  limit,
  remainingRaw,
  defaultLimit,
  warning,
  footnote,
  onTrack,
}) => {
  const isOver = (remainingRaw ?? defaultLimit) < 0;
  const remainingAbs = Math.abs(remainingRaw ?? (limit ?? defaultLimit));
  const exceeded = contributed > limit;

  return (
    <section className={`${section} flex flex-col justify-between`}>
      <div>
        <div className={sectionHeader}>
          <h2 className={sectionTitle}>{title}</h2>
          <p className={sectionSub}>{tag}</p>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <div className="font-display text-2xl md:text-3xl font-medium leading-tight text-main break-words min-w-0">
            <Money value={contributed ?? 0} />
            <span className="ml-2 font-sans text-sm text-sub">
              of {formatMoney(limit ?? defaultLimit, { cents: false })} limit
            </span>
          </div>
          <span className={`text-sm tabular-nums ${isOver ? "text-negative" : "text-sub"}`}>
            {formatMoney(remainingAbs, { cents: false })} {isOver ? "over limit" : "remaining"}
          </span>
        </div>

        <div className="mt-4 w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              exceeded ? "bg-negative" : ""
            }`}
            style={{
              width: `${Math.min(100, (contributed / limit) * 100)}%`,
              backgroundColor: exceeded ? undefined : "var(--text-secondary)",
            }}
          />
        </div>

        {exceeded && (
          <div className="mt-4 p-3 rounded-lg bg-negative-subtle text-sm text-negative flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>
              <span className="font-medium">CRA excess warning:</span> {warning}
            </span>
          </div>
        )}
      </div>

      <div className={`mt-5 pt-3 ${hairline} flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-sub`}>
        <span>{footnote}</span>
        <button
          onClick={onTrack}
          className="min-h-11 md:min-h-0 inline-flex items-center gap-1 text-base md:text-sm font-semibold text-accent-subtle hover:underline underline-offset-4 cursor-pointer"
        >
          Track as a goal <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </section>
  );
};

export const GoalsView: React.FC<GoalsViewProps> = ({
  accounts,
  categories,
  householdMembers,
  onDataModified,
}) => {
  const canEdit = useCanEdit();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(false);
  const isPhone = useIsPhone();
  const [sheetGoal, setSheetGoal] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CRA Statutory Room
  const [craSummary, setCraSummary] = useState<CraSummaryResponse | null>(null);


  // Emergency Fund Calculator State
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [calcMonths, setCalcMonths] = useState<number>(3);
  const [calcLookback, setCalcLookback] = useState<number>(6);
  const [excludedCatIds, setExcludedCatIds] = useState<string[]>([]);
  const [calcData, setCalcData] = useState<EmergencyFundCalcResponse | null>(null);


  // Goal Form Modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalForm, setGoalForm] = useState<{
    name: string;
    type: GoalType;
    target_amount: number | null;
    current_amount: number | null;
    target_date: string;
    linked_account_id: string;
    owner_member_id: string;
    notes: string;
  }>({
    name: "",
    type: "SAVINGS",
    target_amount: 5000,
    current_amount: null,
    target_date: "",
    linked_account_id: "",
    owner_member_id: "",
    notes: "",
  });

  const loadGoals = async () => {
    setIsLoading(true);
    try {
      const memberParam = selectedMemberId === "ALL" ? undefined : selectedMemberId || undefined;
      const typeParam = typeFilter === "ALL" ? undefined : typeFilter || undefined;
      const data = await api.goals.getGoals(typeParam, memberParam);
      setGoals(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load goals.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadCraLimits = async () => {

    try {
      const memberParam = selectedMemberId === "ALL" ? undefined : selectedMemberId || undefined;
      const data = await api.goals.getCraLimits(memberParam);
      setCraSummary(data);
    } catch (err: any) {
      console.error("CRA limits error:", err);
    } finally {

    }
  };

  useEffect(() => {
    loadGoals();
    loadCraLimits();
  }, [selectedMemberId, typeFilter]);

  // Fetch Emergency Fund Calculation
  const fetchEmergencyCalc = async (months: number, lookback: number, excluded: string[]) => {

    try {
      const res = await api.goals.getEmergencyFundCalc(months, lookback, excluded);
      setCalcData(res);
      // If excluded wasn't initialized yet, use the response's excluded IDs
      if (excluded.length === 0 && res.excluded_category_ids.length > 0) {
        setExcludedCatIds(res.excluded_category_ids);
      }
    } catch (err: any) {
      console.error("Emergency calc error:", err);
    } finally {

    }
  };

  const handleOpenCalculator = () => {
    setShowCalcModal(true);
    fetchEmergencyCalc(calcMonths, calcLookback, excludedCatIds);
  };

  const handleToggleCategoryExclusion = (catId: string) => {
    const next = excludedCatIds.includes(catId)
      ? excludedCatIds.filter((id) => id !== catId)
      : [...excludedCatIds, catId];
    setExcludedCatIds(next);
    fetchEmergencyCalc(calcMonths, calcLookback, next);
  };

  const handleMonthsChange = (m: number) => {
    setCalcMonths(m);
    fetchEmergencyCalc(m, calcLookback, excludedCatIds);
  };

  const handleLookbackChange = (lb: number) => {
    setCalcLookback(lb);
    fetchEmergencyCalc(calcMonths, lb, excludedCatIds);
  };

  const handleSaveCalcAsGoal = async () => {
    if (!calcData) return;
    try {
      // Find liquid savings account to link if possible
      const liquidAcc = accounts.find((a) => a.type === "HISA" || a.type === "SAVINGS");
      await api.goals.createGoal({
        name: `${calcMonths}-Month Emergency Fund`,
        type: "EMERGENCY_FUND",
        target_amount: calcData.suggested_target_amount,
        current_amount: liquidAcc ? liquidAcc.current_balance : 0,
        emergency_fund_months: calcMonths,
        excluded_category_ids: excludedCatIds,
        linked_account_id: liquidAcc?.id || undefined,
        owner_member_id: selectedMemberId !== "ALL" ? selectedMemberId : undefined,
        notes: `Auto-calculated based on ${calcLookback} months average monthly expenses ($${calcData.monthly_average_included_expense.toFixed(2)}/mo).`,
      });
      setShowCalcModal(false);
      loadGoals();
      if (onDataModified) onDataModified();
    } catch (err: any) {
      alert("Failed to save emergency fund goal: " + err?.message);
    }
  };

  const handleOpenCreateGoal = (presetType: GoalType = "SAVINGS") => {
    setEditingGoal(null);
    let defaultTarget = 5000;
    if (presetType === "TFSA_ANNUAL") defaultTarget = 7000;
    if (presetType === "FHSA_ANNUAL") defaultTarget = 8000;

    setGoalForm({
      name: "",
      type: presetType,
      target_amount: defaultTarget,
      current_amount: null,
      target_date: "",
      linked_account_id: "",
      owner_member_id: selectedMemberId !== "ALL" ? selectedMemberId : getSession().me?.member_id ?? "",
      notes: "",
    });
    setIsGoalModalOpen(true);
  };

  const handleOpenEditGoal = (g: Goal) => {
    setEditingGoal(g);
    setGoalForm({
      name: g.name,
      type: g.type,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      target_date: g.target_date || "",
      linked_account_id: g.linked_account_id || "",
      owner_member_id: g.owner_member_id || "",
      notes: g.notes || "",
    });
    setIsGoalModalOpen(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalForm.name.trim()) return;

    try {
      if (editingGoal) {
        await api.goals.updateGoal(editingGoal.id, {
          name: goalForm.name.trim(),
          type: goalForm.type,
          target_amount: goalForm.target_amount ?? 0,
          current_amount: goalForm.current_amount ?? 0,
          target_date: goalForm.target_date || undefined,
          linked_account_id: goalForm.linked_account_id || undefined,
          owner_member_id: goalForm.owner_member_id || undefined,
          notes: goalForm.notes.trim() || undefined,
        });
      } else {
        await api.goals.createGoal({
          name: goalForm.name.trim(),
          type: goalForm.type,
          target_amount: goalForm.target_amount ?? 0,
          current_amount: goalForm.current_amount ?? 0,
          target_date: goalForm.target_date || undefined,
          linked_account_id: goalForm.linked_account_id || undefined,
          owner_member_id: goalForm.owner_member_id || undefined,
          notes: goalForm.notes.trim() || undefined,
        });
      }
      setIsGoalModalOpen(false);
      loadGoals();
      if (onDataModified) onDataModified();
    } catch (err: any) {
      alert("Failed to save goal: " + err?.message);
    }
  };

  const handleDeleteGoal = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete goal "${name}"?`)) return;
    try {
      await api.goals.deleteGoal(id);
      loadGoals();
      if (onDataModified) onDataModified();
    } catch (err: any) {
      alert("Failed to delete goal: " + err?.message);
    }
  };

  return (
    <div className={`max-w-7xl mx-auto ${pageStack}`}>
      {/* Header and actions */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-3xl md:text-4xl leading-tight font-semibold text-main">Goals & savings envelopes</h1>
            <span className="text-sm text-sub">Canadian edition</span>
          </div>
          <p className="mt-1 text-sm text-sub">
            Targets, CRA TFSA and FHSA annual room, and emergency buffers
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm text-sub">
            <span>Household</span>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className={`${inputCls} w-auto cursor-pointer`}
            >
              <option value="ALL">Entire household</option>
              {householdMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role || "Member"})
                </option>
              ))}
            </select>
          </label>

          <button onClick={handleOpenCalculator} className={btnSecondary}>
            <Calculator className="w-4 h-4 text-sub" strokeWidth={1.5} />
            <span>Emergency fund calculator</span>
          </button>

          {canEdit && (
          <button onClick={() => handleOpenCreateGoal("SAVINGS")} className={btnPrimary}>
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            <span>New goal</span>
          </button>
          )}
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-lg bg-negative-subtle text-base md:text-sm text-negative">
          {error}
        </div>
      )}

      {/* CRA statutory room */}
      {craSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-16">
          <CraRoomCard
            title={`TFSA contribution room (${craSummary.tax_year})`}
            tag="Statutory individual room"
            contributed={craSummary.tfsa_contributed}
            limit={craSummary.tfsa_annual_limit}
            remainingRaw={craSummary.tfsa_remaining_room}
            defaultLimit={7000}
            warning="You have exceeded the annual TFSA dollar limit. The CRA levies a 1% per month penalty tax on the excess amount until withdrawn."
            footnote="Federal annual limit indexed to inflation"
            onTrack={() => handleOpenCreateGoal("TFSA_ANNUAL")}
          />
          <CraRoomCard
            title={`FHSA contribution room (${craSummary.tax_year})`}
            tag="Tax-deductible and tax-free"
            contributed={craSummary.fhsa_contributed}
            limit={craSummary.fhsa_annual_limit}
            remainingRaw={craSummary.fhsa_remaining_room}
            defaultLimit={8000}
            warning="FHSA contributions exceed the $8,000 annual statutory allowance. A 1% per month tax penalty applies on the excess."
            footnote="$40,000 lifetime statutory ceiling"
            onTrack={() => handleOpenCreateGoal("FHSA_ANNUAL")}
          />
        </div>
      )}

      {/* Goal type filter */}
      <div className={segmentTrack}>
        <button onClick={() => setTypeFilter("ALL")} className={chipTab(typeFilter === "ALL")}>
          All goals <span className="tabular-nums text-sub">{goals.length}</span>
        </button>
        {(["EMERGENCY_FUND", "SAVINGS", "TFSA_ANNUAL", "FHSA_ANNUAL", "HBP_REPAYMENT", "DEBT_PAYOFF"] as GoalType[]).map(
          (t) => {
            const count = goals.filter((g) => g.type === t).length;
            if (count === 0 && typeFilter !== t) return null;
            return (
              <button key={t} onClick={() => setTypeFilter(t)} className={chipTab(typeFilter === t)}>
                {GOAL_TYPE_META[t].label} <span className="tabular-nums text-sub">{count}</span>
              </button>
            );
          }
        )}
      </div>

      {/* Goals grid */}
      {isLoading ? (
        <div role="status" className={`flex items-center justify-center h-48 ${loneText}`}>
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
          Loading goals…
        </div>
      ) : goals.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <div className={sectionTitle}>No goals yet</div>
          <p className="mt-2 text-base text-sub max-w-md mx-auto">
            Size an emergency fund with the 3, 6, 9 or 12-month calculator, or set up a TFSA or FHSA goal
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            <button onClick={handleOpenCalculator} className={btnSecondary}>
              Calculate emergency fund
            </button>
            <button onClick={() => handleOpenCreateGoal("SAVINGS")} className={btnPrimary}>
              Create goal
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12">
          {goals.map((g) => {
            const meta = GOAL_TYPE_META[g.type] || GOAL_TYPE_META.SAVINGS;
            const progress = Math.min(100, g.progress_percentage || 0);
            const isCompleted = progress >= 100;
            const owner = householdMembers.find((m) => m.id === g.owner_member_id);
            const current = g.effective_current_amount ?? g.current_amount ?? 0;

            return (
              <div key={g.id} className={`min-w-0 pt-5 ${hairline} flex flex-col justify-between`}>
                <div>
                  {/* Goal header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <h3 className="text-lg font-semibold text-main break-words min-w-0">
                          {g.name}
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-sub">
                        <span>{meta.label}</span>
                        {owner && (
                          <span className="inline-flex items-center gap-1.5 text-sub">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: owner.color || "var(--text-secondary)" }}
                            />
                            {owner.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {isPhone ? (
                      <button
                        type="button"
                        onClick={() => setSheetGoal(g)}
                        aria-label={`${g.name}: actions`}
                        className={iconButton}
                      >
                        <MoreHorizontal className="w-5 h-5" strokeWidth={1.75} />
                      </button>
                    ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenEditGoal(g)}
                        className={iconButton}
                        title="Edit goal"
                        aria-label="Edit goal"
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(g.id, g.name)}
                        className={dangerIconButton}
                        title="Delete goal"
                        aria-label="Delete goal"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                    )}
                  </div>

                  {/* Amounts */}
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <Money value={current} className="font-display text-2xl font-medium text-main" />
                      <div className="mt-1 text-sm text-sub">
                        of {formatMoney(g.target_amount ?? 0)} target
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-medium tabular-nums text-main">
                        {progress.toFixed(0)}%
                      </div>
                      <div className="mt-1 text-sm text-sub">
                        {isCompleted ? (
                          <span className="text-positive inline-flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} /> Reached
                          </span>
                        ) : (
                          <span className="tabular-nums">
                            {formatMoney(Math.max(0, (g.target_amount ?? 0) - current), { cents: false })} left
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full bg-surface-subtle overflow-hidden mt-4">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        isCompleted ? "bg-positive" : "bg-accent-main"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  {/* Linked account and notes */}
                  <div className="mt-4 flex flex-col gap-1 text-sm text-sub">
                    {g.linked_account ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                        <span className="text-sub">Linked account</span>
                        <span className="break-words min-w-0">{g.linked_account.name}</span>
                        <Money value={g.linked_account.current_balance ?? 0} className="text-sub" />
                      </div>
                    ) : (
                      <div>Manual tracking, no linked account</div>
                    )}

                    {g.target_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-sub" strokeWidth={1.5} />
                        <span>Target {new Date(g.target_date).toLocaleDateString(getDateLocale())}</span>
                      </div>
                    )}

                    {g.notes && <div className="break-words whitespace-pre-line">{g.notes}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Emergency fund calculator modal */}
      {showCalcModal && (
        <div className={modalOverlay}>
          <div className="relative w-full md:max-w-3xl bg-surface elevation-3 rounded-t-2xl md:rounded-2xl overflow-hidden flex flex-col max-h-[92dvh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-subtle">
              <div>
                <h2 className={sectionTitle}>Emergency fund calculator</h2>
                <p className="mt-1 text-sm text-sub">
                  Model a 3, 6, 9 or 12-month cushion and leave out non-essential spending
                </p>
              </div>
              <button
                onClick={() => setShowCalcModal(false)}
                aria-label="Close"
                className={iconButton}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-6 flex-1">
              {/* Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className={labelCls}>Target cushion</div>
                  <div className={segmentTrack}>
                    {[3, 6, 9, 12].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleMonthsChange(m)}
                        className={segment(calcMonths === m)}
                      >
                        {m} mo
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className={labelCls}>Spending lookback</div>
                  <div className={segmentTrack}>
                    {[3, 6, 12].map((lb) => (
                      <button
                        key={lb}
                        type="button"
                        onClick={() => handleLookbackChange(lb)}
                        className={segment(calcLookback === lb)}
                      >
                        Past {lb} mo
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Result */}
              {calcData && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className={labelText}>{calcMonths}-month emergency target</div>
                    <Money
                      value={calcData.suggested_target_amount ?? calcData.suggested_target ?? 0}
                      className="block mt-2 font-display text-3xl font-medium leading-none text-main"
                    />
                    <div className="mt-2 text-sm text-sub">
                      Based on{" "}
                      <span className="tabular-nums text-sub">
                        {formatMoney(calcData.monthly_average_included_expense ?? calcData.monthly_fixed_expense ?? 0)}
                      </span>{" "}
                      a month of bare-bones living expenses; unadjusted spending was{" "}
                      <span className="tabular-nums">
                        {formatMoney(
                          calcData.monthly_average_total_expense ??
                            (calcData.total_spent_in_period
                              ? calcData.total_spent_in_period / Math.max(1, calcLookback)
                              : 0)
                        )}
                      </span>{" "}
                      a month
                    </div>
                  </div>

                  <button onClick={handleSaveCalcAsGoal} className={`${btnPrimary} shrink-0`}>
                    <Check className="w-4 h-4" strokeWidth={1.5} />
                    <span>Save as emergency goal</span>
                  </button>
                </div>
              )}

              {/* Category inclusion table */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 mb-2">
                  <h3 className="text-base md:text-lg font-semibold text-main">Categories in the target</h3>
                  <span className="text-sm text-sub">
                    Uncheck discretionary categories to model a survival budget
                  </span>
                </div>

                {isPhone ? (
                  <ul className="border-y border-subtle divide-y divide-subtle">
                    {(calcData?.category_breakdown || calcData?.categories || []).map((row) => {
                      const isIncluded = !excludedCatIds.includes(row.category_id);
                      return (
                        <li key={row.category_id} className={!isIncluded ? "opacity-60" : undefined}>
                          <label className="min-h-14 py-3 flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() => handleToggleCategoryExclusion(row.category_id)}
                              className="size-5 shrink-0 rounded-md border-default text-accent-main focus:ring-accent-main"
                            />
                            <span className="flex-1 min-w-0">
                              <span className="block text-main break-words">{row.category_name}</span>
                              <span className="block text-sm text-sub">
                                {isIncluded ? "Included" : "Excluded (discretionary)"}
                              </span>
                            </span>
                            <Money value={row.monthly_average} className="text-main shrink-0" />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                <div className="border-b border-subtle">
                  <table className="w-full table-fixed text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-y border-subtle text-sm text-sub font-normal">
                        <th className="h-10 px-2 sm:px-3 w-14 text-center font-normal">Include</th>
                        <th className="h-10 px-2 sm:px-3 font-normal">Expense category</th>
                        <th className="h-10 px-2 sm:px-3 w-24 sm:w-32 text-right font-normal">Avg monthly spend</th>
                        <th className="h-10 px-2 sm:px-3 w-24 sm:w-36 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {(calcData?.category_breakdown || calcData?.categories || []).map((row) => {
                        const isIncluded = !excludedCatIds.includes(row.category_id);
                        return (
                          <tr
                            key={row.category_id}
                            className={`min-h-10 bg-surface-hover transition-colors cursor-pointer ${
                              !isIncluded ? "opacity-60" : ""
                            }`}
                            onClick={() => handleToggleCategoryExclusion(row.category_id)}
                          >
                            <td className="px-2 sm:px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isIncluded}
                                onChange={() => handleToggleCategoryExclusion(row.category_id)}
                                className="rounded-md border-default text-accent-main focus:ring-accent-main cursor-pointer"
                              />
                            </td>
                            <td className="px-2 sm:px-3 text-main break-words">
                              {row.category_name}
                            </td>
                            <td className="px-2 sm:px-3 text-right whitespace-nowrap">
                              <Money value={row.monthly_average} className="text-main" />
                            </td>
                            <td className="px-2 sm:px-3">
                              {isIncluded ? (
                                <span className="inline-flex max-w-full rounded-md px-2 py-0.5 text-sm bg-positive-subtle text-positive">
                                  Included
                                </span>
                              ) : (
                                <span
                                  title="Excluded (discretionary)"
                                  className="inline-flex max-w-full rounded-md px-2 py-0.5 text-sm bg-surface-subtle text-sub"
                                >
                                  Excluded (discretionary)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-subtle flex justify-end">
              <button onClick={() => setShowCalcModal(false)} className={btnSecondary}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goal create / edit modal */}
      {isGoalModalOpen && (
        <div className={modalOverlay}>
          <div className="relative w-full md:max-w-lg bg-surface elevation-3 rounded-t-2xl md:rounded-2xl overflow-y-auto flex flex-col max-h-[92dvh] pb-[env(safe-area-inset-bottom)] animate-in sheet-enter">
            <div className="flex items-center justify-between p-5 border-b border-subtle">
              <h2 className={sectionTitle}>
                {editingGoal ? "Edit goal" : "New goal"}
              </h2>
              <button
                onClick={() => setIsGoalModalOpen(false)}
                aria-label="Close"
                className={iconButton}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="p-5 flex flex-col gap-4">
              <div>
                <label className={labelCls}>Goal name *</label>
                <input
                  type="text"
                  value={goalForm.name}
                  onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })}
                  placeholder="Down payment"
                  className={inputCls}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Goal type</label>
                  <select
                    value={goalForm.type}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, type: e.target.value as GoalType })
                    }
                    className={inputCls}
                  >
                    {Object.entries(GOAL_TYPE_META).map(([key, m]) => (
                      <option key={key} value={key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Target amount (CAD) *</label>
                  <NumberField
                    step="0.01"
                    min="1"
                    value={goalForm.target_amount}
                    onValueChange={(v) => setGoalForm({ ...goalForm, target_amount: v })}
                    className={`${inputCls} tabular-nums`}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Current amount (CAD)</label>
                  <NumberField
                    step="0.01"
                    min="0"
                    value={goalForm.current_amount}
                    onValueChange={(v) => setGoalForm({ ...goalForm, current_amount: v })}
                    className={`${inputCls} tabular-nums`}
                  />
                  <span className="mt-1 block text-sm text-sub">
                    A linked account overrides this
                  </span>
                </div>

                <div>
                  <label className={labelCls}>Linked account (optional)</label>
                  <select
                    value={goalForm.linked_account_id}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, linked_account_id: e.target.value })
                    }
                    className={inputCls}
                  >
                    <option value="">None (manual balance)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatMoney(a.current_balance)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Owner</label>
                  <select
                    value={goalForm.owner_member_id}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, owner_member_id: e.target.value })
                    }
                    className={inputCls}
                  >
                    <option value="">Joint / entire household</option>
                    {householdMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Target date (optional)</label>
                  <input
                    type="date"
                    value={goalForm.target_date}
                    onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Notes (optional)</label>
                <textarea
                  value={goalForm.notes}
                  onChange={(e) => setGoalForm({ ...goalForm, notes: e.target.value })}
                  rows={2}
                  placeholder="Notes"
                  className="w-full px-3 py-2 rounded-t-lg rounded-b-none border-0 border-b-2 border-default bg-surface-subtle text-base md:text-sm text-main placeholder:text-sub focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-subtle">
                <button type="button" onClick={() => setIsGoalModalOpen(false)} className={btnSecondary}>
                  Cancel
                </button>
                <button type="submit" className={btnPrimary}>
                  {editingGoal ? "Save changes" : "Create goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Phone: a goal's actions */}
      {sheetGoal && (
        <ActionSheet
          open
          onClose={() => setSheetGoal(null)}
          title={sheetGoal.name}
          subtitle={(GOAL_TYPE_META[sheetGoal.type] || GOAL_TYPE_META.SAVINGS).label}
          actions={[
            { label: "Edit goal", icon: Edit2, onSelect: () => handleOpenEditGoal(sheetGoal) },
            {
              label: "Delete goal",
              icon: Trash2,
              destructive: true,
              onSelect: () => handleDeleteGoal(sheetGoal.id, sheetGoal.name),
            },
          ]}
        />
      )}
    </div>
  );
};
