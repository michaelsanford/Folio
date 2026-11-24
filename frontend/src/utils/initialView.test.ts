import { describe, it, expect } from "vitest";
import { parseInitialView, takeInitialView } from "./initialView";

describe("initial view from ?view=", () => {
  it("opens the named tab", () => {
    expect(parseInitialView("?view=ledger")).toBe("ledger");
    expect(parseInitialView("?view=ingestion")).toBe("ingestion");
  });

  it("falls back to the dashboard for missing or unknown values", () => {
    expect(parseInitialView("")).toBe("dashboard");
    expect(parseInitialView("?view=settings")).toBe("dashboard");
    expect(parseInitialView("?view=__proto__")).toBe("dashboard");
  });

  it("removes the query string from the address bar", () => {
    window.history.replaceState(null, "", "/?view=budgeting");
    expect(takeInitialView()).toBe("budgeting");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/");
  });
});
