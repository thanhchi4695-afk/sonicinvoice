import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Wrench, ArrowLeft, RefreshCw, Search, Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import RequireAuth from "@/components/RequireAuth";
import { SeoScoreBadge } from "@/components/SeoScoreBadge";
import { actionKind, gapCount, ringClasses } from "@/lib/seo-score";
import { cn } from "@/lib/utils";
import CollectionGeoDialog from "@/components/CollectionGeoDialog";

interface Row {
  id: string;
  suggested_title: string;
  shopify_handle: string | null;
  status: string;
  product_count: number;
  collection_type: string;
  completeness_score: number | null;
  completeness_breakdown: unknown;
  geo_ready: boolean | null;
  geo_status: "draft" | "approved" | "published" | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  content_ready: { label: "Content ready", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  published: { label: "Live", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  error: { label: "Error", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
};

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: "red" | "green" | "amber" }) {
  const accentCls = accent === "red" ? "text-red-300"
                  : accent === "green" ? "text-emerald-300"
                  : accent === "amber" ? "text-amber-300"
                  : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-2xl font-semibold font-mono-data tabular-nums", accentCls)}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}

function SonicRankInner() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [geoDialogId, setGeoDialogId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("collection_suggestions")
      .select("id, suggested_title, shopify_handle, status, product_count, collection_type, completeness_score, completeness_breakdown, geo_ready, collection_geo_blocks(status)")
      .neq("status", "rejected")
      .order("completeness_score", { ascending: true })
      .limit(500);
    if (error) toast.error(error.message);
    const mapped = (data ?? []).map((r: any) => ({
      ...r,
      geo_status: r.collection_geo_blocks?.[0]?.status ?? null,
    })) as Row[];
    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runAudit() {
    setAuditing(true);
    try {
      const { data, error } = await supabase.functions.invoke("collection-intelligence", { body: { triggered_by: "sonic_rank_audit" } });
      if (error) throw error;
      toast.success(`Audit complete — ${data?.suggestions_created ?? 0} suggestions from ${data?.products_scanned ?? 0} products`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setAuditing(false);
    }
  }

  async function generate(id: string) {
    setGenerating(id);
    try {
      // Re-routed from collection-content-generator to seo-collection-engine (canonical).
      const { data, error } = await supabase.functions.invoke("seo-collection-engine", { body: { suggestion_id: id } });
      if (error) throw error;
      if ((data as any)?.ok) toast.success("Content generated");
      else toast.error((data as any)?.error ?? "Generation failed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(null);
    }
  }

  const stats = useMemo(() => {
    const total = rows.length;
    const needAttention = rows.filter((r) => (r.completeness_score ?? 0) < 70).length;
    const optimised = rows.filter((r) => (r.completeness_score ?? 0) >= 100).length;
    const avg = total ? Math.round(rows.reduce((s, r) => s + (r.completeness_score ?? 0), 0) / total) : 0;
    return { total, needAttention, optimised, avg };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.suggested_title.toLowerCase().includes(q) ||
      (r.shopify_handle ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
          <h1 className="text-3xl font-bold font-display tracking-tight">Sonic Rank</h1>
          <p className="text-sm text-muted-foreground">SEO health across all collections</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
          <Button onClick={runAudit} disabled={auditing}>
            {auditing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Run SEO audit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total collections" value={stats.total} />
        <StatCard label="Need attention" value={stats.needAttention} accent={stats.needAttention > 0 ? "red" : undefined} />
        <StatCard label="Fully optimised" value={stats.optimised} accent={stats.optimised > 0 ? "green" : undefined} />
        <StatCard label="Avg SEO score" value={stats.avg} accent={stats.avg < 50 ? "amber" : stats.avg >= 70 ? "green" : undefined} />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collections by title or handle…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {rows.length === 0 ? "No collections yet. Run an SEO audit to get started." : "No matches."}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid grid-cols-[1fr_140px_120px_140px] gap-3 px-4 py-2 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              <span>Collection</span>
              <span>Score</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {filtered.map((r) => {
              const score = r.completeness_score ?? 0;
              const kind = actionKind(score);
              const gaps = gapCount(r.completeness_breakdown);
              const status = STATUS_LABEL[r.status] ?? { label: r.status, cls: "bg-muted text-muted-foreground border-border" };
              const isGenerating = generating === r.id;
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_140px] gap-3 px-4 py-3 border-b border-border last:border-0 items-center hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">/{r.shopify_handle || r.suggested_title.toLowerCase().replace(/\s+/g, "-")}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.product_count} product{r.product_count === 1 ? "" : "s"} · {r.collection_type.replace("_", "+")}
                      {kind === "generate" && " · no content"}
                      {kind === "fix" && ` · ${gaps} gap${gaps === 1 ? "" : "s"}`}
                      {kind === "complete" && " · complete"}
                    </div>
                  </div>
                  <SeoScoreBadge score={score} breakdown={r.completeness_breakdown} size="sm" showHint={false} />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge className={`${status.cls} border`}>{status.label}</Badge>
                    {r.geo_ready && (
                      <Badge className="bg-violet-500/15 text-violet-300 border border-violet-500/30 text-[10px]">
                        <Bot className="w-2.5 h-2.5 mr-0.5" /> GEO ready
                      </Badge>
                    )}
                    {!r.geo_ready && r.geo_status === "draft" && (
                      <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">GEO pending</Badge>
                    )}
                    {!r.geo_ready && r.geo_status === "approved" && (
                      <Badge className="bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px]">GEO approved</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {kind === "generate" && (
                      <Button size="sm" variant="secondary" onClick={() => generate(r.id)} disabled={isGenerating} className="flex-1 md:flex-none">
                        {isGenerating ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
                        Generate SEO
                      </Button>
                    )}
                    {kind === "fix" && (
                      <Button size="sm" variant="outline" onClick={() => navigate("/collections")} className="flex-1 md:flex-none">
                        <Wrench className="mr-2 h-3 w-3" /> Fix {gaps}
                      </Button>
                    )}
                    {kind === "complete" && !r.geo_status && (
                      <span className="text-xs text-muted-foreground">Complete</span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setGeoDialogId(r.id)} title="Open GEO panel">
                      <Bot className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <CollectionGeoDialog
        suggestionId={geoDialogId}
        open={!!geoDialogId}
        onClose={() => setGeoDialogId(null)}
        onChanged={load}
      />
    </div>
  );
}

export default function SonicRankPage() {
  return (
    <RequireAuth>
      <SonicRankInner />
    </RequireAuth>
  );
}
