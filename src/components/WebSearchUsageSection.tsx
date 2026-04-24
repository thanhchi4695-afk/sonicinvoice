import { useEffect, useState } from "react";
import { Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Period = "7d" | "30d" | "month";
type Row = {
  id: number;
  query: string;
  source: string;
  matched_url: string | null;
  cost_aud: number;
  cache_hit: boolean;
  created_at: string;
};

const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
};

function periodStart(p: Period): Date {
  const now = new Date();
  if (p === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  const days = p === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function providerLabel(s: string): string {
  if (s === "anthropic-websearch") return "Anthropic";
  if (s === "brave-search") return "Brave";
  return s;
}

export default function WebSearchUsageSection() {
  const [period, setPeriod] = useState<Period>("30d");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const since = periodStart(period).toISOString();
      const { data, error } = await supabase
        .from("websearch_usage_log" as never)
        .select("id, query, source, matched_url, cost_aud, cache_hit, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setRows((data as unknown as Row[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const totalCost = rows.reduce((s, r) => s + Number(r.cost_aud || 0), 0);
  const cacheHits = rows.filter((r) => r.cache_hit).length;
  const liveCalls = rows.length - cacheHits;
  const hitRate = rows.length ? Math.round((cacheHits / rows.length) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold">Recent queries</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI web-search lookups used to enrich invoice line items.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="h-8 rounded-md bg-input border border-border px-2 text-xs"
          >
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-8 px-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Queries</p>
          <p className="text-lg font-semibold font-mono-data">{rows.length}</p>
        </div>
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Live calls</p>
          <p className="text-lg font-semibold font-mono-data">{liveCalls}</p>
        </div>
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cache hit rate</p>
          <p className="text-lg font-semibold font-mono-data">{hitRate}%</p>
        </div>
        <div className="rounded-md border border-border bg-background p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total cost</p>
          <p className="text-lg font-semibold font-mono-data">${totalCost.toFixed(4)}</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Table */}
      {loading && rows.length === 0 ? (
        <div className="py-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No AI web-search queries in {PERIOD_LABEL[period].toLowerCase()}.
        </p>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2.5 py-1.5 font-medium">When</th>
                  <th className="px-2.5 py-1.5 font-medium">Query</th>
                  <th className="px-2.5 py-1.5 font-medium">Provider</th>
                  <th className="px-2.5 py-1.5 font-medium">Cache</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Cost</th>
                  <th className="px-2.5 py-1.5 font-medium">URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap font-mono-data">
                      {new Date(r.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2.5 py-1.5 max-w-[260px] truncate" title={r.query}>
                      {r.query}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{providerLabel(r.source)}</td>
                    <td className="px-2.5 py-1.5">
                      {r.cache_hit ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success border border-success/30">
                          cached
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning border border-warning/30">
                          live
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono-data whitespace-nowrap">
                      ${Number(r.cost_aud || 0).toFixed(4)}
                    </td>
                    <td className="px-2.5 py-1.5 max-w-[220px]">
                      {r.matched_url ? (
                        <a
                          href={r.matched_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full"
                          title={r.matched_url}
                        >
                          <span className="truncate">{r.matched_url.replace(/^https?:\/\//, "")}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Showing up to 100 most recent queries. Cached lookups don't count toward your monthly cap.
      </p>
    </div>
  );
}
