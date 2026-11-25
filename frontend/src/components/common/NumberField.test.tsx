import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import { NumberField, parseNumberInput } from "./NumberField";

function Harness({ initial, integer }: { initial: number | null; integer?: boolean }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <NumberField aria-label="amount" value={value} onValueChange={setValue} integer={integer} />
      <output data-testid="state">{value === null ? "null" : String(value)}</output>
    </>
  );
}

describe("parseNumberInput", () => {
  it("treats blank and unparsable text as null, never 0", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("   ")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("parses decimals and integers", () => {
    expect(parseNumberInput("13.5")).toBe(13.5);
    expect(parseNumberInput("13.5", true)).toBe(13);
    expect(parseNumberInput("-0")).toBe(-0);
  });
});

describe("NumberField", () => {
  it("renders null as an empty field", () => {
    render(<Harness initial={null} />);
    expect((screen.getByLabelText("amount") as HTMLInputElement).value).toBe("");
  });

  it("can be cleared and retyped without a leading zero", () => {
    render(<Harness initial={0} />);
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    expect(input.value).toBe("0");

    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(screen.getByTestId("state").textContent).toBe("null");

    fireEvent.change(input, { target: { value: "13" } });
    expect(input.value).toBe("13");
    expect(screen.getByTestId("state").textContent).toBe("13");
  });

  it("parses whole numbers when integer is set", () => {
    render(<Harness initial={null} integer />);
    fireEvent.change(screen.getByLabelText("amount"), { target: { value: "300" } });
    expect(screen.getByTestId("state").textContent).toBe("300");
  });
});
