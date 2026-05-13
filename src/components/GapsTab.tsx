import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ExternalLink, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Gap = {
  id: string;
  competitor_name: string;
  competitor_url: string;
  gap_type: string;
  brand: string | null;
  product_count_in_store: number;
  suggested_handle: string;
  suggested_title: string;
  smart_rule_column: string | null;
  smart_rule_relation: string | null;
  smart_rule_condition: string | null;
  competitor_framing: string;
  expected_impact: "high" | "medium" | "low" | string;
  status: string;
  shopify_collection_id: string | null;
  created_at: string;
};

type Run = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  current_step: string | null;
  gaps_found: number;
  competitor_stores_checked: number;
  vertical: string | null;
  error_message: string | null;
};

const IMPACT_STYLE: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function GapsTab() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  async function load() {
    const [{ data: g }, { data: r }] = await Promise.all([
      supabase.from("competitor_gaps")
        .select("*")
        .neq("status", "dismissed")
        .order("created_at", { ascending: false }),
      supabase.from("gap_analysis_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);
    setGaps((g as Gap[]) ?? []);
    setRun(((r ?? [])[0] as Run) ?? null);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Poll while a run is active
  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [run?.status]);

  async function startRun() {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("competitor-gap-agent", { body: {} });
      if (error) throw error;
      if (data?.status === "already_running") toast.info("Analysis already in progress");
      else toast.success("Competitor gap analysis started — this takes 1–3 minutes");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start gap analysis");
    } finally {
      setStarting(false);
    }
  }

  async function dismiss(id: string) {
    setActing(id);
    await supabase.from("competitor_gaps").update({ status: "dismissed" }).eq("id", id);
    setActing(null);
    setGaps((g) => g.filter((x) => x.id !== id));
  }

  async function createCollection(g: Gap) {
    setActing(g.id);
    try {
      // Create a suggestion row; reuse existing publish + content-generator pipeline
      const { data: sugg, error: sErr } = await supabase
        .from("collection_suggestions")
        .insert({
          collection_type: g.gap_type === "brand_type" ? "brand" : g.gap_type,
          suggested_title: g.suggested_title,
          suggested_handle: g.suggested_handle,
          product_count: g.product_count_in_store,
          confidence_score: 0.9,
          rule_set: {
            applied_disjunctively: false,
            rules: [{
              column: g.smart_rule_column ?? "vendor",
              relation: g.smart_rule_relation ?? "equals",
              condition: g.smart_rule_condition ?? g.brand ?? "",
            }],
          },
          status: "pending",
        } as never)
        .select("id")
        .single();
      if (sErr) throw sErr;

      // Generate content + publish (re-uses the existing pattern from /collections)
      await supabase.functions.invoke("collection-content-generator", { body: { suggestion_id: sugg.id } });
      const { data: pub, error: pErr } = await supabase.functions.invoke("collection-publish", { body: { suggestion_id: sugg.id } });
      if (pErr) throw pErr;

      await supabase.from("competitor_gaps").update({
        status: "created",
        shopify_collection_id: pub?.shopify_collection_id ?? null,
      }).eq("id", g.id);

      toast.success(`Created "${g.suggested_title}" as a draft in Shopify`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setActing(null);
    }
  }

  const sorted = [...gaps].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return (order[a.expected_impact] ?? 9) - (order[b.expected_impact] ?? 9);
  });

  const isRunning = run?.status === "running";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Competitor gap analysis</div>
            <div className="text-muted-foreground text-xs">
              {isRunning
                ? <>Running… <span className="text-foreground">{run?.current_step ?? "starting"}</span></>
                : run
                  ? <>Last run {timeAgo(run.completed_at ?? run.started_at)} — {run.gaps_found} gaps from {run.competitor_stores_checked} competitor{run.competitor_stores_checked === 1 ? "" : "s"}{run.vertical ? ` (${run.vertical})` : ""}</>
                  : "No analysis yet"}
              {run?.status === "failed" && run.error_message && (
                <span className="text-destructive ml-2">— {run.error_message}</span>
              )}
            </div>
          </div>
          <Button onClick={startRun} disabled={starting || isRunning}>
            {starting || isRunning
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analysing…</>
              : <><Sparkles className="mr-2 h-4 w-4" /> Run Competitor Gap Analysis</>}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No gaps yet. Run an analysis to compare your store against the leading retailers in your vertical.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Badge className={`${IMPACT_STYLE[g.expected_impact] ?? IMPACT_STYLE.low} border uppercase text-[10px]`}>
                    {g.expected_impact}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{g.competitor_name}</Badge>
                </div>
                <div className="text-sm font-semibold leading-tight">
                  {g.competitor_name} has this — you don't
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{g.competitor_framing}</p>
                <a
                  href={g.competitor_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline break-all"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" /> {g.competitor_url}
                </a>
                <div className="text-xs space-y-1 pt-2 border-t border-border/40">
                  <div><span className="text-muted-foreground">Suggested:</span> <span className="font-medium">{g.suggested_title}</span></div>
                  <div className="font-mono text-[10px] text-muted-foreground">/collections/{g.suggested_handle}</div>
                  {g.smart_rule_column && (
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {g.smart_rule_column} {g.smart_rule_relation} "{g.smart_rule_condition}"
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  {g.status === "created" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Created
                    </Badge>
                  ) : (
                    <>
                      <Button size="sm" disabled={acting === g.id} onClick={() => createCollection(g)}>
                        {acting === g.id
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Create collection
                      </Button>
                      <Button size="sm" variant="ghost" disabled={acting === g.id} onClick={() => dismiss(g.id)}>
                        <X className="h-4 w-4" /> Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
