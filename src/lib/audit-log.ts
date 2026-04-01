export interface AuditEntry {
  timestamp: string;
  username: string;
  role: "admin" | "client";
  action: string;
  detail: string;
  sessionId: string;
}

const MAX_ENTRIES = 500;
let _sessionId: string | null = null;

function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = Math.random().toString(36).slice(2, 10);
  }
  return _sessionId;
}

function getCurrentUser(): { username: string; role: "admin" | "client" } {
  const username = localStorage.getItem("current_username") || "user";
  const role = localStorage.getItem("user_role") === "admin" ? "admin" : "client";
  return { username, role } as const;
}

export function addAuditEntry(action: string, detail: string): void {
  const { username, role } = getCurrentUser();
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    username,
    role,
    action,
    detail,
    sessionId: getSessionId(),
  };

  // Per-user log
  const userKey = `audit_log_${username}`;
  const userLog: AuditEntry[] = JSON.parse(localStorage.getItem(userKey) || "[]");
  userLog.unshift(entry);
  if (userLog.length > MAX_ENTRIES) userLog.length = MAX_ENTRIES;
  localStorage.setItem(userKey, JSON.stringify(userLog));

  // Combined log for admin
  const allLog: AuditEntry[] = JSON.parse(localStorage.getItem("audit_log_all") || "[]");
  allLog.unshift(entry);
  if (allLog.length > MAX_ENTRIES * 3) allLog.length = MAX_ENTRIES * 3;
  localStorage.setItem("audit_log_all", JSON.stringify(allLog));
}

export function getAuditEntries(adminView = false): AuditEntry[] {
  if (adminView) {
    return JSON.parse(localStorage.getItem("audit_log_all") || "[]");
  }
  const { username } = getCurrentUser();
  return JSON.parse(localStorage.getItem(`audit_log_${username}`) || "[]");
}

export function getRecentAuditEntries(count = 5): AuditEntry[] {
  return getAuditEntries().slice(0, count);
}

export function exportAuditCSV(entries: AuditEntry[]): string {
  const header = "Timestamp,User,Role,Action,Detail,Session";
  const rows = entries.map(
    (e) =>
      `"${e.timestamp}","${e.username}","${e.role}","${e.action}","${e.detail.replace(/"/g, '""')}","${e.sessionId}"`
  );
  return [header, ...rows].join("\n");
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
