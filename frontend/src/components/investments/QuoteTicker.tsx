import React, { useEffect, useRef, useState } from "react";
import { QuoteBadge } from "./QuoteBadge";
import { formatMoney, formatPercent } from "../../utils/format";
import type { HoldingValuation } from "../../types";

interface QuoteTickerProps {
  holdings: HoldingValuation[];
  currency: string;
}

/** Below this many items the strip sits still: a two-item loop just looks busy. */
const MIN_SCROLLING_ITEMS = 3;
/** Seconds per item, so reading speed stays the same however many there are. */
const SECONDS_PER_ITEM = 5;

const usePrefersReducedMotion = () => {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};

const TickerItem: React.FC<{ h: HoldingValuation; currency: string; flash: boolean }> = ({ h, currency, flash }) => {
  const change = h.day_change;
  const tone = change == null || change === 0 ? "text-muted" : change > 0 ? "text-positive" : "text-negative";
  const arrow = change == null || change === 0 ? "" : change > 0 ? "▲" : "▼";
  return (
    <li
      className="ticker-item flex items-baseline gap-2 px-4 h-10 shrink-0 rounded-md whitespace-nowrap"
      data-flash={flash ? "true" : undefined}
    >
      <span className="font-mono text-sm text-main">{h.quote_symbol || h.symbol}</span>
      {h.is_priced && h.price != null ? (
        <span className="text-sm text-main tabular-nums">
          {formatMoney(h.price, { currency })}
          <QuoteBadge source={h.price_source} session={h.price_session} quotedAt={h.price_quoted_at} />
        </span>
      ) : (
        <span className="text-xs text-warning">No price</span>
      )}
      {change != null && (
        <span className={`text-xs tabular-nums ${tone}`}>
          <span aria-hidden="true">{arrow} </span>
          {formatMoney(change, { currency, signed: true })}
          {h.day_change_pct != null && ` (${formatPercent(h.day_change_pct, true)})`}
        </span>
      )}
    </li>
  );
};

/**
 * A strip of the account's holdings with their latest delayed prices and the
 * day's change. It changes only when quotes are refreshed (on first visit, or
 * the button); it never polls. Hover or focus pauses it; reduced motion, or
 * too few holdings to loop, shows a still row that scrolls by hand.
 */
export const QuoteTicker: React.FC<QuoteTickerProps> = ({ holdings, currency }) => {
  const reducedMotion = usePrefersReducedMotion();

  // Briefly tint items whose price changed since the last refresh.
  const previous = useRef<Map<string, number | null | undefined>>(new Map());
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const priceKey = holdings.map((h) => `${h.holding_id}:${h.price}`).join("|");
  useEffect(() => {
    const changed = new Set<string>();
    for (const h of holdings) {
      const before = previous.current.get(h.holding_id);
      if (previous.current.size > 0 && before !== undefined && before !== h.price) changed.add(h.holding_id);
    }
    previous.current = new Map(holdings.map((h) => [h.holding_id, h.price]));
    setFlashing(changed);
    if (changed.size === 0) return;
    const timer = window.setTimeout(() => setFlashing(new Set()), 700);
    return () => window.clearTimeout(timer);
    // priceKey captures every price; holdings identity changes on each load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  if (holdings.length === 0) return null;

  const isStatic = reducedMotion || holdings.length < MIN_SCROLLING_ITEMS;
  const items = (copy: number) =>
    holdings.map((h) => (
      <TickerItem key={`${copy}-${h.holding_id}`} h={h} currency={currency} flash={copy === 0 && flashing.has(h.holding_id)} />
    ));

  return (
    <div
      className="ticker-viewport rounded-xl bg-surface border border-subtle"
      data-static={isStatic ? "true" : undefined}
      style={{ ["--ticker-duration" as string]: `${holdings.length * SECONDS_PER_ITEM}s` }}
      tabIndex={isStatic ? undefined : 0}
    >
      <div className="ticker-track">
        <ul role="list" aria-label="Holdings ticker" className="flex items-center">
          {items(0)}
        </ul>
        {/* A second copy makes the loop seamless; screen readers skip it. */}
        {!isStatic && (
          <ul aria-hidden="true" className="flex items-center">
            {items(1)}
          </ul>
        )}
      </div>
    </div>
  );
};
