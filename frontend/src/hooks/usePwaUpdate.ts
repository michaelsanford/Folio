import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often a long-lived window (an installed app left open) asks for a new build. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The longest an update waits for the new worker before reloading anyway. */
export const UPDATE_FALLBACK_MS = 4000;

export interface PwaUpdate {
  /** A new build is installed and waiting; reloading switches to it. */
  updateReady: boolean;
  /** The user chose to update and the page is about to reload. */
  updating: boolean;
  /** Activate the waiting service worker and reload the page onto the new build. */
  applyUpdate: () => void;
}

/**
 * Switches to the waiting service worker, then reloads. The reload always
 * happens, exactly once, whichever of these comes first:
 * - the page's controller changes (the usual case);
 * - the waiting worker becomes active or is replaced (a page that was never
 *   controlled, e.g. after a hard reload, gets no controllerchange);
 * - nothing is waiting any more (another tab already switched);
 * - `fallbackMs` passes.
 * The page shell is never cached by the browser, so a plain reload also lands
 * on the new build.
 */
export function activateUpdate(
  registration: ServiceWorkerRegistration | undefined,
  reload: () => void,
  fallbackMs = UPDATE_FALLBACK_MS,
): void {
  let done = false;
  const reloadOnce = () => {
    if (done) return;
    done = true;
    reload();
  };

  const waiting = registration?.waiting;
  if (!waiting) {
    reloadOnce();
    return;
  }

  navigator.serviceWorker?.addEventListener("controllerchange", reloadOnce);
  waiting.addEventListener("statechange", () => {
    if (waiting.state === "activated" || waiting.state === "redundant") reloadOnce();
  });
  window.setTimeout(reloadOnce, fallbackMs);
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Registers the service worker in prompt mode and reports when a new build is
 * waiting. The worker never takes over on its own: the page reloads only when
 * the user chooses to (or when nothing is open that could be lost; see App).
 *
 * Besides the browser's own check on navigation, it checks hourly and whenever
 * the app becomes visible again, so a phone app resumed after days in the
 * background finds the new version straight away.
 */
export function usePwaUpdate(): PwaUpdate {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [updating, setUpdating] = useState(false);

  const {
    needRefresh: [needRefresh],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
    },
    // activateUpdate does the reload; the plugin's own reload only fires on
    // controlled pages and would race it.
    onNeedReload() {},
  });

  useEffect(() => {
    const check = () => {
      const registration = registrationRef.current;
      if (!registration || registration.installing || !navigator.onLine) return;
      registration.update().catch(() => {
        /* offline or the server is unreachable: try again on the next tick */
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const startedRef = useRef(false);
  const applyUpdate = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setUpdating(true);
    const reload = () => window.location.reload();
    const known = registrationRef.current;
    if (known || !("serviceWorker" in navigator)) {
      activateUpdate(known, reload);
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => activateUpdate(registration, reload))
      .catch(reload);
  }, []);

  return { updateReady: needRefresh, updating, applyUpdate };
}
