import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  AlertTriangle,
  Circle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_LABELS, PIPELINE_LABELS } from "@/lib/agent-task-graph";

interface AgentTaskRow {
  id: string;
  task_type: string;
  status: string;
  observation: string | null;
  result_summary: string | null;
  pipeline_id: string | null;
  pipeline_step: number | null;
  trigger_source: string | null;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  trigger_context: Record<string, unknown> | null;
}

interface PipelineRun {
  pipelineId: string;
  pipelineLabel: string;
  startedAt: string;
  lastActivityAt: string;
  steps: AgentTaskRow[];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = (m / 60).toFixed(1);
  return `${h} hr`;
}

const STATUS_META: Record<
  string,
  { icon: typeof Check; cls: string; label: string }
> = {
  completed: { icon: Check, cls: "border-success bg-success/10 text-success", label: "Done" },
  approved: { icon: Loader2, cls: "border-primary bg-primary/10 text-primary", label: "Approved" },
  running: { icon: Loader2, cls: "border-primary bg-primary/10 text-primary animate-pulse", label: "Running" },
  permission_requested: { icon: Clock, cls: "border-amber-500 bg-amber-500/10 text-amber-500", label: "Awaiting" },
  suggested: { icon: Clock, cls: "border-amber-500 bg-amber-500/10 text-amber-500", label: "Suggested" },
  skipped: { icon: Circle, cls: "border-border bg-muted text-muted-foreground", label: "Skipped" },
  failed: { icon: AlertTriangle, cls: "border-destructive bg-destructive/10 text-destructive", label: "Failed" },
};

const PipelineTimelineSection = () => {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const load = async (uid: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("agent_tasks")
      .select(
        "id, task_type, status, observation, result_summary, pipeline_id, pipeline_step, trigger_source, created_at, approved_at, started_at, completed_at, trigger_context",
      )
      .eq("user_id", uid)
      .not("pipeline_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(200);

    const byPipeline = new Map<string, AgentTaskRow[]>();
    ((data ?? []) as AgentTaskRow[]).forEach((r) => {
      // Group runs by pipeline_id + day so distinct executions aren't merged
      const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
      const key = `${r.pipeline_id}__${dayKey}`;
      const arr = byPipeline.get(key) ?? [];
      arr.push(r);
      byPipeline.set(key, arr);
    });

    const built: PipelineRun[] = Array.from(byPipeline.entries()).map(
      ([key, steps]) => {
        const pipelineId = steps[0].pipeline_id ?? key.split("__")[0];
        steps.sort((a, b) => {
          const sa = a.pipeline_step ?? 999;
          const sb = b.pipeline_step ?? 999;
          if (sa !== sb) return sa - sb;
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
        return {
          pipelineId: key,
          pipelineLabel:
            PIPELINE_LABELS[pipelineId] ??
            pipelineId.replace(/^pipeline_/, "").replace(/_/g, " "),
          startedAt: steps[0].created_at,
          lastActivityAt: steps[steps.length - 1].completed_at ??
            steps[steps.length - 1].created_at,
          steps,
        };
      },
    );

    built.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    );
    setRuns(built.slice(0, 10));
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) load(uid);
    });
  }, []);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold font-display">
            Pipeline progress timeline
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each chained step from Sonic's pipelines, with status and timestamps.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => userId && load(userId)}
          disabled={!userId || loading}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && runs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No pipeline runs yet. Run any chained pipeline (New arrivals, SEO
            boost, Restock…) and it'll show up here.
          </div>
        )}
        {!loading &&
          runs.map((run) => {
            const isOpen = openId === run.pipelineId;
            const doneCount = run.steps.filter(
              (s) => s.status === "completed",
            ).length;
            const total = run.steps.length;
            const failed = run.steps.some((s) => s.status === "failed");
            const running = run.steps.some(
              (s) => s.status === "running" || s.status === "approved",
            );
            const pending = run.steps.some(
              (s) =>
                s.status === "suggested" || s.status === "permission_requested",
            );
            const overall = failed
              ? { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/30" }
              : running
                ? { label: "In progress", cls: "bg-primary/15 text-primary border-primary/30" }
                : pending
                  ? { label: "Awaiting", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" }
                  : doneCount === total
                    ? { label: "Complete", cls: "bg-success/15 text-success border-success/30" }
                    : { label: "Mixed", cls: "bg-muted text-muted-foreground border-border" };

            return (
              <div key={run.pipelineId}>
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : run.pipelineId)}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/40 flex items-center gap-3"
                >
                  <span className="text-xs font-medium capitalize w-44 truncate">
                    {run.pipelineLabel}
                  </span>
                  <Badge variant="outline" className={`text-[10px] ${overall.cls}`}>
                    {overall.label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground font-mono-data">
                    {doneCount}/{total} steps
                  </span>
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    Started {fmtTime(run.startedAt)}
                    {run.lastActivityAt !== run.startedAt && (
                      <> · Last update {fmtTime(run.lastActivityAt)}</>
                    )}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                {isOpen && (
                  <ol className="px-4 pb-4 pt-1 space-y-0 bg-muted/20 animate-fade-in">
                    {run.steps.map((step, i) => {
                      const meta =
                        STATUS_META[step.status] ?? STATUS_META.suggested;
                      const Icon = meta.icon;
                      const stepLabel =
                        TASK_LABELS[step.task_type as keyof typeof TASK_LABELS] ??
                        step.task_type;
                      const dur = fmtDuration(
                        step.started_at ?? step.approved_at ?? step.created_at,
                        step.completed_at,
                      );
                      const isLast = i === run.steps.length - 1;
                      return (
                        <li key={step.id} className="flex gap-3">
                          {/* Rail */}
                          <div className="flex flex-col items-center pt-2">
                            <div
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-full border",
                                meta.cls,
                              )}
                            >
                              <Icon
                                className={cn(
                                  "h-3 w-3",
                                  step.status === "running" && "animate-spin",
                                  step.status === "approved" && "animate-spin",
                                )}
                              />
                            </div>
                            {!isLast && (
                              <div
                                className={cn(
                                  "w-0.5 flex-1 mt-1 mb-1 min-h-[24px]",
                                  step.status === "completed"
                                    ? "bg-success/40"
                                    : "bg-border",
                                )}
                              />
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 py-2 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium">
                                {step.pipeline_step != null && (
                                  <span className="text-muted-foreground font-mono-data mr-1.5">
                                    #{step.pipeline_step + 1}
                                  </span>
                                )}
                                {stepLabel}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] uppercase tracking-wide border",
                                  meta.cls,
                                )}
                              >
                                {meta.label}
                              </Badge>
                              {dur && (
                                <span className="text-[10px] font-mono-data text-muted-foreground">
                                  {dur}
                                </span>
                              )}
                            </div>
                            {(step.result_summary || step.observation) && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                {step.result_summary || step.observation}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground/80 font-mono-data mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>Created {fmtTime(step.created_at)}</span>
                              {step.approved_at && (
                                <span>Approved {fmtTime(step.approved_at)}</span>
                              )}
                              {step.started_at && (
                                <span>Started {fmtTime(step.started_at)}</span>
                              )}
                              {step.completed_at && (
                                <span>Completed {fmtTime(step.completed_at)}</span>
                              )}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default PipelineTimelineSection;
