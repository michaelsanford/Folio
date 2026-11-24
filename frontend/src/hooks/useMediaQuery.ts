import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind's `lg` breakpoint (64rem). Keep this in step with the `lg:` classes
 * the markup uses, so the tree chosen in JS matches what the CSS would show.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

const canMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * Whether `query` currently matches; re-renders when that changes.
 * Returns `fallback` where matchMedia is unavailable (server rendering, some test
 * environments).
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );
  const getSnapshot = () => (canMatchMedia() ? window.matchMedia(query).matches : fallback);
  const getServerSnapshot = () => fallback;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
