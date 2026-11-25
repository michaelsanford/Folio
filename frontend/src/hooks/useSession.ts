import { useSyncExternalStore } from "react";
import { getSession, subscribeSession, type SessionState } from "../utils/session";

/** The signed-in person and everyone's names; re-renders when they change. */
export const useSession = (): SessionState => useSyncExternalStore(subscribeSession, getSession, getSession);

/** False for a view-only person. */
export const useCanEdit = (): boolean => useSession().me?.can_edit ?? true;
