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
}>;

const notificationState = writable<AppNotification[]>([]);

export const appNotifications = { subscribe: notificationState.subscribe };

export function showAppNotification(notification: AppNotification): void {
  notificationState.update((current) => [
    ...current.filter((item) => item.id !== notification.id),
    notification,
  ]);
}

export function dismissAppNotification(id: string): void {
  notificationState.update((current) => current.filter((item) => item.id !== id));
}

export function clearAppNotifications(): void {
  notificationState.set([]);
}
