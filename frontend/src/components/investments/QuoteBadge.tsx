import React from "react";
import type { QuoteSession, QuoteSource } from "../../types";

const SOURCE_NAMES: Record<string, string> = { YAHOO: "Yahoo Finance", TMX: "TMX Money" };

/** "3:42 pm ET" today, "Nov 21, 3:59 pm ET" otherwise, in the given zone. */
export function formatQuoteTime(
  iso: string | null | undefined,
  timeZone = "America/Toronto",
  suffix = " ET"
): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const time = when.toLocaleTimeString("en-CA", { timeZone, hour: "numeric", minute: "2-digit" });
  const prefix =
    dayOf(when) === dayOf(new Date())
      ? ""
      : `${when.toLocaleDateString("en-CA", { timeZone, month: "short", day: "numeric" })}, `;
  return `${prefix}${time}${suffix}`;
}

interface QuoteBadgeProps {
  source?: QuoteSource | null;
  session?: QuoteSession | null;
  quotedAt?: string | null;
}

/**
 * "D" on a delayed quote, "Pre" or "Post" outside regular hours. Prices typed in
 * by hand carry no badge. The tooltip says where the price came from and when.
 */
export const QuoteBadge: React.FC<QuoteBadgeProps> = ({ source, session, quotedAt }) => {
  if (!source || source === "MANUAL") return null;
  if (source === "IMPORT") {
    const title = "Last price from an imported holdings file";
    return (
      <abbr className="quote-badge no-underline" data-session="REGULAR" title={title} aria-label={title}>
        I
      </abbr>
    );
  }
  const extended = session === "PRE" || session === "POST";
  const label = session === "PRE" ? "Pre" : session === "POST" ? "Post" : "D";
  const kind = session === "PRE" ? "Pre-market quote" : session === "POST" ? "After-hours quote" : "Delayed quote";
  const time = formatQuoteTime(quotedAt);
  const title = [kind, SOURCE_NAMES[source] ?? source, time].filter(Boolean).join(" · ");
  return (
    <abbr className="quote-badge no-underline" data-session={extended ? session : "REGULAR"} title={title} aria-label={title}>
      {label}
    </abbr>
  );
};
