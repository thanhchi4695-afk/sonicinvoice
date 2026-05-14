import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { fillColor, ringClasses } from "@/lib/seo-score";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  suggested_title: string;
  shopify_handle: string | null;
  completeness_score: number | null;
  product_count: number;
}

/** Compact SEO health widget for the dashboard. Mini bar chart of the
 *  worst-scoring collections, with a callout for any at zero. */
export default function SeoHealthWidget() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState({ total: 0, zero: 0, avg: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("collection_suggestions")
        .select("id, suggested_title, shopify_handle, completeness_score, product_count, status")
        .neq("status", "rejected")
        .order("completeness_score", { ascending: true })
        .limit(200);
      if (cancelled) return;
      const all = (data ?? []) as Row[];
      const total = all.length;
      const zero = all.filter((r) => (r.completeness_score ?? 0) <= 0).length;
      const avg = total ? Math.round(all.reduce((s, r) => s + (r.completeness_score ?? 0), 0) / total) : 0;
      setStats({ total, zero, avg });
      setRows(all.slice(0, 5));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading SEO health…
        </CardContent>
      </Card>
    );
  }

  if (stats.total === 0) return null;

  const avgRing = ringClasses(stats.avg);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">SEO health</div>
            <div className="text-xs text-muted-foreground">{stats.total} collection{stats.total === 1 ? "" : "s"} · avg {stats.avg}/100</div>
          </div>
          <button
            onClick={() => navigate("/rank")}
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
          >
            View Sonic Rank <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className={cn("h-12 w-12 rounded-full border-2 flex items-center justify-center font-mono-data tabular-nums text-sm font-semibold shrink-0", avgRing.bg, avgRing.text, avgRing.border)}>
            {stats.avg}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {rows.map((r) => {
              const score = r.completeness_score ?? 0;
              return (
                <button
                  key={r.id}
                  onClick={() => navigate("/rank")}
                  className="w-full flex items-center gap-2 group"
                  title={`${r.suggested_title} — ${score}/100`}
                >
                  <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors" style={{ width: 130 }}>
                    /{r.shopify_handle || r.suggested_title.toLowerCase().replace(/\s+/g, "-").slice(0, 24)}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${score}%`, background: fillColor(score) }} />
                  </div>
                  <span className="text-[11px] font-mono-data tabular-nums w-8 text-right text-muted-foreground">{score}</span>
                </button>
              );
            })}
          </div>
        </div>

        {stats.zero > 0 && (
          <button
            onClick={() => navigate("/rank")}
            className="w-full flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 hover:bg-amber-500/15 transition-colors"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">{stats.zero} collection{stats.zero === 1 ? "" : "s"} need SEO content</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
