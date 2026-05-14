import { useEffect, useState } from "react";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface LastScan {
  id: string;
  triggered_by: string | null;
  products_scanned: number | null;
  suggestions_created: number | null;
  archive_candidates: number | null;
  completed_at: string | null;
  started_at: string;
}

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

export default function ScanCollectionsCard() {
  const navigate = useNavigate();
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [geoReadyCount, setGeoReadyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [scanRes, sugRes, geoRes] = await Promise.all([
        supabase.from("collection_scans")
          .select("id, triggered_by, products_scanned, suggestions_created, archive_candidates, completed_at, started_at")
          .eq("user_id", user.id)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("collection_suggestions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "pending"),
        supabase.from("collection_suggestions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("geo_ready", true),
      ]);
      setLastScan((scanRes.data as unknown as LastScan | null) ?? null);
      setPendingCount(sugRes.count ?? 0);
      setGeoReadyCount(geoRes.count ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("collection-intelligence", {
        body: { triggered_by: "manual" },
      });
      if (error) throw error;
      const created = (data as any)?.suggestions_created ?? 0;
      toast.success(`Scan complete — ${created} new suggestion${created === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card className="p-4 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground">Scan for new collections</h3>
              {pendingCount > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5">{pendingCount} pending</Badge>
              )}
              {geoReadyCount > 0 && (
                <Badge className="text-[10px] h-5 bg-violet-500/15 text-violet-300 border border-violet-500/30">{geoReadyCount} GEO ready</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Loading…" : lastScan
                ? `Last scan ${timeAgo(lastScan.completed_at ?? lastScan.started_at)} · ${lastScan.products_scanned ?? 0} products · ${lastScan.suggestions_created ?? 0} suggestions${lastScan.archive_candidates ? ` · ${lastScan.archive_candidates} archive` : ""}`
                : "No scans yet — discover new collections from your catalogue."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={handleScan} disabled={scanning} className="h-8">
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span className="ml-1.5 hidden sm:inline">{scanning ? "Scanning…" : "Scan now"}</span>
          </Button>
          {pendingCount > 0 && (
            <Button size="sm" variant="ghost" className="h-8" onClick={() => navigate("/collections")}>
              Review <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
