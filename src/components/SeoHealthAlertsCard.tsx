import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ChevronRight, Loader2, Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface Counts { high: number; medium: number; low: number; total: number; lastScan: string | null }

export default function SeoHealthAlertsCard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState<Counts>({ high: 0, medium: 0, low: 0, total: 0, lastScan: null });

  const load = async () => {
    const { data: alerts } = await supabase
      .from("seo_health_alerts")
      .select("severity, detected_at")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(500);
    const rows = alerts ?? [];
    const high = rows.filter((r: any) => r.severity === "high").length;
    const medium = rows.filter((r: any) => r.severity === "medium").length;
    const low = rows.filter((r: any) => r.severity === "low").length;
    const lastScan = rows[0]?.detected_at ?? null;
    setCounts({ high, medium, low, total: rows.length, lastScan });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      await supabase.functions.invoke("seo-health-scan", { body: {} });
      await load();
    } finally { setScanning(false); }
  };

  const runQuarterlyRefresh = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("seo-quarterly-refresh", { body: { source: "manual" } });
      if (error) throw error;
      toast.success("Quarterly refresh started — collections will re-generate in the background");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Quarterly refresh failed");
    } finally { setRefreshing(false); }
  };

  if (loading) {
    return (
      <Card><CardContent className="py-6 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading SEO health…
      </CardContent></Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className={cn("h-4 w-4", counts.high > 0 ? "text-red-400" : "text-muted-foreground")} />
            <div>
              <div className="text-sm font-semibold">SEO health</div>
              <div className="text-xs text-muted-foreground">
                {counts.lastScan
                  ? `Last issue detected ${formatDistanceToNow(new Date(counts.lastScan), { addSuffix: true })}`
                  : "No issues detected yet"}
              </div>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={runScan} disabled={scanning} className="text-xs">
            {scanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
            Run scan
          </Button>
          <Button size="sm" variant="ghost" onClick={runQuarterlyRefresh} disabled={refreshing} className="text-xs" title="Re-generate all collections — runs automatically every 3 months">
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Quarterly refresh
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <SeverityChip label="High" count={counts.high} cls="bg-red-500/15 border-red-500/40 text-red-300" />
          <SeverityChip label="Medium" count={counts.medium} cls="bg-amber-500/15 border-amber-500/40 text-amber-200" />
          <SeverityChip label="Low" count={counts.low} cls="bg-muted border-border text-muted-foreground" />
        </div>

        {counts.total > 0 && (
          <button
            onClick={() => navigate("/rank?alert=open")}
            className="w-full flex items-center justify-between text-xs px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
          >
            <span>{counts.total} open issue{counts.total === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1 text-primary">View issues <ChevronRight className="h-3 w-3" /></span>
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function SeverityChip({ label, count, cls }: { label: string; count: number; cls: string }) {
  return (
    <div className={cn("rounded-md border px-2 py-2 text-center", cls)}>
      <div className="font-mono-data tabular-nums text-lg font-semibold leading-none">{count}</div>
      <div className="text-[10px] uppercase tracking-wide mt-1 opacity-80">{label}</div>
    </div>
  );
}
