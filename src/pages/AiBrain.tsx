import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Brain, Loader2, Sparkles, AlertTriangle, TrendingUp, Check, X, ShieldCheck, History } from "lucide-react";

type Weight = { metric_name: string; weight: number; sample_size: number };
type Hypothesis = {
  id: string; hypothesis_type: string; target_id: string; target_label: string | null;
  current_value: string | null; proposed_value: string | null; reasoning: string | null;
  expected_impact_pct: number; confidence: number; status: string; auto_created: boolean;
  created_at: string;
};
type Resolution = {
  id: string; target_id: string; conflict_summary: string | null;
  resolution_action: string; net_impact_score: number | null; created_at: string;
};
type RunLog = {
  id: string; started_at: string; completed_at: string | null;
  signals_collected: number; conflicts_resolved: number;
  hypotheses_generated: number; auto_tests_created: number; error_message: string | null;
};
type AuditRow = {
  id: string; hypothesis_id: string; action: string; actor: string;
  reason: string | null; snapshot: any; created_at: string;
};

const METRIC_LABELS: Record<string, string> = {
  ctr: "CTR (search clicks)",
  approval_rate: "Approval rate (content)",
  velocity_gain: "Velocity gain (discount)",
  margin_preservation: "Margin preservation",
};

export default function AiBrain() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    autonomous_enabled: false,
    max_concurrent_auto_tests: 3,
    auto_rollback_enabled: true,
    min_confidence_for_auto: 0.9,
    revenue_drop_floor_pct: 0.05,
    notify_email: true,
  });

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const [w, h, r, l, s, a] = await Promise.all([
      supabase.from("business_impact_weights").select("*").eq("user_id", user.id),
      supabase.from("auto_test_hypotheses").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("cross_loop_resolutions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("cross_loop_run_log").select("*").eq("user_id", user.id).order("started_at", { ascending: false }).limit(10),
      supabase.from("ai_brain_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("auto_test_audit").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    setWeights((w.data ?? []) as Weight[]);
    setHypotheses((h.data ?? []) as Hypothesis[]);
    setResolutions((r.data ?? []) as Resolution[]);
    setRuns((l.data ?? []) as RunLog[]);
    setAudit((a.data ?? []) as AuditRow[]);
    if (s.data) setSettings({ ...settings, ...s.data });
    setLoading(false);
  };

  const respond = async (hypothesisId: string, action: "approve" | "reject") => {
    setActing(hypothesisId);
    try {
      let reason: string | null = null;
      if (action === "reject") reason = window.prompt("Reason for rejecting (optional)?") ?? null;
      const { error } = await supabase.functions.invoke("ai-brain-approve", {
        body: { hypothesis_id: hypothesisId, action, reason },
      });
      if (error) throw error;
      toast({ title: action === "approve" ? "Approved — deploying test" : "Rejected" });
      await load();
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
    } finally { setActing(null); }
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("ai_brain_settings").upsert({ user_id: user.id, ...settings });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Settings saved" });
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.functions.invoke("cross-loop-orchestrator", { body: { user_id: user?.id } });
      if (error) throw error;
      toast({ title: "Cross-loop run started" });
      await load();
    } catch (e: any) {
      toast({ title: "Run failed", description: e?.message, variant: "destructive" });
    } finally { setRunning(false); }
  };

  const maxWeight = Math.max(0.01, ...weights.map(w => w.weight));

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold font-display">AI Brain</h1>
          <Badge variant="outline">Phase 4 · Karpathy Loop</Badge>
        </div>
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          Run now
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4" /> What's driving revenue for your store
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {weights.length === 0 && <p className="text-sm text-muted-foreground">No data yet. Run the orchestrator to learn weights.</p>}
          {weights.map(w => (
            <div key={w.metric_name} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{METRIC_LABELS[w.metric_name] ?? w.metric_name}</span>
                <span className="font-mono">{(w.weight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-muted rounded overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(w.weight / maxWeight) * 100}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4" /> Conflicts resolved (last runs)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resolutions.length === 0 && <p className="text-sm text-muted-foreground">No conflicts detected yet.</p>}
          <div className="space-y-2">
            {resolutions.map(r => (
              <div key={r.id} className="text-sm border border-border rounded p-2 flex justify-between">
                <div>
                  <div className="font-medium">{r.target_id}</div>
                  <div className="text-muted-foreground text-xs">{r.conflict_summary}</div>
                </div>
                <Badge variant="secondary">{r.resolution_action}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4" /> Awaiting your approval
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            High-confidence hypotheses never deploy automatically. Review the proposed change, then approve or reject — every action is recorded in the audit log below.
          </p>
        </CardHeader>
        <CardContent>
          {hypotheses.filter(h => h.status === "awaiting_approval").length === 0 && (
            <p className="text-sm text-muted-foreground">No tests waiting for approval.</p>
          )}
          <div className="space-y-2">
            {hypotheses.filter(h => h.status === "awaiting_approval").map(h => (
              <div key={h.id} className="border border-primary/40 bg-primary/5 rounded p-3 text-sm">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <div className="flex-1">
                    <div className="font-medium">{h.target_label ?? h.target_id}</div>
                    <div className="text-xs text-muted-foreground mb-1">{h.hypothesis_type}</div>
                    {h.current_value && <div className="text-xs"><span className="text-muted-foreground">Current:</span> <code className="text-[11px]">{h.current_value}</code></div>}
                    {h.proposed_value && <div className="text-xs mt-1"><span className="text-muted-foreground">Propose:</span> <code className="text-[11px]">{h.proposed_value}</code></div>}
                    {h.reasoning && <div className="text-xs text-muted-foreground mt-1">{h.reasoning}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs">conf {(h.confidence * 100).toFixed(0)}%</div>
                    <div className="text-xs text-emerald-600">+{Number(h.expected_impact_pct).toFixed(0)}%</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respond(h.id, "approve")} disabled={acting === h.id}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Approve & deploy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respond(h.id, "reject")} disabled={acting === h.id}>
                    <X className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">All hypotheses & deployed tests</CardTitle></CardHeader>
        <CardContent>
          {hypotheses.filter(h => h.status !== "awaiting_approval").length === 0 && (
            <p className="text-sm text-muted-foreground">No other hypotheses yet.</p>
          )}
          <div className="space-y-2">
            {hypotheses.filter(h => h.status !== "awaiting_approval").map(h => (
              <div key={h.id} className="border border-border rounded p-3 text-sm">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{h.target_label ?? h.target_id}</div>
                    <div className="text-xs text-muted-foreground mb-1">{h.hypothesis_type}</div>
                    {h.proposed_value && <div className="text-xs"><span className="text-muted-foreground">Propose:</span> {h.proposed_value}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={h.status === "testing" ? "default" : h.status === "rejected" ? "destructive" : "outline"}>{h.status}</Badge>
                    <div className="text-xs mt-1">conf {(h.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Autonomous mode</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto">Enable fully autonomous A/B testing</Label>
            <Switch id="auto" checked={settings.autonomous_enabled}
              onCheckedChange={v => setSettings(s => ({ ...s, autonomous_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="rollback">Auto-rollback on negative impact</Label>
            <Switch id="rollback" checked={settings.auto_rollback_enabled}
              onCheckedChange={v => setSettings(s => ({ ...s, auto_rollback_enabled: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Max concurrent tests</Label>
              <Input type="number" min={1} max={10} value={settings.max_concurrent_auto_tests}
                onChange={e => setSettings(s => ({ ...s, max_concurrent_auto_tests: Number(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Min confidence (0-1)</Label>
              <Input type="number" min={0} max={1} step={0.05} value={settings.min_confidence_for_auto}
                onChange={e => setSettings(s => ({ ...s, min_confidence_for_auto: Number(e.target.value) }))} />
            </div>
          </div>
          <Button onClick={saveSettings}>Save settings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent orchestrator runs</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          <div className="space-y-1 text-xs font-mono">
            {runs.map(r => (
              <div key={r.id} className="flex justify-between border-b border-border pb-1">
                <span>{new Date(r.started_at).toLocaleString()}</span>
                <span>signals {r.signals_collected} · conflicts {r.conflicts_resolved} · hyp {r.hypotheses_generated} · auto {r.auto_tests_created}</span>
                {r.error_message && <span className="text-destructive">{r.error_message}</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading && <div className="text-center text-sm text-muted-foreground">Loading…</div>}
    </div>
  );
}
