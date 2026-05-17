import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Play, TrendingUp, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { cn } from "@/lib/utils";

interface Experiment {
  id: string;
  variant_id: string;
  strategy_name: string;
  parameters: any;
  efficiency_score: number | null;
  velocity_gain_pct: number | null;
  margin_loss_pct: number | null;
  sample_size: number | null;
  is_active: boolean;
  blacklisted: boolean;
  pending_human_approval: boolean;
  parent_variant_id: string | null;
  promoted_at: string | null;
  test_started_at: string | null;
  test_completed_at: string | null;
}

interface RunLog {
  id: string;
  run_type: string;
  run_started_at: string;
  run_completed_at: string | null;
  experiments_ran: number | null;
  winning_variant_id: string | null;
  efficiency_improvement_pct: number | null;
  promoted: boolean | null;
  error_message: string | null;
}

interface Settings {
  user_id: string;
  enabled: boolean;
  auto_promote: boolean;
  max_margin_loss_pct: number;
}

export default function DiscountOptimizerPanel() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  const [active, setActive] = useState<Experiment | null>(null);
  const [recent, setRecent] = useState<Experiment[]>([]);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const [{ data: exps }, { data: runs }, { data: s }] = await Promise.all([
      supabase
        .from("discount_strategy_experiments")
        .select("*")
        .order("test_started_at", { ascending: false, nullsFirst: false })
        .limit(20),
      supabase
        .from("discount_strategy_log")
        .select("*")
        .order("run_started_at", { ascending: false })
        .limit(10),
      user
        ? supabase.from("discount_optimizer_settings").select("*").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const list = (exps ?? []) as unknown as Experiment[];
    setActive(list.find((e) => e.is_active) ?? null);
    setRecent(list);
    setLogs((runs ?? []) as unknown as RunLog[]);
    setSettings(s ? (s as unknown as Settings) : (user ? { user_id: user.id, enabled: false, auto_promote: false, max_margin_loss_pct: 15 } : null));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await supabase.from("discount_optimizer_settings").upsert(next, { onConflict: "user_id" });
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("discount-optimizer-run", { body: {} });
      if (error) throw error;
      toast.success(`Optimizer ran — ${data?.start?.variants ?? 0} variants, ${data?.start?.products_assigned ?? 0} products assigned`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function makeActive(id: string) {
    await supabase.from("discount_strategy_experiments").update({ is_active: false }).neq("id", id);
    await supabase
      .from("discount_strategy_experiments")
      .update({ is_active: true, promoted_at: new Date().toISOString(), pending_human_approval: false })
      .eq("id", id);
    toast.success("Variant promoted");
    await load();
  }

  if (!isAdmin) return null;

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-amber-300" />
            Discount Optimizer
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-300">Karpathy Loop</Badge>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
            Run now
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Weekly Sunday 02:00 UTC. Generates parameter variants, tests on 100 held-constant products,
          promotes the winner when efficiency (velocity ÷ margin loss) beats current by ≥10% with ≥50 samples.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            {/* Settings */}
            {settings && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Enable autonomous optimisation</span>
                  <Switch checked={settings.enabled} onCheckedChange={(v) => saveSettings({ enabled: v })} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Auto-promote large changes (&gt;50% param delta)</span>
                  <Switch checked={settings.auto_promote} onCheckedChange={(v) => saveSettings({ auto_promote: v })} />
                </div>
                <div className="text-[10px] text-muted-foreground">Max margin loss before blacklist: {settings.max_margin_loss_pct}%</div>
              </div>
            )}

            {/* Active strategy */}
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Current winning strategy</div>
                {active && (
                  <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                    {active.variant_id}
                  </Badge>
                )}
              </div>
              {active ? (
                <>
                  <div className="flex gap-4 text-xs font-mono-data tabular-nums mb-2 flex-wrap">
                    <span>efficiency: <span className="text-emerald-300">{active.efficiency_score != null ? active.efficiency_score.toFixed(2) : "—"}</span></span>
                    <span>velocity: <span className="text-foreground">{active.velocity_gain_pct != null ? `${active.velocity_gain_pct.toFixed(1)}%` : "—"}</span></span>
                    <span>margin loss: <span className="text-foreground">{active.margin_loss_pct != null ? `${active.margin_loss_pct.toFixed(1)}%` : "—"}</span></span>
                    <span>samples: <span className="text-foreground">{active.sample_size ?? 0}</span></span>
                  </div>
                  <button onClick={() => setExpanded((x) => !x)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {expanded ? "Hide parameters" : "View parameters"}
                  </button>
                  {expanded && (
                    <pre className="mt-2 text-[11px] whitespace-pre-wrap text-muted-foreground max-h-48 overflow-auto bg-background/50 p-2 rounded font-mono-data">
                      {JSON.stringify(active.parameters, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No active strategy.</div>
              )}
            </div>

            {/* Recent variants */}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Recent variants</div>
              <div className="rounded-md border border-border overflow-hidden">
                <div className="grid grid-cols-[1fr_70px_70px_70px_60px_100px] gap-2 px-3 py-1.5 border-b border-border bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <span>Variant</span>
                  <span>Efficiency</span>
                  <span>Velocity</span>
                  <span>Margin Δ</span>
                  <span>Samples</span>
                  <span></span>
                </div>
                {recent.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">No experiments yet.</div>
                ) : recent.map((e) => (
                  <div
                    key={e.id}
                    className={cn(
                      "grid grid-cols-[1fr_70px_70px_70px_60px_100px] gap-2 px-3 py-1.5 border-b border-border last:border-0 items-center text-xs",
                      e.is_active && "bg-emerald-500/5",
                      e.blacklisted && "opacity-50",
                    )}
                  >
                    <span className="font-mono-data truncate">{e.variant_id}</span>
                    <span className="font-mono-data tabular-nums">{e.efficiency_score != null ? e.efficiency_score.toFixed(2) : "—"}</span>
                    <span className="font-mono-data tabular-nums">{e.velocity_gain_pct != null ? `${e.velocity_gain_pct.toFixed(0)}%` : "—"}</span>
                    <span className="font-mono-data tabular-nums">{e.margin_loss_pct != null ? `${e.margin_loss_pct.toFixed(0)}%` : "—"}</span>
                    <span className="font-mono-data tabular-nums">{e.sample_size ?? 0}</span>
                    {e.is_active ? (
                      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] justify-self-end">Active</Badge>
                    ) : e.blacklisted ? (
                      <Badge className="bg-red-500/15 text-red-300 border border-red-500/30 text-[10px] justify-self-end">Blacklisted</Badge>
                    ) : e.pending_human_approval ? (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] justify-self-end text-amber-300" onClick={() => makeActive(e.id)}>
                        Approve
                      </Button>
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
                        <span className="uppercase text-[10px] mr-2 text-amber-300">{l.run_type}</span>
                        {new Date(l.run_started_at).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{l.experiments_ran ?? 0}</span>
                        {l.promoted && l.efficiency_improvement_pct != null && (
                          <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                            <TrendingUp className="w-2.5 h-2.5 mr-0.5" />
                            +{(l.efficiency_improvement_pct * 100).toFixed(0)}%
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
