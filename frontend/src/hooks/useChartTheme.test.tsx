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
    expect(result.current.accentColor).toBe("#3fae86");
    expect(result.current.positiveColor).toBe("#5bbf8a");
    expect(result.current.negativeColor).toBe("#e2725b");
    expect(result.current.palette.length).toBeGreaterThan(0);
    expect(result.current.tooltipBg).toBe("#2d2824");
  });

  it("returns appropriate chart colors for light mode", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider defaultTheme="folio-emerald" defaultMode="light">
        {children}
      </ThemeProvider>
    );

    const { result } = renderHook(() => useChartTheme(), { wrapper });

    expect(result.current.isDark).toBe(false);
    expect(result.current.accentColor).toBe("#2b7155");
    expect(result.current.tooltipBg).toBe("#fffdf9");
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
