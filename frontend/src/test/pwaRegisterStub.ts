// Test stand-in for vite-plugin-pwa's `virtual:pwa-register/react`, which only
// exists inside a Vite build (vitest.alias in vite.config.ts points here).
// No service worker, never an update waiting.
import { useState } from "react";

export function useRegisterSW() {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async () => {},
  };
}
