import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Sparkles, Search, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getPhase, type LifecyclePhase } from "@/lib/pricing/lifecycleEngine";
import { getVelocityMap } from "@/lib/pricing/salesVelocity";
import PricingRecommendationModal, {
  type PricingProduct,
} from "./PricingRecommendationModal";

interface Row {
  id: string;
  product_id: string;
  title: string;
  vendor: string | null;
  sku: string | null;
  cost: number;
  retail_price: number;
  quantity: number;
  created_at: string;
  daysInInventory: number;
  phase: LifecyclePhase;
  avgWeeklySales?: number;
}

const PHASE_TONE: Record<LifecyclePhase, string> = {
  1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  3: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  4: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  5: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const PHASE_LABELS: Record<LifecyclePhase, string> = {
  1: "Launch",
  2: "First Mark",
  3: "Performance",
  4: "Clearance",
  5: "Cleanse",
};

export default function PricingAssistantPanel({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<LifecyclePhase | "all">("all");
  const [selected, setSelected] = useState<PricingProduct | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("variants")
        .select(
          "id, product_id, sku, cost, retail_price, quantity, created_at, products(title, vendor, created_at)",
        )
        .eq("user_id", user.id)
        .not("cost", "is", null)
        .not("retail_price", "is", null)
        .gt("quantity", 0)
        .limit(500);

      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Failed to load products");
        setLoading(false);
        return;
      }

      const now = Date.now();
      const built: Row[] = (data || []).map((v: any) => {
        const productCreated = v.products?.created_at ?? v.created_at;
        const days = Math.max(
          0,
          Math.floor((now - new Date(productCreated).getTime()) / (1000 * 60 * 60 * 24)),
        );
        return {
          id: v.id,
          product_id: v.product_id,
          title: v.products?.title || v.sku || "Untitled",
          vendor: v.products?.vendor ?? null,
          sku: v.sku,
          cost: Number(v.cost),
          retail_price: Number(v.retail_price),
          quantity: Number(v.quantity) || 0,
          created_at: productCreated,
          daysInInventory: days,
          phase: getPhase(days),
        };
      });

      // Bulk-fetch real velocity from sales_data (last 30d)
      const velocityMap = await getVelocityMap(built.map((r) => r.id));
      const enriched = built.map((r) => ({
        ...r,
        avgWeeklySales: velocityMap[r.id]?.hasData
          ? velocityMap[r.id].avgWeeklySales
          : undefined,
      }));
      setRows(enriched);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (phaseFilter !== "all" && r.phase !== phaseFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.sku || "").toLowerCase().includes(q) ||
        (r.vendor || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, phaseFilter]);

  const phaseCounts = useMemo(() => {
    const c: Record<LifecyclePhase, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rows.forEach((r) => (c[r.phase] += 1));
    return c;
  }, [rows]);

  const openRecommendation = (r: Row) => {
    setSelected({
      id: r.id,
      title: r.title,
      sku: r.sku,
      vendor: r.vendor,
      currentPrice: r.retail_price,
      unitCost: r.cost,
      stockOnHand: r.quantity,
      daysInInventory: r.daysInInventory,
      avgWeeklySales: r.avgWeeklySales,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-400" />
          <h1 className="text-2xl font-semibold tracking-tight">Pricing Assistant</h1>
          <Badge variant="outline" className="ml-2">MVP · Recommendations only</Badge>
        </div>
        <div className="w-20" />
      </div>

      <p className="text-sm text-muted-foreground max-w-3xl">
        Lifecycle-aware markdown recommendations. Pick a product to see its phase, suggested
        price, competitor gap, and a what-if simulator. Nothing is applied to Shopify until you
        click <strong>Apply discount</strong>.
      </p>

      {/* Phase summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([1, 2, 3, 4, 5] as LifecyclePhase[]).map((p) => (
          <button
            key={p}
            onClick={() => setPhaseFilter(phaseFilter === p ? "all" : p)}
            className={`rounded-lg border p-3 text-left transition ${PHASE_TONE[p]} ${
              phaseFilter === p ? "ring-2 ring-offset-2 ring-offset-background ring-current" : ""
            }`}
          >
            <div className="text-xs uppercase tracking-wide opacity-80">Phase {p}</div>
            <div className="text-sm font-medium">{PHASE_LABELS[p]}</div>
            <div className="text-2xl font-semibold tabular-nums">{phaseCounts[p]}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Catalog ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2 w-full max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title, SKU, or vendor"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading catalog…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No products match. Try clearing the filter, or sync your Shopify catalog first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2">Product</th>
                    <th className="text-left px-4 py-2">Vendor</th>
                    <th className="text-right px-4 py-2">Days</th>
                    <th className="text-left px-4 py-2">Phase</th>
                    <th className="text-right px-4 py-2">Price</th>
                    <th className="text-right px-4 py-2">Cost</th>
                    <th className="text-right px-4 py-2">Stock</th>
                    <th className="text-right px-4 py-2" title="Avg units sold per week, last 30 days">Avg/wk</th>
                    <th className="text-right px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 250).map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-b ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                      style={{ height: 32 }}
                    >
                      <td className="px-4 py-1 font-medium truncate max-w-[260px]">
                        {r.title}
                        {r.sku && <span className="ml-2 text-xs text-muted-foreground font-mono">{r.sku}</span>}
                      </td>
                      <td className="px-4 py-1 text-muted-foreground">{r.vendor ?? "—"}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{r.daysInInventory}</td>
                      <td className="px-4 py-1">
                        <Badge variant="outline" className={PHASE_TONE[r.phase]}>
                          {PHASE_LABELS[r.phase]}
                        </Badge>
                      </td>
                      <td className="px-4 py-1 text-right tabular-nums">${r.retail_price.toFixed(2)}</td>
                      <td className="px-4 py-1 text-right tabular-nums text-muted-foreground">${r.cost.toFixed(2)}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-4 py-1 text-right tabular-nums">
                        {r.avgWeeklySales != null
                          ? r.avgWeeklySales.toFixed(1)
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-1 text-right">
                        <Button size="sm" variant="secondary" onClick={() => openRecommendation(r)}>
                          <TrendingDown className="h-3.5 w-3.5 mr-1" />
                          Get Recommendation
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 250 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t">
                  Showing first 250 of {filtered.length}. Refine with search to see more.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <PricingRecommendationModal
          product={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
