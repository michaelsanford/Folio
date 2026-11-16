import React from "react";
import { formatMoney, type MoneyFormatOptions } from "../../utils/format";
import { useFormatPrefs } from "../../hooks/useFormatPrefs";

interface MoneyProps extends MoneyFormatOptions {
  value: number;
  className?: string;
}

/**
 * Ledger figure: tabular digits with the cents (and any trailing symbol) set in
 * the muted text role, so the dollars read first. Every money amount in the UI
 * goes through this.
 */
export const Money: React.FC<MoneyProps> = ({ value, className, ...opts }) => {
  const prefs = useFormatPrefs();
  const text = formatMoney(value, opts, prefs);
  const dot = opts.cents === false ? -1 : text.lastIndexOf(prefs.decimalSeparator);
  // Fractional digits end where the trailing symbol or closing bracket starts.
  const fracEnd = dot === -1 ? -1 : dot + 3;
  return (
    <span className={`tabular-nums whitespace-nowrap ${className ?? ""}`}>
      {dot !== -1 ? (
        <>
          {text.slice(0, dot)}
          <span className="text-muted">{text.slice(dot, fracEnd)}</span>
          {text.slice(fracEnd)}
        </>
      ) : (
        text
      )}
    </span>
  );
};
