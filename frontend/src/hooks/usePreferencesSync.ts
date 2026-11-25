import { useEffect, useMemo, useRef } from "react";
import { THEMES, TYPE_STYLES, useTheme } from "../context/ThemeContext";
import type { ThemeId, TypeStyleId } from "../context/ThemeContext";
import { api } from "../services/api";
import { normalizePrefs, setFormatPrefs, type NumberFormatPrefs } from "../utils/format";
import { useFormatPrefs } from "./useFormatPrefs";
import { useHiddenAccounts } from "./useHiddenAccounts";
import { setHiddenAccounts } from "../utils/dashboardFilter";
import type { NumberFormatPreferences, UiPreferences } from "../types";

/** Quiet time after the last change before it is saved (one vault sync per burst). */
export const PREFERENCES_SAVE_DELAY_MS = 800;

const toServerFormat = (p: NumberFormatPrefs): NumberFormatPreferences => ({
  preset: p.preset,
  negative_style: p.negativeStyle,
  group_separator: p.groupSeparator,
  decimal_separator: p.decimalSeparator,
  symbol_position: p.symbolPosition,
  symbol_space: p.symbolSpace,
});

const fromServerFormat = (p: NumberFormatPreferences): NumberFormatPrefs =>
  normalizePrefs({
    preset: p.preset,
    negativeStyle: p.negative_style,
    groupSeparator: p.group_separator,
    decimalSeparator: p.decimal_separator,
    symbolPosition: p.symbol_position,
    symbolSpace: p.symbol_space,
  });

/**
 * Keeps appearance settings (theme, colour mode, type style, number format,
 * collapsed sidebar) and the dashboard's hidden accounts in the signed-in user's profile, so they follow the user
 * to any device or browser.
 *
 * localStorage still paints the first frame (the sign-in screen included).
 * Once `enabled` (signed in), the profile copy is fetched and applied; if the
 * profile has none yet, this device's settings become its starting point.
 * After that every change is saved, debounced so a burst of changes is one
 * request. A failed save is silent and retried with the next change.
 */
export function usePreferencesSync(enabled: boolean): void {
  const {
    theme,
    mode,
    typeStyle,
    sidebarCollapsed,
    setTheme,
    setMode,
    setTypeStyle,
    setSidebarCollapsed,
  } = useTheme();
  const format = useFormatPrefs();
  const hiddenAccounts = useHiddenAccounts();

  const current = useMemo<UiPreferences>(
    () => ({
      theme,
      color_mode: mode,
      type_style: typeStyle,
      number_format: toServerFormat(format),
      sidebar_collapsed: sidebarCollapsed,
      dashboard_hidden_account_ids: [...hiddenAccounts],
    }),
    [theme, mode, typeStyle, format, sidebarCollapsed, hiddenAccounts]
  );
  const serialized = JSON.stringify(current);

  // Bumped on every change, so a profile response that arrives after the user
  // already changed something does not overwrite the newer choice.
  const editVersion = useRef(0);
  const previous = useRef(serialized);
  const loaded = useRef(false);
  const lastSaved = useRef<string | null>(null);
  const latest = useRef({ current, serialized });
  latest.current = { current, serialized };

  // Fetch and apply the profile copy once per signed-in session.
  useEffect(() => {
    if (!enabled) {
      loaded.current = false;
      lastSaved.current = null;
      return;
    }
    let cancelled = false;
    const versionAtFetch = editVersion.current;
    api.preferences
      .get()
      .then((res) => {
        if (cancelled) return;
        const saved = res.preferences ?? {};
        if (Object.keys(saved).length === 0 || editVersion.current !== versionAtFetch) {
          // Nothing in the profile yet, or a newer local change: save this device's settings.
          loaded.current = true;
          void save(latest.current.current, latest.current.serialized);
          return;
        }
        if (saved.theme && THEMES.some((t) => t.id === saved.theme)) setTheme(saved.theme as ThemeId);
        if (saved.color_mode) setMode(saved.color_mode);
        if (saved.type_style && TYPE_STYLES.some((t) => t.id === saved.type_style))
          setTypeStyle(saved.type_style as TypeStyleId);
        if (saved.number_format) setFormatPrefs(fromServerFormat(saved.number_format));
        if (typeof saved.sidebar_collapsed === "boolean") setSidebarCollapsed(saved.sidebar_collapsed);
        if (Array.isArray(saved.dashboard_hidden_account_ids)) setHiddenAccounts(saved.dashboard_hidden_account_ids);
        // What the profile now holds, merged over this device's values: the
        // re-render that applies it is then not mistaken for a new change. Any
        // field the profile lacked differs, and is saved to fill it in.
        lastSaved.current = JSON.stringify({ ...latest.current.current, ...saved });
        loaded.current = true;
      })
      .catch(() => {
        // Offline or the server refused: keep the local settings; saving
        // starts with the next change.
        if (!cancelled) loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
    // The setters are recreated each render; only a sign-in/out should refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Count every change, and save it after a quiet period once the profile is loaded.
  useEffect(() => {
    if (previous.current !== serialized) {
      previous.current = serialized;
      editVersion.current += 1;
    }
    if (!enabled || !loaded.current || serialized === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      void save(latest.current.current, latest.current.serialized);
    }, PREFERENCES_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [serialized, enabled]);

  async function save(prefs: UiPreferences, key: string): Promise<void> {
    if (key === lastSaved.current) return;
    try {
      await api.preferences.put(prefs);
      lastSaved.current = key;
    } catch {
      /* keep the local value; the next change tries again */
    }
  }
}
