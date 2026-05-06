import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TASK_LABELS } from "@/lib/agent-task-graph";

interface AgentTaskRow {
  id: string;
  task_type: string;
  status: string;
  observation: string | null;
  proposed_action: string | null;
  result_summary: string | null;
  trigger_source: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-primary/15 text-primary border-primary/30" },
  approved: { label: "Approved", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground border-border" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive border-destructive/30" },
  permission_requested: { label: "Awaiting", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  suggested: { label: "Suggested", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  running: { label: "Running", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const TaskHistorySection = () => {
  const [rows, setRows] = useState<AgentTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const load = async (uid: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("agent_tasks")
      .select(
        "id, task_type, status, observation, proposed_action, result_summary, trigger_source, created_at, approved_at, completed_at",
      )
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);
    setRows((data ?? []) as AgentTaskRow[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) load(uid);
    });
  }, []);

  const clearOld = async () => {
    if (!userId) return;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("agent_tasks")
      .delete()
      .eq("user_id", userId)
      .in("status", ["completed", "skipped"])
      .lt("created_at", cutoff);
    if (error) {
      toast.error("Couldn't clear history");
    } else {
      toast.success("Cleared completed tasks older than 7 days");
      load(userId);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold font-display">Sonic task history</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => userId && load(userId)}
            disabled={!userId || loading}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={clearOld} disabled={!userId}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear old
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No agent activity yet.
          </div>
        )}
        {!loading &&
          rows.map((r) => {
            const badge = STATUS_BADGE[r.status] ?? {
              label: r.status,
              className: "bg-muted text-muted-foreground border-border",
            };
            const label = TASK_LABELS[r.task_type as keyof typeof TASK_LABELS] ?? r.task_type;
            const isOpen = expanded === r.id;
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/40 flex items-center gap-3"
                >
                  <span className="text-xs font-medium w-32 truncate">{label}</span>
                  <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
                    {badge.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    {(r.observation ?? "").slice(0, 60)}
                    {(r.observation?.length ?? 0) > 60 ? "…" : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono-data">
                    {relativeTime(r.created_at)}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 text-xs space-y-1 bg-muted/20">
                    {r.observation && (
                      <p>
                        <span className="text-muted-foreground">Observation: </span>
                        {r.observation}
                      </p>
                    )}
                    {r.proposed_action && (
                      <p>
                        <span className="text-muted-foreground">Proposed: </span>
                        {r.proposed_action}
                      </p>
                    )}
                    {r.result_summary && (
                      <p>
                        <span className="text-muted-foreground">Result: </span>
                        {r.result_summary}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground font-mono-data pt-1">
                      Created {new Date(r.created_at).toLocaleString()}
                      {r.approved_at && ` · Approved ${new Date(r.approved_at).toLocaleString()}`}
                      {r.completed_at && ` · Completed ${new Date(r.completed_at).toLocaleString()}`}
                      {r.trigger_source && ` · Trigger: ${r.trigger_source}`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default TaskHistorySection;
