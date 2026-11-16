import { useSyncExternalStore } from "react";
import { getFormatPrefs, subscribeFormatPrefs, type NumberFormatPrefs } from "../utils/format";

/** Current number-format preferences; re-renders the caller when they change. */
export const useFormatPrefs = (): NumberFormatPrefs =>
  useSyncExternalStore(subscribeFormatPrefs, getFormatPrefs, getFormatPrefs);
