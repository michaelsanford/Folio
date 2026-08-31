import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { ThemeProvider } from "../context/ThemeContext";
import { useChartTheme } from "./useChartTheme";

describe("useChartTheme Hook", () => {
  it("returns appropriate chart colors for dark mode", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme="folio-emerald" defaultMode="dark">
        {children}
      </ThemeProvider>
    );

    const { result } = renderHook(() => useChartTheme(), { wrapper });

    expect(result.current.isDark).toBe(true);
    expect(result.current.accentColor).toBe("#10b981");
    expect(result.current.positiveColor).toBe("#10b981");
    expect(result.current.negativeColor).toBe("#f43f5e");
    expect(result.current.palette.length).toBeGreaterThan(0);
    expect(result.current.tooltipBg).toBe("#0f172a");
  });

  it("returns appropriate chart colors for light mode", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme="folio-emerald" defaultMode="light">
        {children}
      </ThemeProvider>
    );

    const { result } = renderHook(() => useChartTheme(), { wrapper });

    expect(result.current.isDark).toBe(false);
    expect(result.current.accentColor).toBe("#059669");
    expect(result.current.tooltipBg).toBe("#ffffff");
  });

  it("returns bloomberg terminal chart colors", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme="bloomberg" defaultMode="dark">
        {children}
      </ThemeProvider>
    );

    const { result } = renderHook(() => useChartTheme(), { wrapper });

    expect(result.current.accentColor).toBe("#f59e0b");
    expect(result.current.tooltipBg).toBe("#11131a");
  });
});
