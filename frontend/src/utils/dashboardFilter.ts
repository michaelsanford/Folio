/**
 * Accounts the dashboard leaves out, kept as exclusions so a newly added
 * account is counted until the user hides it.
 *
 * localStorage paints the first load; usePreferencesSync then applies and saves
 * the copy in the user's profile, so the choice follows them across devices.
 */
const STORAGE_KEY = "folio.dashboard.hidden";
const MAX_HIDDEN = 100;

const EMPTY: readonly string[] = Object.freeze([]);

const sanitize = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return EMPTY;
  const ids = [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))];
  return ids.length ? ids.slice(0, MAX_HIDDEN).sort() : EMPTY;
};

const load = (): readonly string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
};

let current: readonly string[] = load();
const listeners = new Set<() => void>();

export const getHiddenAccounts = (): readonly string[] => current;

export const setHiddenAccounts = (ids: Iterable<string>): void => {
  const next = sanitize([...ids]);
  if (next.join("\n") === current.join("\n")) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
  listeners.forEach((l) => l());
};

export const subscribeHiddenAccounts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
