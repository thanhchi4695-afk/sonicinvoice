import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, Download, Search, Filter } from "lucide-react";
import {
  getAuditEntries,
  exportAuditCSV,
  formatRelativeTime,
  type AuditEntry,
} from "@/lib/audit-log";

interface AuditLogPanelProps {
  onBack: () => void;
}

const ACTION_CATEGORIES = [
  "All actions",
  "Login",
  "Logout",
  "Upload",
  "Parse",
  "Enrich",
  "Export",
  "Inventory",
  "PO",
  "Catalog",
  "Duplicate",
  "Settings",
];

const AuditLogPanel = ({ onBack }: AuditLogPanelProps) => {
  const isAdmin =
    localStorage.getItem("user_role") === "admin";
  const allEntries = useMemo(() => getAuditEntries(isAdmin), [isAdmin]);

  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("All actions");
  const [userFilter, setUserFilter] = useState("All users");

  const users = useMemo(() => {
    const set = new Set(allEntries.map((e) => e.username));
    return ["All users", ...Array.from(set)];
  }, [allEntries]);

  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      if (actionFilter !== "All actions" && e.action !== actionFilter) return false;
      if (userFilter !== "All users" && e.username !== userFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return (
          e.detail.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          e.username.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allEntries, actionFilter, userFilter, searchTerm]);

  const handleExport = () => {
    const csv = exportAuditCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl font-bold font-display mb-1">📋 Audit Log</h1>
      <p className="text-muted-foreground text-sm mb-4">
        {isAdmin ? "All user activity" : "Your activity log"}
      </p>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="h-9 rounded-md bg-input border border-border px-2 text-xs text-foreground"
        >
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-9 rounded-md bg-input border border-border px-2 text-xs text-foreground"
        >
          {ACTION_CATEGORIES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search audit log..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8 h-9 text-xs"
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          {filtered.length} entries
        </span>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="text-xs h-7"
          >
            <Download className="w-3 h-3 mr-1" /> Export CSV
          </Button>
        )}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-sm font-medium">No activity recorded yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Actions will appear here as you use the app.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="bg-card rounded-lg border border-border px-3 py-2.5"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    entry.role === "admin"
                      ? "bg-secondary/20 text-secondary"
                      : "bg-primary/15 text-primary"
                  }`}
                >
                  {entry.username}
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {entry.action}
                </span>
                <span
                  className="text-[10px] text-muted-foreground ml-auto font-mono-data"
                  title={new Date(entry.timestamp).toLocaleString()}
                >
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {entry.detail}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditLogPanel;
