export type BudgetLineStatus = "OVER" | "WARNING" | "ON_TRACK" | "UNSPENT";

export interface BudgetLineState {
  status: BudgetLineStatus;
  /** Spending past the target, including any spending against a $0 target. */
  isOver: boolean;
  /** Share of the target spent, for bars (capped by the caller); 100 when there is no target but some spending. */
  percentUsed: number;
  /** What to show for the share spent: a percentage, or "No target". */
  usedLabel: string;
}

/** Where one budget line stands this month. */
export function budgetLineState(planned: number, actual: number): BudgetLineState {
  const hasTarget = planned > 0;
  const isOver = actual > planned && actual > 0;
  const percentUsed = hasTarget ? Math.round((actual / planned) * 100) : actual > 0 ? 100 : 0;
  const status: BudgetLineStatus =
    actual === 0 ? "UNSPENT" : isOver ? "OVER" : percentUsed >= 80 ? "WARNING" : "ON_TRACK";
  return { status, isOver, percentUsed, usedLabel: hasTarget ? `${percentUsed}%` : "No target" };
}
