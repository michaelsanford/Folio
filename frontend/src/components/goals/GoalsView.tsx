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
import { formatMoney } from "../../utils/format";

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

const card = "rounded-xl bg-surface border border-subtle";
const btnPrimary =
  "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer";
const btnSecondary =
  "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer";
const inputCls =
  "w-full h-9 px-3 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]";
const labelCls = "block text-xs text-sub mb-1";
const segment = (active: boolean) =>
  `h-8 px-3 rounded-lg text-sm whitespace-nowrap border transition-colors cursor-pointer ${
    active
      ? "bg-surface-subtle border-default text-main font-medium"
      : "border-transparent text-sub hover:text-main bg-surface-hover"
  }`;

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

/** One CRA statutory room card (TFSA or FHSA). */
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
    <div className={`${card} p-5 flex flex-col justify-between`}>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-medium text-main">{title}</h2>
          <span className="text-xs text-muted">{tag}</span>
        </div>

        <div className="mt-4 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-medium leading-none text-main">
            <Money value={contributed ?? 0} />
            <span className="ml-2 text-xs text-muted">
              of {formatMoney(limit ?? defaultLimit, { cents: false })} limit
            </span>
          </div>
          <span className={`text-xs font-mono ${isOver ? "text-negative" : "text-sub"}`}>
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
              backgroundColor: exceeded ? undefined : "var(--text-muted)",
            }}
          />
        </div>

        {exceeded && (
          <div className="mt-4 p-3 rounded-lg bg-negative-subtle border border-negative/30 text-xs text-negative flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>
              <span className="font-medium">CRA excess warning:</span> {warning}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-subtle flex items-center justify-between gap-3 text-xs text-muted">
        <span>{footnote}</span>
        <button
          onClick={onTrack}
          className="inline-flex items-center gap-1 text-sm text-accent-subtle hover:underline underline-offset-4 cursor-pointer"
        >
          Track as a goal <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};

export const GoalsView: React.FC<GoalsViewProps> = ({
  accounts,
  categories,
  householdMembers,
  onDataModified,
}) => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(false);
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
    target_amount: number;
    current_amount: number;
    target_date: string;
    linked_account_id: string;
    owner_member_id: string;
    notes: string;
  }>({
    name: "",
    type: "SAVINGS",
    target_amount: 5000,
    current_amount: 0,
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
      current_amount: 0,
      target_date: "",
      linked_account_id: "",
      owner_member_id: selectedMemberId !== "ALL" ? selectedMemberId : "",
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
          target_amount: goalForm.target_amount,
          current_amount: goalForm.current_amount,
          target_date: goalForm.target_date || undefined,
          linked_account_id: goalForm.linked_account_id || undefined,
          owner_member_id: goalForm.owner_member_id || undefined,
          notes: goalForm.notes.trim() || undefined,
        });
      } else {
        await api.goals.createGoal({
          name: goalForm.name.trim(),
          type: goalForm.type,
          target_amount: goalForm.target_amount,
          current_amount: goalForm.current_amount,
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
    <div className="max-w-7xl mx-auto flex flex-col gap-6">
      {/* Header and actions */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-medium text-main">Goals & savings envelopes</h1>
            <span className="text-xs text-muted">Canadian edition</span>
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

          <button onClick={() => handleOpenCreateGoal("SAVINGS")} className={btnPrimary}>
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            <span>New goal</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="p-3 rounded-lg bg-negative-subtle border border-negative/30 text-sm text-negative">
          {error}
        </div>
      )}

      {/* CRA statutory room */}
      {craSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      <div className="flex items-center gap-1 overflow-x-auto">
        <button onClick={() => setTypeFilter("ALL")} className={segment(typeFilter === "ALL")}>
          All goals <span className="font-mono text-muted">{goals.length}</span>
        </button>
        {(["EMERGENCY_FUND", "SAVINGS", "TFSA_ANNUAL", "FHSA_ANNUAL", "HBP_REPAYMENT", "DEBT_PAYOFF"] as GoalType[]).map(
          (t) => {
            const count = goals.filter((g) => g.type === t).length;
            if (count === 0 && typeFilter !== t) return null;
            return (
              <button key={t} onClick={() => setTypeFilter(t)} className={segment(typeFilter === t)}>
                {GOAL_TYPE_META[t].label} <span className="font-mono text-muted">{count}</span>
              </button>
            );
          }
        )}
      </div>

      {/* Goals grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-subtle border-t-[var(--accent-primary)] mr-3"></div>
          Loading goals…
        </div>
      ) : goals.length === 0 ? (
        <div className={`${card} p-6 py-12 text-center`}>
          <div className="text-base font-medium text-main">No goals yet</div>
          <p className="mt-1 text-sm text-sub max-w-md mx-auto">
            Size an emergency fund with the 3, 6, 9 or 12-month calculator, or set up a TFSA or FHSA goal
          </p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={handleOpenCalculator} className={btnSecondary}>
              Calculate emergency fund
            </button>
            <button onClick={() => handleOpenCreateGoal("SAVINGS")} className={btnPrimary}>
              Create goal
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((g) => {
            const meta = GOAL_TYPE_META[g.type] || GOAL_TYPE_META.SAVINGS;
            const progress = Math.min(100, g.progress_percentage || 0);
            const isCompleted = progress >= 100;
            const owner = householdMembers.find((m) => m.id === g.owner_member_id);
            const current = g.effective_current_amount ?? g.current_amount ?? 0;

            return (
              <div key={g.id} className={`${card} p-5 flex flex-col justify-between`}>
                <div>
                  {/* Goal header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <h3 className="text-base font-medium text-main truncate" title={g.name}>
                          {g.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                        <span>{meta.label}</span>
                        {owner && (
                          <span className="inline-flex items-center gap-1.5 text-sub">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: owner.color || "var(--text-muted)" }}
                            />
                            {owner.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenEditGoal(g)}
                        className="p-1.5 rounded-lg text-muted hover:text-main bg-surface-hover transition-colors"
                        title="Edit goal"
                      >
                        <Edit2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(g.id, g.name)}
                        className="p-1.5 rounded-lg text-muted hover:text-negative bg-surface-hover transition-colors"
                        title="Delete goal"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <Money value={current} className="text-xl font-medium text-main" />
                      <div className="mt-1 text-xs text-muted">
                        of {formatMoney(g.target_amount ?? 0)} target
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-medium font-mono text-main">
                        {progress.toFixed(0)}%
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {isCompleted ? (
                          <span className="text-positive inline-flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} /> Reached
                          </span>
                        ) : (
                          <span className="font-mono">
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
                  <div className="mt-4 flex flex-col gap-1 text-xs text-muted">
                    {g.linked_account ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sub">Linked account</span>
                        <span className="truncate">{g.linked_account.name}</span>
                        <Money value={g.linked_account.current_balance ?? 0} className="text-sub" />
                      </div>
                    ) : (
                      <div>Manual tracking, no linked account</div>
                    )}

                    {g.target_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted" strokeWidth={1.5} />
                        <span>Target {new Date(g.target_date).toLocaleDateString()}</span>
                      </div>
                    )}

                    {g.notes && <div className="line-clamp-2">{g.notes}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Emergency fund calculator modal */}
      {showCalcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
          <div className="relative w-full max-w-3xl bg-surface border border-default rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-subtle">
              <div>
                <h2 className="text-base font-medium text-main">Emergency fund calculator</h2>
                <p className="mt-1 text-sm text-sub">
                  Model a 3, 6, 9 or 12-month cushion and leave out non-essential spending
                </p>
              </div>
              <button
                onClick={() => setShowCalcModal(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-muted hover:text-main bg-surface-hover transition-colors"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-6 flex-1">
              {/* Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className={labelCls}>Target cushion</div>
                  <div className="grid grid-cols-4 gap-1">
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
                  <div className="grid grid-cols-3 gap-1">
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
                <div className="p-4 rounded-xl bg-surface-subtle border border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-sub">{calcMonths}-month emergency target</div>
                    <Money
                      value={calcData.suggested_target_amount ?? calcData.suggested_target ?? 0}
                      className="block mt-2 text-2xl font-medium leading-none text-main"
                    />
                    <div className="mt-2 text-xs text-muted">
                      Based on{" "}
                      <span className="font-mono text-sub">
                        {formatMoney(calcData.monthly_average_included_expense ?? calcData.monthly_fixed_expense ?? 0)}
                      </span>{" "}
                      a month of bare-bones living expenses; unadjusted spending was{" "}
                      <span className="font-mono">
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
                  <h3 className="text-base font-medium text-main">Categories in the target</h3>
                  <span className="text-xs text-muted">
                    Uncheck discretionary categories to model a survival budget
                  </span>
                </div>

                <div className="border border-subtle rounded-xl overflow-hidden bg-surface">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-subtle text-xs text-muted font-normal">
                        <th className="h-9 px-3 w-16 text-center font-normal">Include</th>
                        <th className="h-9 px-3 font-normal">Expense category</th>
                        <th className="h-9 px-4 text-right font-normal">Avg monthly spend</th>
                        <th className="h-9 px-3 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {(calcData?.category_breakdown || calcData?.categories || []).map((row) => {
                        const isIncluded = !excludedCatIds.includes(row.category_id);
                        return (
                          <tr
                            key={row.category_id}
                            className={`h-10 bg-surface-hover transition-colors cursor-pointer ${
                              !isIncluded ? "opacity-60" : ""
                            }`}
                            onClick={() => handleToggleCategoryExclusion(row.category_id)}
                          >
                            <td className="px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isIncluded}
                                onChange={() => handleToggleCategoryExclusion(row.category_id)}
                                className="rounded-md border-default text-accent-main focus:ring-accent-main cursor-pointer"
                              />
                            </td>
                            <td className="px-3 text-main">{row.category_name}</td>
                            <td className="px-4 text-right">
                              <Money value={row.monthly_average} className="text-main" />
                            </td>
                            <td className="px-3">
                              {isIncluded ? (
                                <span className="rounded-md px-1.5 py-0.5 text-xs bg-positive-subtle text-positive">
                                  Included
                                </span>
                              ) : (
                                <span className="rounded-md px-1.5 py-0.5 text-xs bg-surface-subtle text-muted">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in">
          <div className="relative w-full max-w-lg bg-surface border border-default rounded-xl shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-subtle">
              <h2 className="text-base font-medium text-main">
                {editingGoal ? "Edit goal" : "New goal"}
              </h2>
              <button
                onClick={() => setIsGoalModalOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-muted hover:text-main bg-surface-hover transition-colors"
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
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={goalForm.target_amount}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, target_amount: parseFloat(e.target.value) || 0 })
                    }
                    className={`${inputCls} font-mono`}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Current amount (CAD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={goalForm.current_amount}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, current_amount: parseFloat(e.target.value) || 0 })
                    }
                    className={`${inputCls} font-mono`}
                  />
                  <span className="mt-1 block text-[11px] text-muted">
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
                  className="w-full px-3 py-2 rounded-lg border border-default bg-input text-sm text-main placeholder:text-muted focus:outline-none focus:border-[var(--accent-primary)]"
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
    </div>
  );
};
