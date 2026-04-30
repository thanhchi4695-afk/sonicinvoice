import { useState, useRef, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { AppNotification } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_STYLES: Record<string, { dot: string; border: string }> = {
  urgent:  { dot: "bg-destructive", border: "border-l-destructive" },
  warning: { dot: "bg-yellow-500",  border: "border-l-yellow-500" },
  info:    { dot: "bg-blue-500",    border: "border-l-blue-500" },
  success: { dot: "bg-green-500",   border: "border-l-green-500" },
};

interface Props {
  notifications: AppNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss?: (id: string) => void;
  onNavigate?: (link: string) => void;
}

export default function NotificationBell({ notifications, unreadCount, onMarkRead, onMarkAllRead, onDismiss, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-1.5 rounded-full hover:bg-accent transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[320px] max-h-[400px] bg-popover border rounded-xl shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold text-sm text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={onMarkAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No notifications yet</div>
            ) : (
              notifications.slice(0, 20).map(n => {
                const styles = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      onMarkRead(n.id);
                      if (n.link && onNavigate) onNavigate(n.link);
                    }}
                    className={`w-full text-left px-4 py-3 border-l-4 ${styles.border} transition-colors hover:bg-accent/50 ${
                      n.read ? "bg-muted/40" : "bg-popover"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${styles.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-tight ${n.read ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                          {n.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                        </p>
                      </div>
                      {n.link && (
                        <span className="text-[10px] text-primary shrink-0 mt-1">View →</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {notifications.length > 20 && (
            <div className="px-4 py-2 border-t text-center">
              <span className="text-xs text-muted-foreground">Showing latest 20 of {notifications.length}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
