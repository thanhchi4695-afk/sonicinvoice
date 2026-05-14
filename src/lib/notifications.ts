// Shared notification publisher. Mirrors the storage shape used by
// `useNotifications` so the bell picks it up immediately. Same-tab writes
// dispatch a custom event because the native `storage` event doesn't fire
// for the writing tab.
const STORAGE_KEY = "notifications_suppliersync";
const EVENT = "sonic:notifications-updated";

export type NotificationSeverity = "urgent" | "warning" | "info" | "success";

export function publishNotification(opts: {
  title: string;
  message: string;
  severity?: NotificationSeverity;
  link?: string;
}) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({
      id: crypto.randomUUID(),
      severity: opts.severity ?? "info",
      title: opts.title,
      message: opts.message,
      timestamp: new Date().toISOString(),
      read: false,
      ...(opts.link ? { link: opts.link } : {}),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 100)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}
