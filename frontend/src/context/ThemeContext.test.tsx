import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useTheme, THEMES } from "./ThemeContext";

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

  it("contains all 8 curated theme configurations", () => {
    const themeIds = THEMES.map((t) => t.id);
    expect(themeIds).toContain("folio-emerald");
    expect(themeIds).toContain("bloomberg");
    expect(themeIds).toContain("editorial");
    expect(themeIds).toContain("catppuccin");
    expect(themeIds).toContain("nord");
    expect(themeIds).toContain("gruvbox");
    expect(themeIds).toContain("tokyo-night");
    expect(themeIds).toContain("dracula");
    expect(themeIds.length).toBe(8);
  });
});
