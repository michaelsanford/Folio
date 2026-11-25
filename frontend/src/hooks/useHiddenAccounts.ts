import { useSyncExternalStore } from "react";
import { getHiddenAccounts, subscribeHiddenAccounts } from "../utils/dashboardFilter";

/** Account ids the dashboard leaves out (sorted); re-renders the caller when they change. */
export const useHiddenAccounts = (): readonly string[] =>
  useSyncExternalStore(subscribeHiddenAccounts, getHiddenAccounts, getHiddenAccounts);
