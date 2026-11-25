import React from "react";

type NativeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
>;

export interface NumberFieldProps extends NativeInputProps {
  /** `null` renders an empty field, so the user can clear it and type afresh. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Parse as a whole number (terms, priorities) instead of a decimal. */
  integer?: boolean;
}

/** Parses a number input's text; an empty or unparsable field is `null`, never 0. */
export function parseNumberInput(raw: string, integer = false): number | null {
  if (raw.trim() === "") return null;
  const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A numeric input that can be left blank. Controlling an input with
 * `parseFloat(v) || 0` snaps a cleared field back to 0, so typing "13" after
 * deleting the 0 gives "013". Callers store `null` for blank and decide what a
 * blank means when they save (usually `?? 0`).
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  value,
  onValueChange,
  integer = false,
  inputMode,
  ...rest
}) => (
  <input
    {...rest}
    type="number"
    inputMode={inputMode ?? (integer ? "numeric" : "decimal")}
    value={value ?? ""}
    onChange={(e) => onValueChange(parseNumberInput(e.target.value, integer))}
  />
);
