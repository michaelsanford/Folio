import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useTheme, THEMES, TYPE_STYLES } from "./ThemeContext";

const TestComponent = () => {
  const { theme, colorMode, resolvedMode, setTheme, setColorMode, toggleColorMode } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="current-mode">{colorMode}</span>
      <span data-testid="resolved-mode">{resolvedMode}</span>
      <button onClick={() => setTheme("bloomberg")}>Set Bloomberg</button>
      <button onClick={() => setTheme("dracula")}>Set Dracula</button>
      <button onClick={() => setColorMode("light")}>Set Light</button>
      <button onClick={() => setColorMode("dark")}>Set Dark</button>
      <button onClick={() => setColorMode("system")}>Set System</button>
      <button onClick={toggleColorMode}>Toggle Mode</button>
    </div>
  );
};

describe("ThemeContext & ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
  });

  it("provides default theme (folio-emerald) and default mode (system)", () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme").textContent).toBe("folio-emerald");
    expect(screen.getByTestId("current-mode").textContent).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("folio-emerald");
  });

  it("allows switching theme and persists in localStorage and html attributes", () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("Set Bloomberg"));
    expect(screen.getByTestId("current-theme").textContent).toBe("bloomberg");
    expect(localStorage.getItem("folio-theme")).toBe("bloomberg");
    expect(document.documentElement.getAttribute("data-theme")).toBe("bloomberg");

    fireEvent.click(screen.getByText("Set Dracula"));
    expect(screen.getByTestId("current-theme").textContent).toBe("dracula");
    expect(localStorage.getItem("folio-theme")).toBe("dracula");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dracula");
  });

  it("allows switching color modes and toggling between light and dark", () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("Set Light"));
    expect(screen.getByTestId("current-mode").textContent).toBe("light");
    expect(screen.getByTestId("resolved-mode").textContent).toBe("light");
    expect(localStorage.getItem("folio-color-mode")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    fireEvent.click(screen.getByText("Toggle Mode"));
    expect(screen.getByTestId("resolved-mode").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("contains all 10 curated theme configurations", () => {
    const themeIds = THEMES.map((t) => t.id);
    expect(themeIds).toContain("folio-emerald");
    expect(themeIds).toContain("bloomberg");
    expect(themeIds).toContain("editorial");
    expect(themeIds).toContain("catppuccin");
    expect(themeIds).toContain("nord");
    expect(themeIds).toContain("gruvbox");
    expect(themeIds).toContain("tokyo-night");
    expect(themeIds).toContain("dracula");
    expect(themeIds).toContain("campbell");
    expect(themeIds).toContain("high-contrast");
    expect(themeIds.length).toBe(10);
  });

  it("starts a new device that asks for more contrast on High contrast", () => {
    localStorage.clear();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: query === "(prefers-contrast: more)", addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      let seen = "";
      const Probe = () => {
        seen = useTheme().theme;
        return null;
      };
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      );
      expect(seen).toBe("high-contrast");
    } finally {
      window.matchMedia = original;
    }
  });

  it("defaults to the Broadsheet type style, applies it to <html> and persists changes", () => {
    const TypeProbe = () => {
      const { typeStyle, setTypeStyle } = useTheme();
      return (
        <div>
          <span data-testid="type-style">{typeStyle}</span>
          <button onClick={() => setTypeStyle("terminal")}>Set Terminal</button>
        </div>
      );
    };
    render(
      <ThemeProvider>
        <TypeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("type-style").textContent).toBe("broadsheet");
    expect(document.documentElement.getAttribute("data-type")).toBe("broadsheet");

    fireEvent.click(screen.getByText("Set Terminal"));
    expect(screen.getByTestId("type-style").textContent).toBe("terminal");
    expect(document.documentElement.getAttribute("data-type")).toBe("terminal");
    expect(localStorage.getItem("folio-type-style")).toBe("terminal");
  });

  it("offers at least three distinct type styles", () => {
    expect(TYPE_STYLES.map((t) => t.id)).toEqual(["broadsheet", "modern", "friendly", "terminal"]);
  });
});
