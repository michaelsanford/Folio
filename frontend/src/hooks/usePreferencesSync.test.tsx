import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { getFormatPrefs, setFormatPrefs, DEFAULT_FORMAT_PREFS } from "../utils/format";
import { getHiddenAccounts, setHiddenAccounts } from "../utils/dashboardFilter";
import { PREFERENCES_SAVE_DELAY_MS, usePreferencesSync } from "./usePreferencesSync";

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../services/api", () => ({ api: { preferences: { get, put } } }));

const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

const renderSync = (enabled = true) =>
  renderHook(
    ({ on }) => {
      usePreferencesSync(on);
      return useTheme();
    },
    { wrapper, initialProps: { on: enabled } }
  );

/** Let the mocked GET resolve and React apply what it returns. */
const flush = () => act(async () => {});

describe("usePreferencesSync", () => {
  beforeEach(() => {
    localStorage.clear();
    setFormatPrefs(DEFAULT_FORMAT_PREFS);
    setHiddenAccounts([]);
    get.mockReset();
    put.mockReset();
    put.mockResolvedValue({ preferences: {}, updated_at: "2026-11-24T00:00:00Z" });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("applies the profile's settings after sign-in and caches them locally", async () => {
    get.mockResolvedValue({
      preferences: {
        theme: "nord",
        color_mode: "light",
        type_style: "terminal",
        sidebar_collapsed: true,
        number_format: {
          preset: "fr-CA",
          negative_style: "minus",
          group_separator: " ",
          decimal_separator: ",",
          symbol_position: "after",
          symbol_space: true,
        },
      },
      updated_at: "2026-11-24T00:00:00Z",
    });
    const { result } = renderSync();
    await flush();

    expect(result.current.theme).toBe("nord");
    expect(result.current.mode).toBe("light");
    expect(result.current.typeStyle).toBe("terminal");
    expect(result.current.sidebarCollapsed).toBe(true);
    expect(getFormatPrefs().preset).toBe("fr-CA");
    expect(localStorage.getItem("folio-theme")).toBe("nord");
    expect(localStorage.getItem("folio-sidebar-collapsed")).toBe("true");

    // Applying the profile is not a change of its own.
    await act(async () => vi.advanceTimersByTime(PREFERENCES_SAVE_DELAY_MS * 2));
    expect(put).not.toHaveBeenCalled();
  });

  it("applies the dashboard's hidden accounts from the profile", async () => {
    get.mockResolvedValue({
      preferences: { theme: "nord", dashboard_hidden_account_ids: ["b", "a"] },
      updated_at: "2026-11-24T00:00:00Z",
    });
    renderSync();
    await flush();
    expect(getHiddenAccounts()).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem("folio.dashboard.hidden")!)).toEqual(["a", "b"]);
  });

  it("saves a change to the hidden accounts", async () => {
    get.mockResolvedValue({ preferences: { theme: "nord" }, updated_at: "2026-11-24T00:00:00Z" });
    renderSync();
    await flush();
    put.mockClear();
    act(() => setHiddenAccounts(["acc-1"]));
    await act(async () => vi.advanceTimersByTime(PREFERENCES_SAVE_DELAY_MS + 10));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0].dashboard_hidden_account_ids).toEqual(["acc-1"]);
  });

  it("uploads this device's settings when the profile has none", async () => {
    localStorage.setItem("folio-theme", "gruvbox");
    get.mockResolvedValue({ preferences: {}, updated_at: null });
    renderSync();
    await flush();

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toMatchObject({ theme: "gruvbox", color_mode: "system", type_style: "broadsheet" });
  });

  it("saves a burst of changes as one debounced request", async () => {
    get.mockResolvedValue({ preferences: { theme: "folio-emerald" }, updated_at: "2026-11-24T00:00:00Z" });
    const { result } = renderSync();
    await flush();
    put.mockClear();

    act(() => result.current.setTheme("dracula"));
    act(() => result.current.setTheme("nord"));
    act(() => result.current.setTypeStyle("modern"));
    expect(put).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(PREFERENCES_SAVE_DELAY_MS));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toMatchObject({ theme: "nord", type_style: "modern" });
  });

  it("keeps the local setting when a save fails, and retries on the next change", async () => {
    get.mockResolvedValue({ preferences: { theme: "folio-emerald" }, updated_at: "2026-11-24T00:00:00Z" });
    const { result } = renderSync();
    await flush();
    put.mockClear();
    put.mockRejectedValueOnce(new Error("offline"));

    act(() => result.current.setTheme("dracula"));
    await act(async () => vi.advanceTimersByTime(PREFERENCES_SAVE_DELAY_MS));
    expect(result.current.theme).toBe("dracula");
    expect(localStorage.getItem("folio-theme")).toBe("dracula");

    act(() => result.current.setMode("dark"));
    await act(async () => vi.advanceTimersByTime(PREFERENCES_SAVE_DELAY_MS));
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][0]).toMatchObject({ theme: "dracula", color_mode: "dark" });
  });

  it("does not let a late profile response overwrite a newer local choice", async () => {
    let resolveGet!: (v: unknown) => void;
    get.mockReturnValue(new Promise((r) => (resolveGet = r)));
    const { result } = renderSync();

    act(() => result.current.setTheme("dracula"));
    await act(async () => resolveGet({ preferences: { theme: "nord" }, updated_at: "2026-11-24T00:00:00Z" }));

    expect(result.current.theme).toBe("dracula");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toMatchObject({ theme: "dracula" });
  });

  it("does nothing while signed out", async () => {
    renderSync(false);
    await flush();
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
