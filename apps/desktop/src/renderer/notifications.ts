// ESLint's current resolver does not understand Svelte's documented package subpath export.
// eslint-disable-next-line import/no-unresolved
import { writable } from 'svelte/store';

export type AppNotificationAction = Readonly<{
  label: string;
  run: () => void | Promise<void>;
}>;

export type AppNotification = Readonly<{
  id: string;
  title: string;
  message: string;
  tone: 'default' | 'error';
  action?: AppNotificationAction;
  durationMs?: number;
}>;

export const DEFAULT_NOTIFICATION_DURATION_MS = 5_000;

const notificationState = writable<AppNotification[]>([]);
const dismissalTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const appNotifications = { subscribe: notificationState.subscribe };

export function showAppNotification(notification: AppNotification): void {
  cancelDismissal(notification.id);
  notificationState.update((current) => [
    notification,
    ...current.filter((item) => item.id !== notification.id),
  ]);
  const durationMs = notification.durationMs ?? DEFAULT_NOTIFICATION_DURATION_MS;
  if (durationMs > 0) {
    dismissalTimers.set(
      notification.id,
      setTimeout(() => {
        dismissalTimers.delete(notification.id);
        notificationState.update((current) =>
          current.filter((item) => item.id !== notification.id),
        );
      }, durationMs),
    );
  }
}

export function dismissAppNotification(id: string): void {
  cancelDismissal(id);
  notificationState.update((current) => current.filter((item) => item.id !== id));
}

export function clearAppNotifications(): void {
  for (const timer of dismissalTimers.values()) clearTimeout(timer);
  dismissalTimers.clear();
  notificationState.set([]);
}

function cancelDismissal(id: string): void {
  const timer = dismissalTimers.get(id);
  if (timer) clearTimeout(timer);
  dismissalTimers.delete(id);
}
