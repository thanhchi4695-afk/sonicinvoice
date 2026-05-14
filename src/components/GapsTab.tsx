import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ExternalLink, X, CheckCircle2, Search } from "lucide-react";
import { toast } from "sonner";
import { ClaudeEmptyState } from "@/components/ClaudeConnectPrompts";

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
  high: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  medium: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

const IMPACT_LABEL: Record<string, string> = {
  high: "HIGH IMPACT",
  medium: "MEDIUM IMPACT",
  low: "LOW IMPACT",
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

interface GapsTabProps {
  onPendingCountChange?: (count: number) => void;
}

export default function GapsTab({ onPendingCountChange }: GapsTabProps) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  async function load() {
    const [{ data: g }, { data: r }] = await Promise.all([
      supabase.from("competitor_gaps")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("gap_analysis_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);
    const allGaps = (g as Gap[]) ?? [];
    setGaps(allGaps);
    setRun(((r ?? [])[0] as Run) ?? null);
    setLoading(false);
    onPendingCountChange?.(allGaps.filter((x) => x.status === "pending").length);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Poll every 3s while a run is active
  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setGaps((arr) => {
      const next = arr.map((x) => (x.id === id ? { ...x, status: "dismissed" } : x));
      onPendingCountChange?.(next.filter((x) => x.status === "pending").length);
      return next;
    });
  }

  async function createCollection(g: Gap) {
    setActing(g.id);
    try {
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
            rules: g.smart_rule_column && g.smart_rule_relation && g.smart_rule_condition
              ? [{
                  column: g.smart_rule_column,
                  relation: g.smart_rule_relation,
                  condition: g.smart_rule_condition,
                }]
              : [],
          },
          status: "pending",
        } as never)
        .select("id")
        .single();
      if (sErr) throw sErr;

      // Re-routed from collection-content-generator to seo-collection-engine (canonical).
      await supabase.functions.invoke("seo-collection-engine", { body: { suggestion_id: sugg.id } });
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

  const visibleGaps = useMemo(() => {
    const visible = gaps.filter((g) => showDismissed || g.status !== "dismissed");
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    return [...visible].sort((a, b) => {
      const oi = (order[a.expected_impact] ?? 9) - (order[b.expected_impact] ?? 9);
      if (oi !== 0) return oi;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [gaps, showDismissed]);

  const groupedByCompetitor = useMemo(() => {
    const groups = new Map<string, Gap[]>();
    for (const g of visibleGaps) {
      const arr = groups.get(g.competitor_name) ?? [];
      arr.push(g);
      groups.set(g.competitor_name, arr);
    }
    return Array.from(groups.entries());
  }, [visibleGaps]);

  const competitorCount = useMemo(
    () => new Set(gaps.map((g) => g.competitor_name)).size,
    [gaps]
  );

  const isRunning = run?.status === "running";
  const dismissedCount = gaps.filter((g) => g.status === "dismissed").length;
  const pendingCount = gaps.filter((g) => g.status === "pending").length;
  const allResolved = gaps.length > 0 && pendingCount === 0;

  // ----- empty states -----
  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!run && gaps.length === 0) {
    return (
      <div className="space-y-4">
        <ClaudeEmptyState
          heading="No gaps found yet"
          subheading="Run a competitor gap analysis, or ask Claude to surface SEO collection opportunities your competitors carry."
          prompts={[
            "What competitor collections am I missing?",
            "Which brands do my competitors stock that I don't?",
            "Find me 5 high-impact SEO gaps to fix this week",
          ]}
        />
        <div className="flex justify-center">
          <Button onClick={startRun} disabled={starting} variant="outline">
            {starting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</>
              : <><Sparkles className="mr-2 h-4 w-4" /> Or run automated gap analysis</>}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header / control bar */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm min-w-0 flex-1">
            {isRunning ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {run?.current_step ?? "Searching…"}
                  </div>
                  <div className="text-xs text-muted-foreground">Estimated 2–3 min</div>
                </div>
              </div>
            ) : (
              <>
                <div className="font-medium">Competitor gap analysis</div>
                <div className="text-muted-foreground text-xs">
                  {run
                    ? <>Last analysed {timeAgo(run.completed_at ?? run.started_at)} — {run.gaps_found} gaps from {run.competitor_stores_checked} competitor{run.competitor_stores_checked === 1 ? "" : "s"}{run.vertical ? ` (${run.vertical})` : ""}</>
                    : "No analysis yet"}
                  {run?.status === "failed" && run.error_message && (
                    <span className="text-destructive ml-2">— {run.error_message}</span>
                  )}
                </div>
              </>
            )}
          </div>
          {!isRunning && (
            <Button onClick={startRun} disabled={starting}>
              {starting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</>
                : <><Sparkles className="mr-2 h-4 w-4" /> Run Competitor Gap Analysis</>}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* All resolved state */}
      {allResolved && !isRunning && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            All gaps resolved — run a new analysis to check for more.
          </CardContent>
        </Card>
      )}

      {/* Gap groups */}
      {groupedByCompetitor.map(([competitor, items]) => (
        <div key={competitor} className="space-y-3">
          {competitorCount > 1 && (
            <h3 className="text-sm font-semibold text-foreground/90 px-1">
              {competitor} <span className="text-muted-foreground font-normal">({items.length} gap{items.length === 1 ? "" : "s"})</span>
            </h3>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((g) => (
              <Card key={g.id} className={`overflow-hidden ${g.status === "dismissed" ? "opacity-50" : ""}`}>
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Badge className={`${IMPACT_STYLE[g.expected_impact] ?? IMPACT_STYLE.low} border uppercase text-[10px]`}>
                      {IMPACT_LABEL[g.expected_impact] ?? g.expected_impact}
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
                    {g.smart_rule_column && g.smart_rule_relation && g.smart_rule_condition && (
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
                    ) : g.status === "dismissed" ? (
                      <Badge variant="outline" className="text-[10px]">Dismissed</Badge>
                    ) : (
                      <>
                        <Button size="sm" disabled={acting === g.id} onClick={() => createCollection(g)}>
                          {acting === g.id
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</>
                            : <><CheckCircle2 className="mr-2 h-4 w-4" /> Create collection</>}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={acting === g.id} onClick={() => dismiss(g.id)}>
                          <X className="h-4 w-4 mr-1" /> Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Show dismissed toggle */}
      {dismissedCount > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide" : "Show"} dismissed ({dismissedCount})
          </Button>
        </div>
      )}
    </div>
  );
}
