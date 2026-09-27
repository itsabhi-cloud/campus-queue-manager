type NotificationCtor = {
  new (title: string, options?: NotificationOptions): unknown;
  permission: NotificationPermission;
};

export type NotifyEnvironment = {
  Notification?: NotificationCtor;
  visibilityState?: DocumentVisibilityState;
};

function currentEnvironment(): NotifyEnvironment {
  return {
    Notification: typeof Notification === "undefined" ? undefined : (Notification as unknown as NotificationCtor),
    visibilityState: typeof document === "undefined" ? undefined : document.visibilityState,
  };
}

/**
 * Shows a system notification only when the user granted permission and QueueSense is in the
 * background (in the foreground the in-app toast already shows it). The tag collapses repeats of the
 * same alert into one. Returns whether a notification was shown.
 */
export function showBrowserNotification(title: string, body: string, env: NotifyEnvironment = currentEnvironment()): boolean {
  try {
    if (!env.Notification || env.Notification.permission !== "granted" || env.visibilityState !== "hidden") return false;
    new env.Notification(title, { body, tag: title });
    return true;
  } catch {
    return false; // Browser notifications are optional; the in-app notification still exists.
  }
}
