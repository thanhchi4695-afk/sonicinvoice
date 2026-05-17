import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Sparkles, TrendingUp, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { cn } from "@/lib/utils";

interface Experiment {
  id: string;
  variant_id: string;
  prompt_template: string;
  temperature: number | null;
  approval_rate: number | null;
  sample_size: number | null;
  is_active: boolean;
  promoted_at: string | null;
  created_at: string;
}

interface RunLog {
  id: string;
  run_started_at: string;
  run_completed_at: string | null;
  experiments_ran: number | null;
  winning_variant_id: string | null;
  previous_variant_id: string | null;
  improvement_percentage: number | null;
  promoted: boolean | null;
  error_message: string | null;
}

export default function PromptOptimizerPanel() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  const [active, setActive] = useState<Experiment | null>(null);
  const [recent, setRecent] = useState<Experiment[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: exps }, { data: runs }] = await Promise.all([
      supabase
        .from("prompt_experiments")
        .select("*")
        .eq("experiment_type", "collection_description")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("prompt_optimizer_log")
        .select("*")
        .eq("experiment_type", "collection_description")
        .order("run_started_at", { ascending: false })
        .limit(10),
    ]);
    const list = (exps ?? []) as unknown as Experiment[];
    setActive(list.find((e) => e.is_active) ?? null);
    setRecent(list);
    setLogs((runs ?? []) as unknown as RunLog[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runNow() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("prompt-optimizer-run", { body: {} });
      if (error) throw error;
      toast.success(`Optimizer ran — ${data?.cron?.variants_inserted ?? 0} new variants`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function makeActive(id: string) {
    if (!isAdmin) return;
    // Deactivate all, activate selected
    const { error: e1 } = await supabase
      .from("prompt_experiments")
      .update({ is_active: false })
      .eq("experiment_type", "collection_description");
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase
      .from("prompt_experiments")
      .update({ is_active: true, promoted_at: new Date().toISOString() })
      .eq("id", id);
    if (e2) { toast.error(e2.message); return; }
    toast.success("Variant promoted");
    await load();
  }

  if (!isAdmin) return null;

  return (
    <Card className="border-violet-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-300" />
            AI Optimizer
            <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">Karpathy Loop</Badge>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
            Run now
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Nightly at 02:00 UTC. Generates {6} prompt variants, A/B tests on a held-constant 50-product set,
          promotes the winner when approval rate beats current by ≥5pp with ≥100 samples.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            {/* Active variant */}
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Current winning prompt</div>
                {active && (
                  <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                    {active.variant_id}
                  </Badge>
                )}
              </div>
              {active ? (
                <>
                  <div className="flex gap-4 text-xs font-mono-data tabular-nums mb-2">
                    <span>approval: <span className="text-emerald-300">{active.approval_rate != null ? `${Math.round(active.approval_rate * 100)}%` : "—"}</span></span>
                    <span>samples: <span className="text-foreground">{active.sample_size ?? 0}</span></span>
                    <span>temp: <span className="text-foreground">{active.temperature ?? "—"}</span></span>
                  </div>
                  <button
                    onClick={() => setExpanded((x) => !x)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {expanded ? "Hide template" : "View template"}
                  </button>
                  {expanded && (
                    <pre className="mt-2 text-[11px] whitespace-pre-wrap text-muted-foreground max-h-48 overflow-auto bg-background/50 p-2 rounded">
                      {active.prompt_template}
                    </pre>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No active variant.</div>
              )}
            </div>

            {/* Recent experiments */}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Recent variants</div>
              <div className="rounded-md border border-border overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_80px_90px] gap-2 px-3 py-1.5 border-b border-border bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <span>Variant</span>
                  <span>Approval</span>
                  <span>Samples</span>
                  <span>Temp</span>
                  <span></span>
                </div>
                {recent.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">No experiments yet.</div>
                ) : recent.map((e) => (
                  <div
                    key={e.id}
                    className={cn(
                      "grid grid-cols-[1fr_80px_80px_80px_90px] gap-2 px-3 py-1.5 border-b border-border last:border-0 items-center text-xs",
                      e.is_active && "bg-emerald-500/5",
                    )}
                  >
                    <span className="font-mono-data truncate">{e.variant_id}</span>
                    <span className="font-mono-data tabular-nums">
                      {e.approval_rate != null ? `${Math.round(e.approval_rate * 100)}%` : "—"}
                    </span>
                    <span className="font-mono-data tabular-nums">{e.sample_size ?? 0}</span>
                    <span className="font-mono-data tabular-nums">{e.temperature ?? "—"}</span>
                    {e.is_active ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] justify-self-end">Active</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] justify-self-end" onClick={() => makeActive(e.id)}>
                        Make active
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Run history */}
            {logs.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Recent runs</div>
                <div className="space-y-1.5">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-muted/20 border border-border">
                      <span className="font-mono-data text-muted-foreground">
                        {new Date(l.run_started_at).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{l.experiments_ran ?? 0} variants</span>
                        {l.promoted && l.improvement_percentage != null && (
                          <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                            <TrendingUp className="w-2.5 h-2.5 mr-0.5" />
                            +{Math.round(l.improvement_percentage * 100)}pp
                          </Badge>
                        )}
                        {l.error_message && (
                          <Badge className="bg-red-500/15 text-red-300 border border-red-500/30 text-[10px]">Error</Badge>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
