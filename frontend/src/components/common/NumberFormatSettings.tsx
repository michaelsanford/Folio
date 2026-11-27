import React from "react";
import {
  FORMAT_PRESETS,
  formatMoney,
  formatPercent,
  setFormatPrefs,
  type DecimalSeparator,
  type FormatPreset,
  type GroupSeparator,
  type NegativeStyle,
  type NumberFormatPrefs,
  type SymbolPosition,
} from "../../utils/format";
import { useFormatPrefs } from "../../hooks/useFormatPrefs";
import { selectClass } from "./ui";

const GROUP_OPTIONS: { value: GroupSeparator; label: string }[] = [
  { value: ",", label: "Comma  1,234" },
  { value: ".", label: "Period  1.234" },
  { value: " ", label: "Space  1 234" },
  { value: "'", label: "Apostrophe  1'234" },
  { value: "", label: "None  1234" },
];



interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="text-xs text-sub mb-1">{label}</div>
      <div className="flex rounded-lg border border-default overflow-hidden">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`flex-1 h-11 md:h-9 px-2 text-sm tabular-nums transition-colors cursor-pointer ${
                selected ? "bg-accent-subtle text-main font-medium" : "bg-surface text-sub bg-surface-hover"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Number and currency conventions: preset plus fine-grained overrides, with a live preview. */
export const NumberFormatSettings: React.FC = () => {
  const prefs = useFormatPrefs();

  // Any manual tweak moves the user to "custom" unless it lands exactly on a preset.
  const update = (patch: Partial<NumberFormatPrefs>) => {
    const next = { ...prefs, ...patch };
    const match = (Object.keys(FORMAT_PRESETS) as (keyof typeof FORMAT_PRESETS)[]).find((k) => {
      const p = FORMAT_PRESETS[k].prefs;
      return (
        p.negativeStyle === next.negativeStyle &&
        p.groupSeparator === next.groupSeparator &&
        p.decimalSeparator === next.decimalSeparator &&
        p.symbolPosition === next.symbolPosition &&
        p.symbolSpace === next.symbolSpace
      );
    });
    setFormatPrefs({ ...patch, preset: match ?? "custom" });
  };

  const choosePreset = (preset: FormatPreset) => {
    if (preset === "custom") setFormatPrefs({ preset });
    else setFormatPrefs(FORMAT_PRESETS[preset].prefs);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="number-format-preset" className="block text-xs text-sub mb-1">
            Style
          </label>
          <select
            id="number-format-preset"
            value={prefs.preset}
            onChange={(e) => choosePreset(e.target.value as FormatPreset)}
            className={selectClass}
          >
            {Object.entries(FORMAT_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label htmlFor="number-format-group" className="block text-xs text-sub mb-1">
            Thousands separator
          </label>
          <select
            id="number-format-group"
            value={prefs.groupSeparator}
            onChange={(e) => update({ groupSeparator: e.target.value as GroupSeparator })}
            className={selectClass}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Segmented<NegativeStyle>
          label="Negative amounts"
          value={prefs.negativeStyle}
          onChange={(v) => update({ negativeStyle: v })}
          options={[
            { value: "minus", label: "−$84.20" },
            { value: "parentheses", label: "($84.20)" },
          ]}
        />
        <Segmented<DecimalSeparator>
          label="Decimal mark"
          value={prefs.decimalSeparator}
          onChange={(v) =>
            update({
              decimalSeparator: v,
              // Keep the two separators distinct.
              ...(v === prefs.groupSeparator ? { groupSeparator: v === "," ? " " : "," } : {}),
            })
          }
          options={[
            { value: ".", label: "Point  0.50" },
            { value: ",", label: "Comma  0,50" },
          ]}
        />
        <Segmented<SymbolPosition>
          label="Dollar sign"
          value={prefs.symbolPosition}
          onChange={(v) => update({ symbolPosition: v })}
          options={[
            { value: "before", label: "Before  $5" },
            { value: "after", label: "After  5 $" },
          ]}
        />
        <Segmented<"no" | "yes">
          label="Space beside the sign"
          value={prefs.symbolSpace ? "yes" : "no"}
          onChange={(v) => update({ symbolSpace: v === "yes" })}
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
        />
      </div>

      <div className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-main tabular-nums flex flex-wrap gap-x-5 gap-y-1">
        <span className="text-xs text-muted self-center">Preview</span>
        <span>{formatMoney(48210.4, {}, prefs)}</span>
        <span className="text-negative">{formatMoney(-1234.56, {}, prefs)}</span>
        <span>{formatPercent(4.5, false, prefs)}</span>
      </div>
    </div>
  );
};
