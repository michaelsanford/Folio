import { useCallback, useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often a long-lived window (an installed app left open) asks for a new build. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PwaUpdate {
  /** A new build is installed and waiting; reloading switches to it. */
  updateReady: boolean;
  /** Activate the waiting service worker and reload the page onto the new build. */
  applyUpdate: () => void;
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

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
    },
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

  const applyUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  return { updateReady: needRefresh, applyUpdate };
}
