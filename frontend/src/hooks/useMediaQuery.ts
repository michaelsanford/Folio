import { useCallback, useSyncExternalStore } from "react";

/**
 * Form factors. Keep these in step with Tailwind's `md` (48rem) and `lg` (64rem):
 * - phone:   below 48rem (`max-md:`): bottom tabs, read-only cards, actions in a sheet
 * - tablet:  48rem to 64rem: sidebar rail, desktop tables with fewer columns
 * - desktop: 64rem and up (`lg:`)
 */
export const PHONE_MEDIA_QUERY = "(max-width: 47.99rem)";
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

/** True on a phone-sized screen (below Tailwind's `md`). */
export const useIsPhone = (): boolean => useMediaQuery(PHONE_MEDIA_QUERY);

/** True when the screen is narrower than `lg`, read once (no subscription). */
export const isBelowDesktop = (): boolean =>
  canMatchMedia() ? !window.matchMedia(DESKTOP_MEDIA_QUERY).matches : false;
