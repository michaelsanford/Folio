import React, { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { subscribeToNotifications } from "../../services/notifications";
import type { AppNotification } from "../../services/notifications";

/** How long a notice stays on screen before dismissing itself. */
export const NOTIFICATION_TIMEOUT_MS = 10000;

/**
 * Renders notices published through `services/notifications`. The live region
 * is always mounted so screen readers announce notices as they are added.
 */
export const NotificationRegion: React.FC = () => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    const timers = new Map<number, number>();
    const dismissLater = (id: number) => {
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, NOTIFICATION_TIMEOUT_MS)
      );
    };
    const unsubscribe = subscribeToNotifications((notification) => {
      setNotifications((prev) => {
        // Collapse repeats of the same message (several requests can hit the
        // same conflict at once) into the newest one.
        const kept = prev.filter((n) => n.message !== notification.message);
        return [...kept, notification].slice(-3);
      });
      dismissLater(notification.id);
    });
    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const dismiss = (id: number) => setNotifications((prev) => prev.filter((n) => n.id !== id));

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:max-w-sm z-[60] flex flex-col gap-2 pointer-events-none"
    >
      {notifications.map((n) => {
        const Icon = n.tone === "info" ? Info : AlertTriangle;
        const toneClass =
          n.tone === "error"
            ? "text-negative"
            : n.tone === "warning"
              ? "text-warning"
              : "text-muted";
        return (
          <div
            key={n.id}
            className="pointer-events-auto flex items-start gap-3 p-4 rounded-xl bg-surface border border-default shadow-xl text-sm text-main animate-in fade-in slide-in-from-bottom-2"
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${toneClass}`} strokeWidth={1.5} aria-hidden="true" />
            <span className="flex-1">{n.message}</span>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label="Dismiss notification"
              className="w-6 h-6 -mr-1 -mt-0.5 inline-flex items-center justify-center rounded-lg text-muted hover:text-main bg-surface-hover transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
