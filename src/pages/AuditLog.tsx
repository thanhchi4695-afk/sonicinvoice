import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Hand,
  Play,
  RotateCcw,
  ScrollText,
  Search,
  Shield,
  ShieldAlert,
  User,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import type { AuditEventType } from "@/types/agent";

type AuditRow = {
  id: string;
  shop_id: string;
  run_id: string | null;
  action_id: string | null;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const PAGE_SIZE = 50;

const EVENT_TYPES: AuditEventType[] = [
  "action_started",
  "action_completed",
  "action_failed",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "rollback",
  "manual_override",
];

const EVENT_META: Record<
  AuditEventType | "default",
  { label: string; color: string; icon: typeof Play }
> = {
  action_started: { label: "Action started", color: "bg-blue-500", icon: Play },
  action_completed: { label: "Action completed", color: "bg-emerald-500", icon: CheckCircle2 },
  action_failed: { label: "Action failed", color: "bg-rose-500", icon: XCircle },
  approval_requested: { label: "Approval requested", color: "bg-amber-500", icon: Shield },
  approval_granted: { label: "Approval granted", color: "bg-emerald-500", icon: CheckCircle2 },
  approval_rejected: { label: "Approval rejected", color: "bg-rose-500", icon: XCircle },
  rollback: { label: "Rollback", color: "bg-orange-500", icon: RotateCcw },
  manual_override: { label: "Manual override", color: "bg-violet-500", icon: Hand },
  default: { label: "Event", color: "bg-slate-500", icon: Clock },
};

function ActorBadge({ actor, currentUserId }: { actor: string; currentUserId?: string | null }) {
  if (actor === "agent") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="w-3 h-3" /> Agent
      </span>
    );
  }
  if (actor === "system") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ShieldAlert className="w-3 h-3" /> System
      </span>
    );
  }
  const isMe = currentUserId && actor === currentUserId;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <User className="w-3 h-3" />
      {isMe ? "You" : actor.slice(0, 8)}
    </span>
  );
}

function PayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Payload
      </button>
      {open && (
        <pre className="mt-1 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto font-mono-data text-muted-foreground">
          {text}
        </pre>
      )}
    </div>
  );
}

function exportCSV(rows: AuditRow[]): string {
  const header = "Timestamp,Event Type,Actor,Run ID,Action ID,Payload";
  const lines = rows.map((r) => {
    const payload = JSON.stringify(r.payload).replace(/"/g, '""');
    return `"${r.created_at}","${r.event_type}","${r.actor}","${r.run_id ?? ""}","${r.action_id ?? ""}","${payload}"`;
  });
  return [header, ...lines].join("\n");
}

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filterEvent, setFilterEvent] = useState<AuditEventType | "all">("all");
  const [filterActor, setFilterActor] = useState<"all" | "agent" | "system" | "user">("all");
  const [search, setSearch] = useState("");
  const [filterRunId, setFilterRunId] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resolve current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const fetchRows = useCallback(
    async (append = false, customOffset = 0) => {
      let query = supabase
        .from("sonic_audit_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE)
        .range(customOffset, customOffset + PAGE_SIZE - 1);

      if (filterEvent !== "all") {
        query = query.eq("event_type", filterEvent);
      }
      if (filterActor !== "all") {
        if (filterActor === "user") {
          query = query.not("actor", "in", "(\"agent\",\"system\")");
        } else {
          query = query.eq("actor", filterActor);
        }
      }
      if (filterRunId.trim()) {
        query = query.eq("run_id", filterRunId.trim());
      }

      const { data, error, count } = await query;
      if (error) {
        toast.error(error.message);
        return;
      }
      const typed = (data as AuditRow[]) ?? [];
      if (append) {
        setRows((prev) => {
          const existing = new Set(prev.map((r) => r.id));
          return [...prev, ...typed.filter((r) => !existing.has(r.id))];
        });
      } else {
        setRows(typed);
      }
      setHasMore((count ?? 0) > customOffset + PAGE_SIZE);
    },
    [filterEvent, filterActor, filterRunId]
  );

  // Initial load
  useEffect(() => {
    setLoading(true);
    setOffset(0);
    fetchRows(false, 0).finally(() => setLoading(false));
  }, [fetchRows]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("sonic-audit-log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sonic_audit_log" },
        (payload) => {
          const row = payload.new as AuditRow;
          setRows((prev) => {
            if (prev.find((r) => r.id === row.id)) return prev;
            // If filters apply, check them before prepending
            if (filterEvent !== "all" && row.event_type !== filterEvent) return prev;
            if (filterActor !== "all") {
              if (filterActor === "user" && (row.actor === "agent" || row.actor === "system")) return prev;
              if (filterActor !== "user" && row.actor !== filterActor) return prev;
            }
            if (filterRunId.trim() && row.run_id !== filterRunId.trim()) return prev;
            return [row, ...prev];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterEvent, filterActor, filterRunId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.event_type.toLowerCase().includes(q) ||
        r.actor.toLowerCase().includes(q) ||
        JSON.stringify(r.payload).toLowerCase().includes(q)
    );
  }, [rows, search]);

  function handleLoadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    setLoadingMore(true);
    fetchRows(true, nextOffset).finally(() => setLoadingMore(false));
  }

  function handleExport() {
    const csv = exportCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported CSV");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <ScrollText className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-semibold">Audit Log</h1>
            <Badge variant="secondary" className="text-base">
              {filtered.length}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          <select
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value as AuditEventType | "all")}
            className="h-9 rounded-md bg-input border border-border px-2 text-xs text-foreground"
          >
            <option value="all">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_META[t]?.label ?? t}
              </option>
            ))}
          </select>
          <select
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value as any)}
            className="h-9 rounded-md bg-input border border-border px-2 text-xs text-foreground"
          >
            <option value="all">All actors</option>
            <option value="agent">Agent</option>
            <option value="system">System</option>
            <option value="user">Users</option>
          </select>
          <Input
            placeholder="Run ID filter…"
            value={filterRunId}
            onChange={(e) => setFilterRunId(e.target.value)}
            className="h-9 text-xs"
          />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search payload…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading audit log…</div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <ScrollText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <div className="text-lg font-medium">No audit entries found.</div>
            <p className="text-sm text-muted-foreground mt-1">
              Agent actions and approvals will be logged here as they happen.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => {
              const meta = EVENT_META[(row.event_type as AuditEventType) ?? "default"] ?? EVENT_META.default;
              const Icon = meta.icon;
              const isExpanded = expandedId === row.id;
              return (
                <Card
                  key={row.id}
                  className={cn(
                    "p-4 transition hover:shadow-sm border",
                    isExpanded && "border-primary/50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 w-2 h-2 rounded-full shrink-0", meta.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{meta.label}</span>
                        <ActorBadge actor={row.actor} currentUserId={currentUserId} />
                        <span
                          className="text-[10px] text-muted-foreground ml-auto font-mono-data"
                          title={new Date(row.created_at).toLocaleString()}
                        >
                          {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      {/* Quick links */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        {row.run_id && (
                          <Link
                            to={`/agent?run_id=${row.run_id}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Run {row.run_id.slice(0, 6)}
                          </Link>
                        )}
                        {row.action_id && (
                          <span className="text-muted-foreground">
                            Action {row.action_id.slice(0, 6)}
                          </span>
                        )}
                      </div>

                      {/* Payload */}
                      {Object.keys(row.payload).length > 0 && (
                        <PayloadPreview payload={row.payload} />
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
