import { describe, it, expect } from "vitest";
import {
  CANADIAN_ACCOUNT_TYPES,
  getAccountTypeMeta,
  isAssetAccount,
  isInvestmentAccount,
  isLoanAccount,
} from "./canadianAccountTypes";
import { ICON_MAP, getColorSwatch } from "./iconPalette";

describe("Canadian Account Types Metadata & Rules", () => {
  it("provides comprehensive metadata for TFSA, RRSP, FHSA, and RESP", () => {
    const tfsa = getAccountTypeMeta("TFSA");
    expect(tfsa.name).toContain("Tax-Free Savings Account");
    expect(tfsa.category).toBe("REGISTERED");
    expect(tfsa.classification).toBe("ASSET");
    expect(tfsa.badge).toContain("Tax-Free");
    expect(tfsa.craUrl).toContain("canada.ca");
    expect(tfsa.keyRules.length).toBeGreaterThan(0);

    const rrsp = getAccountTypeMeta("RRSP");
    expect(rrsp.name).toContain("Registered Retirement Savings Plan");
    expect(rrsp.category).toBe("REGISTERED");
    expect(rrsp.badge).toContain("Tax-Deductible");

    const fhsa = getAccountTypeMeta("FHSA");
    expect(fhsa.name).toContain("First Home Savings Account");
    expect(fhsa.supportsInvestments).toBe(true);

    const resp = getAccountTypeMeta("RESP");
    expect(resp.name).toContain("Registered Education Savings Plan");
    expect(resp.badge).toContain("CESG");
  });

  it("correctly classifies assets and liabilities", () => {
    expect(isAssetAccount("CHECKING")).toBe(true);
    expect(isAssetAccount("SAVINGS")).toBe(true);
    expect(isAssetAccount("TFSA")).toBe(true);
    expect(isAssetAccount("RRSP")).toBe(true);
    expect(isAssetAccount("REAL_ESTATE")).toBe(true);

    expect(isAssetAccount("CREDIT_CARD")).toBe(false);
    expect(isAssetAccount("MORTGAGE")).toBe(false);
    expect(isAssetAccount("LINE_OF_CREDIT")).toBe(false);
    expect(isAssetAccount("STUDENT_LOAN")).toBe(false);
  });

  it("identifies investment-capable and loan accounts", () => {
    expect(isInvestmentAccount("TFSA")).toBe(true);
    expect(isInvestmentAccount("RRSP")).toBe(true);
    expect(isInvestmentAccount("FHSA")).toBe(true);
    expect(isInvestmentAccount("RESP")).toBe(true);
    expect(isInvestmentAccount("INVESTMENT")).toBe(true);
    expect(isInvestmentAccount("CHECKING")).toBe(false);

    expect(isLoanAccount("MORTGAGE")).toBe(true);
    expect(isLoanAccount("VEHICLE_LOAN")).toBe(true);
    expect(isLoanAccount("STUDENT_LOAN")).toBe(true);
    expect(isLoanAccount("LINE_OF_CREDIT")).toBe(true);
    expect(isLoanAccount("SAVINGS")).toBe(false);
  });

  it("maps default icons and color swatches cleanly", () => {
    const meta = getAccountTypeMeta("TFSA");
    expect(ICON_MAP[meta.defaultIcon]).toBeDefined();

    const swatch = getColorSwatch(meta.defaultColor);
    expect(swatch.hex.toLowerCase()).toBe(meta.defaultColor.toLowerCase());
  });
});
