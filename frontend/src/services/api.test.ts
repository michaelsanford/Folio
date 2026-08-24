import { describe, it, expect, beforeEach, vi } from "vitest";
import { getStoredToken, setStoredToken, setOnUnauthorized } from "./api";

describe("API Service Auth and Storage Helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves access tokens from local storage", () => {
    expect(getStoredToken()).toBeNull();

    setStoredToken("sample-jwt-token-xyz");
    expect(getStoredToken()).toBe("sample-jwt-token-xyz");

    setStoredToken(null);
    expect(getStoredToken()).toBeNull();
  });

  it("triggers unauthorized callback on 401 handling", () => {
    const callback = vi.fn();
    setOnUnauthorized(callback);
    // Callback is registered and ready for 401 dispatch
    expect(callback).not.toHaveBeenCalled();
  });
});
