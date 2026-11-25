/**
 * Minimal app-wide notification bus.
 *
 * The API layer has no access to React state, but some outcomes (a write
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
type WriteConflictListener = () => void;

const notificationListeners = new Set<NotificationListener>();
const writeConflictListeners = new Set<WriteConflictListener>();
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

/** Subscribe to "someone else saved at the same moment; reload the latest data". */
export function onWriteConflict(listener: WriteConflictListener): () => void {
  writeConflictListeners.add(listener);
  return () => {
    writeConflictListeners.delete(listener);
  };
}

export function emitWriteConflict(): void {
  writeConflictListeners.forEach((listener) => listener());
}
