import React from "react";
import { formatMoney } from "../../utils/format";

interface CreditUsageProps {
  /** Amount owed (positive), or a credit when negative. */
  balance: number;
  limit: number;
  /** One line instead of the bar, for dense lists. */
  compact?: boolean;
}

/** Utilization under 30% is what Canadian credit bureaus treat as healthy. */
export const HEALTHY_UTILIZATION = 0.3;
const HIGH_UTILIZATION = 0.75;

export function creditUsage(balance: number, limit: number) {
  const owed = Math.max(0, balance);
  const available = limit - balance;
  const ratio = limit > 0 ? owed / limit : 0;
  const level = available < 0 || ratio > HIGH_UTILIZATION ? "high" : ratio > HEALTHY_UTILIZATION ? "elevated" : "healthy";
  return { owed, available, ratio, level } as const;
}

const BAR_COLOR = {
  healthy: "var(--accent-primary)",
  elevated: "var(--fin-warning)",
  high: "var(--fin-negative)",
} as const;

/** How much of a card's limit is left, as a bar and a line of text. */
export const CreditUsage: React.FC<CreditUsageProps> = ({ balance, limit, compact = false }) => {
  const { available, ratio, level } = creditUsage(balance, limit);
  const money = (v: number) => formatMoney(v, { cents: false });

  const headline =
    available < 0 ? (
      <span className="text-negative">{money(-available)} over limit</span>
    ) : (
      <span className="text-main">{money(available)} available</span>
    );

  if (compact) {
    return available < 0 ? (
      <span className="text-negative tabular-nums">{money(-available)} over limit</span>
    ) : (
      <span className="tabular-nums">{money(available)} left</span>
    );
  }

  const percentUsed = Math.round(ratio * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums font-medium">{headline}</span>
        <span className="text-muted tabular-nums">
          {balance < 0 ? `${money(-balance)} credit · ` : `${percentUsed}% used · `}
          {money(limit)} limit
        </span>
      </div>
      <div
        role="meter"
        aria-label="Credit used"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.max(0, Math.min(balance, limit))}
        aria-valuetext={`${percentUsed}% of the limit used`}
        className="h-1.5 rounded-full bg-surface-subtle overflow-hidden"
      >
        <div
          data-level={level}
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: BAR_COLOR[level] }}
        />
      </div>
    </div>
  );
};
