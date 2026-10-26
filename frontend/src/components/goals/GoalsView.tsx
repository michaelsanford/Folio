import React, { useState, useEffect, useMemo } from "react";
import {
  Target,
  ShieldCheck,
  TrendingUp,
  Plus,
  Trash2,
  Edit2,
  Calculator,
  AlertTriangle,
  Calendar,
  DollarSign,
  Users,
  Check,
  CheckCircle2,
  ArrowRight,
  Info,
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

interface GoalsViewProps {
  accounts: Account[];
  categories: Category[];
  householdMembers: HouseholdMember[];
  onDataModified?: () => void;
}

const GOAL_TYPE_META: Record<GoalType, { label: string; color: string; description: string }> = {
  SAVINGS: {
    label: "General Savings",
    color: "#3B82F6",
    description: "General goal (e.g. down payment, car, vacation, large purchase)",
  },
  EMERGENCY_FUND: {
    label: "Emergency Fund",
    color: "#10B981",
    description: "Liquid safety buffer (typically 3–6 months of essential living expenses)",
  },
  TFSA_ANNUAL: {
    label: "TFSA Contribution",
    color: "#8B5CF6",
    description: "Tax-Free Savings Account annual contribution room ($7,000 for 2024–2026)",
  },
  FHSA_ANNUAL: {
    label: "FHSA Contribution",
    color: "#EC4899",
    description: "First Home Savings Account annual room ($8,000/yr, $40k lifetime max)",
  },
  HBP_REPAYMENT: {
    label: "Home Buyers' Plan",
    color: "#F59E0B",
    description: "Annual RRSP Home Buyers' Plan repayment schedule (1/15th per year)",
  },
  DEBT_PAYOFF: {
    label: "Debt Payoff",
    color: "#EF4444",
    description: "Targeted liability acceleration (loan, line of credit, or mortgage prepay)",
  },
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
  const [isLoadingCra, setIsLoadingCra] = useState(false);

  // Emergency Fund Calculator State
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [calcMonths, setCalcMonths] = useState<number>(3);
  const [calcLookback, setCalcLookback] = useState<number>(6);
  const [excludedCatIds, setExcludedCatIds] = useState<string[]>([]);
  const [calcData, setCalcData] = useState<EmergencyFundCalcResponse | null>(null);
  const [isLoadingCalc, setIsLoadingCalc] = useState(false);

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
    setIsLoadingCra(true);
    try {
      const memberParam = selectedMemberId === "ALL" ? undefined : selectedMemberId || undefined;
      const data = await api.goals.getCraLimits(memberParam);
      setCraSummary(data);
    } catch (err: any) {
      console.error("CRA limits error:", err);
    } finally {
      setIsLoadingCra(false);
    }
  };

  useEffect(() => {
    loadGoals();
    loadCraLimits();
  }, [selectedMemberId, typeFilter]);

  // Fetch Emergency Fund Calculation
  const fetchEmergencyCalc = async (months: number, lookback: number, excluded: string[]) => {
    setIsLoadingCalc(true);
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
      setIsLoadingCalc(false);
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-main">Goals & Savings Envelopes</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-subtle text-accent-subtle uppercase">
              Canadian Edition
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Track dedicated targets, CRA TFSA/FHSA annual statutory rooms, and emergency buffers with discretionary category models.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Member Scope Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-default text-xs">
            <Users className="w-3.5 h-3.5 text-muted" />
            <span className="text-muted font-medium">Household:</span>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="bg-transparent text-main font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">Entire Household</option>
              {householdMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role || "Member"})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleOpenCalculator}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-default text-main text-xs font-semibold shadow-2xs transition-all cursor-pointer"
          >
            <Calculator className="w-3.5 h-3.5 text-accent-main" />
            <span>Emergency Fund Calc</span>
          </button>

          <button
            onClick={() => handleOpenCreateGoal("SAVINGS")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Goal</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative">
          {error}
        </div>
      )}

      {/* Canadian Statutory CRA Tracking Cards */}
      {craSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* TFSA Card */}
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted">
                    TFSA Contribution Room ({craSummary.tax_year})
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-purple-600 bg-purple-500/10 px-2 py-0.5 rounded-md">
                  Statutory Individual Room
                </span>
              </div>

              <div className="mt-3 flex items-baseline justify-between">
                <div className="text-2xl font-bold font-mono text-main">
                  ${craSummary.tfsa_contributed.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
                  <span className="text-xs font-sans text-muted ml-1">
                    / ${craSummary.tfsa_annual_limit.toLocaleString("en-CA")} limit
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs font-mono font-bold ${
                      craSummary.tfsa_remaining_room >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    ${Math.abs(craSummary.tfsa_remaining_room).toLocaleString("en-CA")}{" "}
                    {craSummary.tfsa_remaining_room >= 0 ? "remaining" : "OVER LIMIT"}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-surface-subtle h-2 rounded-full overflow-hidden mt-3 border border-subtle">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    craSummary.tfsa_contributed > craSummary.tfsa_annual_limit
                      ? "bg-negative"
                      : "bg-purple-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (craSummary.tfsa_contributed / craSummary.tfsa_annual_limit) * 100
                    )}%`,
                  }}
                />
              </div>

              {craSummary.tfsa_contributed > craSummary.tfsa_annual_limit && (
                <div className="mt-3 p-2.5 rounded-xl bg-negative-subtle border border-rose-500/40 text-[11px] text-negative flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <b>CRA Excess Warning:</b> You have exceeded the annual TFSA dollar limit. The CRA levies a 1% per month penalty tax on the excess amount until withdrawn.
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-subtle flex items-center justify-between text-[11px] text-muted">
              <span>Federal annual limit indexed to inflation</span>
              <button
                onClick={() => handleOpenCreateGoal("TFSA_ANNUAL")}
                className="text-purple-600 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                Track as Dedicated Goal <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* FHSA Card */}
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-pink-500"></span>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted">
                    FHSA Contribution Room ({craSummary.tax_year})
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-pink-600 bg-pink-500/10 px-2 py-0.5 rounded-md">
                  Tax-Deductible + Tax-Free
                </span>
              </div>

              <div className="mt-3 flex items-baseline justify-between">
                <div className="text-2xl font-bold font-mono text-main">
                  ${craSummary.fhsa_contributed.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
                  <span className="text-xs font-sans text-muted ml-1">
                    / ${craSummary.fhsa_annual_limit.toLocaleString("en-CA")} limit
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs font-mono font-bold ${
                      craSummary.fhsa_remaining_room >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    ${Math.abs(craSummary.fhsa_remaining_room).toLocaleString("en-CA")}{" "}
                    {craSummary.fhsa_remaining_room >= 0 ? "remaining" : "OVER LIMIT"}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-surface-subtle h-2 rounded-full overflow-hidden mt-3 border border-subtle">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    craSummary.fhsa_contributed > craSummary.fhsa_annual_limit
                      ? "bg-negative"
                      : "bg-pink-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (craSummary.fhsa_contributed / craSummary.fhsa_annual_limit) * 100
                    )}%`,
                  }}
                />
              </div>

              {craSummary.fhsa_contributed > craSummary.fhsa_annual_limit && (
                <div className="mt-3 p-2.5 rounded-xl bg-negative-subtle border border-rose-500/40 text-[11px] text-negative flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <b>CRA Excess Warning:</b> FHSA contributions exceed the $8,000 annual statutory allowance. 1%/mo tax penalty applies on excess.
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-subtle flex items-center justify-between text-[11px] text-muted">
              <span>$40,000 lifetime statutory ceiling</span>
              <button
                onClick={() => handleOpenCreateGoal("FHSA_ANNUAL")}
                className="text-pink-600 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                Track as Dedicated Goal <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goals Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setTypeFilter("ALL")}
          className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
            typeFilter === "ALL"
              ? "bg-accent-main text-accent-contrast shadow-xs"
              : "bg-surface text-sub border border-default hover:bg-surface-hover"
          }`}
        >
          All Goals ({goals.length})
        </button>
        {(["EMERGENCY_FUND", "SAVINGS", "TFSA_ANNUAL", "FHSA_ANNUAL", "HBP_REPAYMENT", "DEBT_PAYOFF"] as GoalType[]).map(
          (t) => {
            const count = goals.filter((g) => g.type === t).length;
            if (count === 0 && typeFilter !== t) return null;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-xl font-semibold transition-all cursor-pointer ${
                  typeFilter === t
                    ? "bg-accent-main text-accent-contrast shadow-xs"
                    : "bg-surface text-sub border border-default hover:bg-surface-hover"
                }`}
              >
                {GOAL_TYPE_META[t].label} ({count})
              </button>
            );
          }
        )}
      </div>

      {/* Goals Grid */}
      {isLoading ? (
        <div className="py-20 text-center text-muted">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main mx-auto mb-3"></div>
          Loading financial goals...
        </div>
      ) : goals.length === 0 ? (
        <div className="py-16 text-center text-muted px-4 rounded-2xl bg-surface border border-default shadow-xs">
          <Target className="w-12 h-12 text-muted mx-auto mb-3 opacity-40" />
          <div className="text-sm font-semibold text-main">No active goals yet</div>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Create an Emergency Fund buffer using our 3/6/9/12 month calculator, or set up a dedicated TFSA or FHSA milestone.
          </p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={handleOpenCalculator}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-default text-main text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            >
              Calculate Emergency Fund
            </button>
            <button
              onClick={() => handleOpenCreateGoal("SAVINGS")}
              className="px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer"
            >
              Create New Goal
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

            return (
              <div
                key={g.id}
                className="p-5 rounded-2xl bg-surface border border-default shadow-xs flex flex-col justify-between hover:border-subtle transition-all"
              >
                <div>
                  {/* Goal Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <h3 className="font-bold text-sm text-main truncate" title={g.name}>
                          {g.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-semibold text-muted uppercase">
                          {meta.label}
                        </span>
                        {owner && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: owner.color || "#3B82F6" }}
                          >
                            {owner.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenEditGoal(g)}
                        className="p-1 rounded-md text-muted hover:text-main hover:bg-surface-hover transition-colors"
                        title="Edit goal"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(g.id, g.name)}
                        className="p-1 rounded-md text-muted hover:text-negative hover:bg-surface-hover transition-colors"
                        title="Delete goal"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="mt-4 flex items-baseline justify-between">
                    <div>
                      <div className="text-xl font-bold font-mono text-main">
                        ${g.effective_current_amount.toLocaleString("en-CA", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <div className="text-[11px] text-muted">
                        of ${g.target_amount.toLocaleString("en-CA", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        target
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold font-mono text-accent-main">
                        {progress.toFixed(0)}%
                      </div>
                      <div className="text-[11px] text-muted">
                        {isCompleted ? (
                          <span className="text-positive font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Reached!
                          </span>
                        ) : (
                          `$${Math.max(0, g.target_amount - g.effective_current_amount).toLocaleString(
                            "en-CA",
                            { maximumFractionDigits: 0 }
                          )} left`
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-surface-subtle h-2.5 rounded-full overflow-hidden mt-3 border border-subtle">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        isCompleted ? "bg-positive" : "bg-accent-main"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  {/* Linked Account or Notes */}
                  <div className="mt-3 space-y-1">
                    {g.linked_account ? (
                      <div className="text-[11px] text-muted flex items-center gap-1.5">
                        <span className="font-semibold text-main">Linked Account:</span>
                        <span className="truncate">{g.linked_account.name}</span>
                        <span className="text-positive font-mono font-medium">
                          (${g.linked_account.current_balance.toLocaleString("en-CA")})
                        </span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted">Manual tracking (unlinked)</div>
                    )}

                    {g.target_date && (
                      <div className="text-[11px] text-muted flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-muted" />
                        <span>Target: {new Date(g.target_date).toLocaleDateString()}</span>
                      </div>
                    )}

                    {g.notes && (
                      <div className="text-[11px] text-muted italic line-clamp-2">
                        "{g.notes}"
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Emergency Fund Interactive Calculator Modal */}
      {showCalcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-3xl bg-surface border border-default rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between p-5 border-b border-subtle">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-subtle text-accent-subtle flex items-center justify-center">
                  <Calculator className="w-5 h-5 text-accent-main" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-main">Emergency Fund Auto-Calculator</h2>
                  <p className="text-xs text-muted">
                    Model 3/6/9/12 month safety cushions and exclude non-essential spending.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCalcModal(false)}
                className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-hover"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Parameter Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-surface-subtle border border-default">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">
                    Target Cushion Months
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[3, 6, 9, 12].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleMonthsChange(m)}
                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          calcMonths === m
                            ? "bg-accent-main text-accent-contrast shadow-xs"
                            : "bg-surface border border-default text-sub hover:bg-surface-hover"
                        }`}
                      >
                        {m} Mo
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">
                    Historical Spend Lookback
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[3, 6, 12].map((lb) => (
                      <button
                        key={lb}
                        type="button"
                        onClick={() => handleLookbackChange(lb)}
                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          calcLookback === lb
                            ? "bg-accent-main text-accent-contrast shadow-xs"
                            : "bg-surface border border-default text-sub hover:bg-surface-hover"
                        }`}
                      >
                        Past {lb} Mo
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Calculated Result Banner */}
              {calcData && (
                <div className="p-4 rounded-xl bg-accent-subtle/40 border border-accent-main/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-accent-subtle font-semibold">
                      Calculated {calcMonths}-Month Emergency Target
                    </div>
                    <div className="text-2xl font-bold font-mono text-main mt-0.5">
                      ${calcData.suggested_target_amount.toLocaleString("en-CA", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-[11px] text-muted mt-1">
                      Based on{" "}
                      <b>
                        ${calcData.monthly_average_included_expense.toFixed(2)} / month
                      </b>{" "}
                      bare-bones living expenses (total unadjusted spend was $
                      {calcData.monthly_average_total_expense.toFixed(2)}/mo).
                    </div>
                  </div>

                  <button
                    onClick={handleSaveCalcAsGoal}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer transition-all shrink-0"
                  >
                    <Check className="w-4 h-4" />
                    <span>Save as Emergency Goal</span>
                  </button>
                </div>
              )}

              {/* Hypothetical Category Reduction / Exclusion Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                    Hypothetical Category Spending Inclusions / Exclusions
                  </h3>
                  <span className="text-[11px] text-muted">
                    Uncheck discretionary categories to model survival budget
                  </span>
                </div>

                <div className="border border-default rounded-xl overflow-hidden bg-surface">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-surface-subtle border-b border-subtle text-muted font-semibold">
                        <th className="py-2.5 px-3 w-10 text-center">Include</th>
                        <th className="py-2.5 px-3">Expense Category</th>
                        <th className="py-2.5 px-4 text-right">Avg Monthly Spend</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {calcData?.category_breakdown.map((row) => {
                        const isIncluded = !excludedCatIds.includes(row.category_id);
                        return (
                          <tr
                            key={row.category_id}
                            className={`hover:bg-surface-hover transition-colors cursor-pointer ${
                              !isIncluded ? "opacity-60 bg-surface-subtle/30" : ""
                            }`}
                            onClick={() => handleToggleCategoryExclusion(row.category_id)}
                          >
                            <td className="py-2.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isIncluded}
                                onChange={() => handleToggleCategoryExclusion(row.category_id)}
                                className="rounded-md border-default text-accent-main focus:ring-accent-main cursor-pointer"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-main">
                              {row.category_name}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-medium text-main">
                              ${row.monthly_average.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3">
                              {isIncluded ? (
                                <span className="text-[10px] font-semibold text-positive bg-emerald-500/10 px-2 py-0.5 rounded-md">
                                  Included
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-muted bg-surface-subtle px-2 py-0.5 rounded-md">
                                  Excluded (Discretionary)
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

            <div className="p-4 border-t border-subtle bg-surface-subtle flex justify-end">
              <button
                onClick={() => setShowCalcModal(false)}
                className="px-4 py-2 rounded-xl bg-surface border border-default hover:bg-surface-hover text-main text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goal Create / Edit Modal */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-lg bg-surface border border-default rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-subtle">
              <h2 className="text-base font-bold text-main">
                {editingGoal ? "Edit Goal" : "Create New Goal"}
              </h2>
              <button
                onClick={() => setIsGoalModalOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-main"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1">
                  Goal Name *
                </label>
                <input
                  type="text"
                  value={goalForm.name}
                  onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })}
                  placeholder="e.g. 2026 TFSA Max, Down Payment, Home Reno"
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Goal Type
                  </label>
                  <select
                    value={goalForm.type}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, type: e.target.value as GoalType })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  >
                    {Object.entries(GOAL_TYPE_META).map(([key, m]) => (
                      <option key={key} value={key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Target Amount ($CAD) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={goalForm.target_amount}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, target_amount: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Current Amount ($CAD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={goalForm.current_amount}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, current_amount: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  />
                  <span className="text-[10px] text-muted">
                    Overridden by linked account if specified.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Linked Account (Optional)
                  </label>
                  <select
                    value={goalForm.linked_account_id}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, linked_account_id: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  >
                    <option value="">None (Manual Balance)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (${a.current_balance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Owner Household Member
                  </label>
                  <select
                    value={goalForm.owner_member_id}
                    onChange={(e) =>
                      setGoalForm({ ...goalForm, owner_member_id: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  >
                    <option value="">Joint / Entire Household</option>
                    {householdMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Target Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={goalForm.target_date}
                    onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })}
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={goalForm.notes}
                  onChange={(e) => setGoalForm({ ...goalForm, notes: e.target.value })}
                  rows={2}
                  placeholder="e.g. Save for 20% down payment on condo in Vancouver or Toronto"
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main placeholder-muted focus:ring-1 focus:ring-accent-main focus:outline-hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setIsGoalModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-surface border border-default hover:bg-surface-hover text-main text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer"
                >
                  {editingGoal ? "Save Changes" : "Create Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
