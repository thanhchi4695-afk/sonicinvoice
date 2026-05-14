import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ArrowLeft,
  Bot,
  Check,
  X,
  ChevronRight,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface CallRow {
  id: string;
  tool_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  arguments: Record<string, unknown> | null;
  called_at: string;
}

const fmtDuration = (ms: number | null) => {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const fmtRelative = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return `Yesterday at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleString();
};

const fmtArgs = (a: Record<string, unknown> | null) => {
  if (!a || Object.keys(a).length === 0) return "—";
  return Object.entries(a)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
};

const toolBadgeClass = (name: string) => {
  if (/^(run_|create_|generate_)/.test(name)) {
    return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  }
  return "bg-blue-500/15 text-blue-600 border-blue-500/30";
};

export default function ClaudeActivity() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const [{ data: callData }, { data: tokenData }] = await Promise.all([
      supabase
        .from("mcp_tool_calls")
        .select("id, tool_name, status, duration_ms, error_message, arguments, called_at")
        .order("called_at", { ascending: false })
        .limit(100),
      supabase
        .from("sonic_mcp_tokens")
        .select("id")
        .is("revoked_at", null)
        .limit(1),
    ]);
    setRows((callData ?? []) as CallRow[]);
    setHasToken((tokenData ?? []).length > 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const week = rows.filter((r) => new Date(r.called_at).getTime() > weekAgo).length;
    const success = rows.filter((r) => r.status === "success").length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    const lastActive = rows[0]?.called_at ?? null;
    return { total, week, successRate, lastActive };
  }, [rows]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="container mx-auto max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-[hsl(280,70%,60%)]" />
            Claude Activity Log
          </h1>
          <p className="text-muted-foreground mt-1">
            Every tool call Claude has made in your store
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/claude-connector">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Claude settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Not-connected banner */}
      {!loading && hasToken === false && (
        <div className="flex items-center justify-between rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span>Claude is not connected to this store.</span>
          </div>
          <Link
            to="/settings/claude-connector"
            className="font-medium text-primary hover:underline"
          >
            Set up connection →
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total calls" value={stats.total.toString()} />
        <StatCard label="This week" value={stats.week.toString()} />
        <StatCard label="Success rate" value={`${stats.successRate}%`} />
        <StatCard
          label="Last active"
          value={stats.lastActive ? fmtRelative(stats.lastActive) : "—"}
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent tool calls</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <Bot className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No activity yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                {hasToken
                  ? "Claude hasn't called any tools yet. Start a conversation in Claude.ai using your connector."
                  : "Claude hasn't connected to your store yet. Set up the connection in Claude Connector settings."}
              </p>
              <Button asChild className="mt-4" size="sm">
                <Link to="/settings/claude-connector">Go to Claude Connector</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              <div className="px-4 py-2 grid grid-cols-12 gap-3 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
                <div className="col-span-4">Tool</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Duration</div>
                <div className="col-span-4 text-right">When</div>
              </div>
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                const canExpand = r.status === "error" || (r.arguments && Object.keys(r.arguments).length > 0);
                return (
                  <div key={r.id}>
                    <button
                      type="button"
                      onClick={() => canExpand && toggle(r.id)}
                      className={`w-full px-4 py-3 grid grid-cols-12 gap-3 items-center text-sm text-left ${
                        canExpand ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <div className="col-span-4 flex items-center gap-2">
                        {canExpand && (
                          <ChevronRight
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        )}
                        <Badge variant="outline" className={`font-mono text-[11px] ${toolBadgeClass(r.tool_name)}`}>
                          {r.tool_name}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        {r.status === "success" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                            <Check className="h-3.5 w-3.5" /> success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive text-xs font-medium">
                            <X className="h-3.5 w-3.5" /> error
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 font-mono text-xs text-muted-foreground">
                        {fmtDuration(r.duration_ms)}
                      </div>
                      <div className="col-span-4 text-xs text-muted-foreground text-right">
                        {fmtRelative(r.called_at)}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 pl-12 space-y-2">
                        {r.arguments && Object.keys(r.arguments).length > 0 && (
                          <div className="text-xs">
                            <div className="text-muted-foreground mb-1">Arguments</div>
                            <code className="block px-2 py-1.5 rounded bg-muted font-mono text-[11px] break-all">
                              {fmtArgs(r.arguments)}
                            </code>
                          </div>
                        )}
                        {r.error_message && (
                          <div className="text-xs">
                            <div className="text-destructive mb-1">Error</div>
                            <code className="block px-2 py-1.5 rounded bg-destructive/10 text-destructive font-mono text-[11px] break-all">
                              {r.error_message}
                            </code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </CardTitle>
    </CardHeader>
    <CardContent className="text-2xl font-mono font-semibold">{value}</CardContent>
  </Card>
);
