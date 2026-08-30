import { describe, it, expect } from "vitest";
import {
  CANADIAN_INSTITUTIONS,
  searchCanadianInstitutions,
} from "./canadianInstitutions";

describe("Canadian Institutions Autocomplete Helper", () => {
  it("includes all Big 6 Canadian banks", () => {
    const big6 = CANADIAN_INSTITUTIONS.filter((i) => i.category === "BIG6");
    expect(big6.length).toBe(6);
    const shortNames = big6.map((i) => i.shortName);
    expect(shortNames).toContain("RBC");
    expect(shortNames).toContain("TD");
    expect(shortNames).toContain("Scotiabank");
    expect(shortNames).toContain("BMO");
    expect(shortNames).toContain("CIBC");
    expect(shortNames).toContain("National Bank");
  });

  it("finds institutions by acronyms and aliases", () => {
    const ws = searchCanadianInstitutions("ws");
    expect(ws.some((i) => i.shortName === "Wealthsimple")).toBe(true);

    const rbc = searchCanadianInstitutions("royal bank");
    expect(rbc.some((i) => i.shortName === "RBC")).toBe(true);

    const qt = searchCanadianInstitutions("questrade");
    expect(qt.some((i) => i.shortName === "Questrade")).toBe(true);

    const eq = searchCanadianInstitutions("eq bank");
    expect(eq.some((i) => i.shortName === "EQ Bank")).toBe(true);

    const amex = searchCanadianInstitutions("american express");
    expect(amex.some((i) => i.shortName === "Amex")).toBe(true);
  });

  it("returns default suggestions on empty query", () => {
    const defaultList = searchCanadianInstitutions("");
    expect(defaultList.length).toBeGreaterThan(0);
  });
});
