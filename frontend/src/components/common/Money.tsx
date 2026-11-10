import React from "react";
import { formatMoney, type MoneyFormatOptions } from "../../utils/format";

interface MoneyProps extends MoneyFormatOptions {
  value: number;
  className?: string;
}

/**
 * Ledger figure: tabular mono digits with the cents set in the muted text role,
 * so the dollars read first. Every money amount in the UI goes through this.
 */
export const Money: React.FC<MoneyProps> = ({ value, className, ...opts }) => {
  const text = formatMoney(value, opts);
  const dot = text.lastIndexOf(".");
  const hasCents = opts.cents !== false && dot !== -1;
  return (
    <span className={`font-mono tabular-nums whitespace-nowrap ${className ?? ""}`}>
      {hasCents ? (
        <>
          {text.slice(0, dot)}
          <span className="text-muted">{text.slice(dot)}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
};
