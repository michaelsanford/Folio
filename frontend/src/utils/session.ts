import type { Me, PersonSummary } from "../types";

/**
 * The signed-in person and the names of everyone who has had a sign-in,
 * filled from /bootstrap. Until it loads (or with an older server) the user is
 * treated as an editor: the server enforces roles regardless, so the worst a
 * stale guess can do is show a button that answers "view-only".
 */
export interface SessionState {
  me: Me | null;
  names: ReadonlyMap<string, string>;
}

const EMPTY: SessionState = Object.freeze({ me: null, names: new Map() });

let current: SessionState = EMPTY;
const listeners = new Set<() => void>();

export const getSession = (): SessionState => current;

export const setSession = (me: Me | null | undefined, people: PersonSummary[] | undefined): void => {
  current = {
    me: me ?? null,
    names: new Map((people ?? []).map((p) => [p.user_key, p.name])),
  };
  listeners.forEach((l) => l());
};

export const clearSession = (): void => {
  current = EMPTY;
  listeners.forEach((l) => l());
};

export const subscribeSession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the person may change the ledger (OWNER or MEMBER). */
export const canEdit = (state: SessionState = current): boolean => state.me?.can_edit ?? true;

/** Display name for a user key, if known. */
export const personName = (key: string | null | undefined, state: SessionState = current): string | null =>
  key ? state.names.get(key) ?? null : null;

/**
 * "Added by Sarah · edited by Michael", "Added by Sarah", or null when nothing
 * is known or only one person uses the vault.
 */
export const attributionLine = (
  createdBy: string | null | undefined,
  updatedBy: string | null | undefined,
  state: SessionState = current
): string | null => {
  if (state.names.size < 2) return null;
  const added = personName(createdBy, state);
  const edited = personName(updatedBy, state);
  if (!added && !edited) return null;
  if (added && edited && createdBy !== updatedBy) return `Added by ${added} · edited by ${edited}`;
  if (added) return `Added by ${added}`;
  return `Edited by ${edited}`;
};
