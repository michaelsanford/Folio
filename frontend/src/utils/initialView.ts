import type { NavTab } from "../components/layout/AppLayout";

const NAV_TABS: readonly NavTab[] = [
  "dashboard",
  "ledger",
  "budgeting",
  "goals",
  "loans",
  "ingestion",
  "rules",
  "investments",
  "accounts",
];

/** The tab named by `?view=` (installed-app shortcuts), or the dashboard. */
export function parseInitialView(search: string): NavTab {
  const view = new URLSearchParams(search).get("view");
  return view && (NAV_TABS as readonly string[]).includes(view) ? (view as NavTab) : "dashboard";
}

/**
 * Reads `?view=` once at startup and removes it from the address bar, so a
 * reload or a bookmark of the current page starts clean.
 */
export function takeInitialView(): NavTab {
  if (typeof window === "undefined") return "dashboard";
  const tab = parseInitialView(window.location.search);
  if (window.location.search) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
  }
  return tab;
}
