// AgentChatPanel — right-rail panel that streams agent decisions in real time.
// Subscribes to Realtime on agent_sessions + agent_step_runs for the active session.
// Renders each step run as a chat bubble with confidence, narrative, and gate actions.
import { useEffect, useMemo, useState, useCallback } from "react";
import { Bot, Loader2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, SkipForward, RotateCcw, Zap, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import BudgetPill from "@/components/BudgetPill";
import { cn } from "@/lib/utils";

type StepRunStatus = "running" | "done" | "needs_review" | "skipped" | "failed";
type SessionStatus = "running" | "awaiting_gate" | "completed" | "failed" | "cancelled";

interface AgentSession {
  id: string;
  status: SessionStatus;
  current_step: string | null;
  agent_mode: string;
  total_cost_cents: number;
  gate_count: number;
  last_narrative: string | null;
  metadata: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

interface AgentStepRun {
  id: string;
  session_id: string;
  step: string;
  attempt: number;
  status: StepRunStatus;
  confidence: number | null;
  narrative: string | null;
  output: Record<string, unknown> | null;
  input: Record<string, unknown> | null;
  cost_cents: number;
  duration_ms: number | null;
  started_at: string;
  ended_at: string | null;
}

interface AgentChatPanelProps {
  sessionId: string | null;
  onGateResponse?: (stepRunId: string, choice: string) => void;
  className?: string;
}

const STEP_LABELS: Record<string, string> = {
  capture: "Capture",
  extract: "Extract",
  stock_check: "Stock check",
  enrich: "Enrich",
  price: "Price",
  publish: "Publish",
};

const formatCost = (cents: number) => `${(cents / 100).toFixed(2)}¢`.replace(".00", "");

function StatusIcon({ status }: { status: StepRunStatus }) {
  switch (status) {
    case "running": return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />;
    case "done": return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    case "needs_review": return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />;
    case "skipped": return <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />;
    case "failed": return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  }
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const tone = value >= 0.85 ? "bg-green-500/15 text-green-600 border-green-500/30"
    : value >= 0.70 ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : "bg-destructive/15 text-destructive border-destructive/30";
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", tone)}>
      {pct}%
    </span>
  );
}

function StepBubble({
  run,
  onGateResponse,
}: {
  run: AgentStepRun;
  onGateResponse?: (stepRunId: string, choice: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = (run.output?.metadata ?? {}) as Record<string, unknown>;
  const decision = (run.output?.decision as string | undefined) ?? null;
  const gateQuestion = (run.output?.gate_question as string | null) ?? null;
  const gateOptions = (run.output?.gate_options as string[] | null) ?? null;
  const isGate = run.status === "needs_review" && Array.isArray(gateOptions) && gateOptions.length > 0;
  const degraded = Boolean(meta?.degraded);

  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <StatusIcon status={run.status} />
          <span className="text-xs font-semibold">{STEP_LABELS[run.step] ?? run.step}</span>
          {run.attempt > 1 && (
            <span className="text-[10px] text-muted-foreground">attempt {run.attempt}</span>
          )}
          <ConfidenceBadge value={run.confidence} />
          {decision && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
              {decision}
            </Badge>
          )}
          {degraded && (
            <span className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
              <Wallet className="w-2.5 h-2.5" /> budget saver
            </span>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed">
          {run.narrative ?? <span className="text-muted-foreground italic">No narrative</span>}

          {isGate && gateQuestion && (
            <div className="mt-2 pt-2 border-t border-border/60">
              <p className="text-xs font-medium mb-2">{gateQuestion}</p>
              <div className="flex gap-1.5 flex-wrap">
                {gateOptions!.map((opt) => (
                  <Button
                    key={opt}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onGateResponse?.(run.id, opt)}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {(run.input || run.output) && (
            <div className="mt-2 pt-2 border-t border-border/60">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Details
              </button>
              {expanded && (
                <pre className="mt-1.5 text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-h-48 font-mono leading-snug">
                  {JSON.stringify({ input: run.input, output: run.output }, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
          <span>{new Date(run.started_at).toLocaleTimeString()}</span>
          {run.duration_ms != null && <span>· {(run.duration_ms / 1000).toFixed(1)}s</span>}
          {run.cost_cents > 0 && <span>· {formatCost(run.cost_cents)}</span>}
        </div>
      </div>
    </div>
  );
}

export default function AgentChatPanel({ sessionId, onGateResponse, className }: AgentChatPanelProps) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [runs, setRuns] = useState<AgentStepRun[]>([]);
  const [loading, setLoading] = useState(false);

  // Initial load
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setRuns([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: s }, { data: r }] = await Promise.all([
        supabase.from("agent_sessions").select("*").eq("id", sessionId).maybeSingle(),
        supabase.from("agent_step_runs").select("*").eq("session_id", sessionId).order("started_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setSession((s as AgentSession | null) ?? null);
      setRuns((r as AgentStepRun[] | null) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Realtime subscriptions
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`agent-session-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setSession(payload.new as AgentSession);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_step_runs", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const next = payload.new as AgentStepRun;
          setRuns((prev) => {
            const idx = prev.findIndex((r) => r.id === next.id);
            if (idx === -1) return [...prev, next].sort((a, b) => a.started_at.localeCompare(b.started_at));
            const copy = prev.slice();
            copy[idx] = next;
            return copy;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  const totalCost = session?.total_cost_cents ?? 0;
  const degraded = Boolean(session?.metadata && (session.metadata as { degraded?: boolean }).degraded);

  const headerStatus = useMemo(() => {
    if (!session) return null;
    switch (session.status) {
      case "running": return { label: "Running", tone: "text-primary" };
      case "awaiting_gate": return { label: "Waiting for you", tone: "text-amber-600" };
      case "completed": return { label: "Complete", tone: "text-green-600" };
      case "failed": return { label: "Failed", tone: "text-destructive" };
      case "cancelled": return { label: "Cancelled", tone: "text-muted-foreground" };
    }
  }, [session]);

  const handleGate = useCallback((stepRunId: string, choice: string) => {
    onGateResponse?.(stepRunId, choice);
  }, [onGateResponse]);

  if (!sessionId) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground", className)}>
        <Bot className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No active agent session</p>
        <p className="text-xs mt-1">Start an invoice import to see live decisions here.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-background border-l border-border", className)}>
      {/* Header */}
      <div className="border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold flex-1">Agent</h3>
          {headerStatus && (
            <span className={cn("text-[10px] font-medium", headerStatus.tone)}>
              {headerStatus.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {session?.agent_mode && <span className="capitalize">{session.agent_mode} mode</span>}
          {session && <span>· {session.gate_count} gates</span>}
          {totalCost > 0 && <span>· {formatCost(totalCost)} spent</span>}
          {degraded && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <Wallet className="w-2.5 h-2.5" /> budget saver
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {loading && runs.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading session…
            </div>
          )}

          {!loading && runs.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2 opacity-50" />
              Waiting for the first step…
            </div>
          )}

          {runs.map((run) => (
            <StepBubble key={run.id} run={run} onGateResponse={handleGate} />
          ))}

          {session?.status === "failed" && session.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <div className="flex items-center gap-1.5 mb-1 font-semibold text-destructive">
                <AlertCircle className="w-3.5 h-3.5" /> Session failed
              </div>
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(session.error, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer hint */}
      {session?.status === "awaiting_gate" && (
        <div className="border-t border-border px-4 py-2 shrink-0 bg-amber-500/5">
          <p className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Pick an option above to continue.
          </p>
        </div>
      )}
    </div>
  );
}
