/**
 * Minimal app-wide notification bus.
 *
 * The API layer has no access to React state, but some outcomes (a vault
 * conflict, for example) must be shown to the user and must make the views
 * reload their data. This module lets `services/api.ts` publish those events and
 * lets components subscribe to them without a context provider.
 */

export type NotificationTone = "info" | "warning" | "error";

export interface AppNotification {
  id: number;
  message: string;
  tone: NotificationTone;
}

type NotificationListener = (notification: AppNotification) => void;
type VaultConflictListener = () => void;

const notificationListeners = new Set<NotificationListener>();
const vaultConflictListeners = new Set<VaultConflictListener>();
let nextId = 1;

export function notify(message: string, tone: NotificationTone = "info"): AppNotification {
  const notification: AppNotification = { id: nextId++, message, tone };
  notificationListeners.forEach((listener) => listener(notification));
  return notification;
}

export function subscribeToNotifications(listener: NotificationListener): () => void {
  notificationListeners.add(listener);
  return () => {
    notificationListeners.delete(listener);
  };
}

/** Subscribe to "the vault was changed elsewhere and the server reloaded it". */
export function onVaultConflict(listener: VaultConflictListener): () => void {
  vaultConflictListeners.add(listener);
  return () => {
    vaultConflictListeners.delete(listener);
  };
}

export function emitVaultConflict(): void {
  vaultConflictListeners.forEach((listener) => listener());
}
