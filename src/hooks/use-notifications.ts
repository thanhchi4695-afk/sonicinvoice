import { useState, useEffect, useCallback } from "react";

export type NotificationSeverity = "urgent" | "warning" | "info" | "success";

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: string; // tab or flow to navigate to
}

export interface NotificationPreferences {
  priceIncreases: boolean;
  overdueDeliveries: boolean;
  lowStock: boolean;
  duplicateInvoices: boolean;
  processingComplete: boolean;
  exportComplete: boolean;
  everyLogin: boolean;
  priceThreshold: number;   // percent
  lowStockThreshold: number; // units
  overdueWeeks: number;
}

const DEFAULT_PREFS: NotificationPreferences = {
  priceIncreases: true,
  overdueDeliveries: true,
  lowStock: true,
  duplicateInvoices: true,
  processingComplete: true,
  exportComplete: true,
  everyLogin: false,
  priceThreshold: 5,
  lowStockThreshold: 3,
  overdueWeeks: 2,
};

const STORAGE_KEY = "notifications_suppliersync";
const PREFS_KEY = "notification_prefs_suppliersync";
const MAX_NOTIFICATIONS = 100;
const READ_EXPIRY_DAYS = 30;

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all: AppNotification[] = JSON.parse(raw);
    const cutoff = Date.now() - READ_EXPIRY_DAYS * 86400000;
    return all.filter(n => !n.read || new Date(n.timestamp).getTime() > cutoff).slice(0, MAX_NOTIFICATIONS);
  } catch { return []; }
}

function saveNotifications(items: AppNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
}

export function loadPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return DEFAULT_PREFS; }
}

export function savePreferences(prefs: NotificationPreferences) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export const NOTIFICATIONS_UPDATED_EVENT = "sonic:notifications-updated";

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadNotifications);

  useEffect(() => { saveNotifications(notifications); }, [notifications]);

  // Re-read from localStorage when other components push notifications
  // (same-tab writes don't trigger the native `storage` event).
  useEffect(() => {
    const refresh = () => setNotifications(loadNotifications());
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const addNotification = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    const item: AppNotification = {
      ...n,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => [item, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, addNotification, markRead, markAllRead };
}
