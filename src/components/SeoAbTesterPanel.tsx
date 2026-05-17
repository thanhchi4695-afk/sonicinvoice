import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, FlaskConical, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";

interface Settings {
  user_id: string;
  enabled: boolean;
  auto_promote: boolean;
  min_impressions: number;
  min_ctr_lift: number;
  max_concurrent: number;
  test_window_days: number;
  manual_approval_lift: number;
  excluded_collections: string[];
  gsc_site_url: string | null;
}

interface Experiment {
  id: string;
  collection_handle: string;
  collection_title: string | null;
  variant_id: string;
  is_control: boolean;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  is_winner: boolean;
  parent_experiment_group: string | null;
  seo_title: string | null;
  meta_description: string | null;
  start_date: string | null;
  end_date: string | null;
}

export default function SeoAbTesterPanel() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [{ data: s }, { data: e }] = await Promise.all([
      supabase.from("seo_ab_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("seo_ab_experiments").select("*").order("created_at", { ascending: false }).limit(60),
    ]);

    if (s) setSettings(s as any);
    else {
      // create default row
      const { data: created } = await supabase
        .from("seo_ab_settings")
        .insert({ user_id: user.id })
        .select("*")
        .single();
      setSettings(created as any);
    }
    setExps((e ?? []) as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await supabase.from("seo_ab_settings").update(patch).eq("user_id", settings.user_id);
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("seo-ab-optimizer-run", { body: {} });
      if (error) throw error;
      toast.success("SEO A/B run kicked off");
      await load();
      console.log("seo-ab-run", data);
    } catch (e: any) {
      toast.error(e?.message ?? "Run failed");
    } finally {
      setRunning(false);
    }
  }

  // Group by parent group
  const groups = new Map<string, Experiment[]>();
  for (const e of exps) {
    const k = e.parent_experiment_group ?? e.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <CardTitle>SEO A/B Tester</CardTitle>
          <Badge variant="outline">Phase 3 · Karpathy Loop</Badge>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run now
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !settings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-md bg-muted/30 border">
              <div className="flex items-center justify-between">
                <Label htmlFor="ab-enabled">Autonomous testing</Label>
                <Switch id="ab-enabled" checked={settings.enabled}
                  onCheckedChange={(v) => saveSettings({ enabled: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="ab-auto">Auto-promote winners</Label>
                <Switch id="ab-auto" checked={settings.auto_promote}
                  onCheckedChange={(v) => saveSettings({ auto_promote: v })} />
              </div>
              <div>
                <Label className="text-xs">GSC site URL</Label>
                <Input value={settings.gsc_site_url ?? ""} placeholder="https://yourstore.com/"
                  onBlur={(e) => saveSettings({ gsc_site_url: e.target.value || null })}
                  onChange={(e) => setSettings({ ...settings, gsc_site_url: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Min impressions</Label>
                  <Input type="number" value={settings.min_impressions}
                    onChange={(e) => saveSettings({ min_impressions: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Min CTR lift</Label>
                  <Input type="number" step="0.01" value={settings.min_ctr_lift}
                    onChange={(e) => saveSettings({ min_ctr_lift: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Max concurrent</Label>
                  <Input type="number" value={settings.max_concurrent}
                    onChange={(e) => saveSettings({ max_concurrent: Number(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-muted-foreground tracking-wide flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Experiments ({groups.size})
              </div>
              {groups.size === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                  No experiments yet. Enable autonomous testing or click <strong>Run now</strong>.
                </div>
              )}
              <div className="space-y-2">
                {[...groups.entries()].map(([gid, arms]) => {
                  const control = arms.find((a) => a.is_control) ?? arms[0];
                  const winner = arms.find((a) => a.is_winner);
                  return (
                    <div key={gid} className="border rounded-md p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-sm">
                          {control.collection_title ?? control.collection_handle}
                        </div>
                        <div className="flex gap-2">
                          {winner && <Badge variant="default">Winner: {winner.variant_id}</Badge>}
                          <Badge variant="outline">{control.status}</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {arms.map((a) => (
                          <div key={a.id} className={`text-xs p-2 rounded border ${a.is_winner ? "bg-primary/10 border-primary" : "bg-muted/20"}`}>
                            <div className="font-mono text-[10px] uppercase text-muted-foreground">{a.variant_id}{a.is_control ? " · control" : ""}</div>
                            <div className="truncate" title={a.seo_title ?? ""}>{a.seo_title}</div>
                            <div className="mt-1 grid grid-cols-3 gap-1 text-[11px]">
                              <span>Imp {a.impressions}</span>
                              <span>Clk {a.clicks}</span>
                              <span>CTR {(a.ctr * 100).toFixed(2)}%</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">{a.start_date} → {a.end_date}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
