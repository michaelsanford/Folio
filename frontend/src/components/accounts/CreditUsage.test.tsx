import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { CreditUsage, creditUsage } from "./CreditUsage";

describe("creditUsage", () => {
  it("rates utilization against the 30% and 75% thresholds", () => {
    expect(creditUsage(2000, 10000).level).toBe("healthy");
    expect(creditUsage(4000, 10000).level).toBe("elevated");
    expect(creditUsage(8000, 10000).level).toBe("high");
    expect(creditUsage(10500, 10000).level).toBe("high");
  });

  it("counts a credit balance as extra room", () => {
    expect(creditUsage(-45, 1000)).toMatchObject({ available: 1045, ratio: 0, level: "healthy" });
  });
});

describe("CreditUsage", () => {
  it("shows what is left of the limit as a meter", () => {
    render(<CreditUsage balance={3200} limit={15000} />);
    expect(screen.getByText(/\$11,800 available/)).toBeDefined();
    expect(screen.getByText(/21% used/)).toBeDefined();
    const meter = screen.getByRole("meter", { name: "Credit used" });
    expect(meter.getAttribute("aria-valuenow")).toBe("3200");
    expect(meter.getAttribute("aria-valuemax")).toBe("15000");
  });

  it("says how far over the limit a card is", () => {
    render(<CreditUsage balance={1120} limit={1000} />);
    expect(screen.getByText(/\$120 over limit/)).toBeDefined();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("1000");
  });

  it("shows a credit balance", () => {
    render(<CreditUsage balance={-45} limit={1000} />);
    expect(screen.getByText(/\$1,045 available/)).toBeDefined();
    expect(screen.getByText(/\$45 credit/)).toBeDefined();
  });

  it("has a compact form for lists", () => {
    render(<CreditUsage compact balance={200} limit={1000} />);
    expect(screen.getByText("$800 left")).toBeDefined();
  });
});
