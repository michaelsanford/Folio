import { describe, it, expect, beforeEach, vi } from "vitest";
import { getHiddenAccounts, setHiddenAccounts, subscribeHiddenAccounts } from "./dashboardFilter";

describe("dashboard hidden accounts store", () => {
  beforeEach(() => {
    setHiddenAccounts([]);
    localStorage.clear();
  });

  it("stores a sorted, de-duplicated list and persists it", () => {
    setHiddenAccounts(["b", "a", "b"]);
    expect(getHiddenAccounts()).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem("folio.dashboard.hidden")!)).toEqual(["a", "b"]);
  });

  it("notifies subscribers only on a real change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHiddenAccounts(listener);
    setHiddenAccounts(["x"]);
    setHiddenAccounts(["x"]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setHiddenAccounts([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("caps the list and ignores invalid ids", () => {
    setHiddenAccounts(["", "y".repeat(65), ...Array.from({ length: 150 }, (_, i) => `id-${i}`)]);
    expect(getHiddenAccounts()).toHaveLength(100);
    expect(getHiddenAccounts()).not.toContain("");
  });
});
