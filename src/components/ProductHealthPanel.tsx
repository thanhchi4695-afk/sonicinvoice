import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, Package, AlertTriangle, TrendingUp, TrendingDown,
  Loader2, RefreshCw, Filter, Sparkles, Clock, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

// "no_data" = added recently, no sales yet — should NOT be classed as Critical.
type HealthScore = "green" | "amber" | "red" | "no_data";

interface ProductSalesData {
  variantId: string;
  totalSold: number;
  lastSoldAt: string | null;
  totalRevenue: number;
}

interface ScoredProduct {
  variantId: string;
  productId: string;
  productTitle: string;
  vendor: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  cost: number;
  retailPrice: number;
  quantity: number;
  createdAt: string;
  // Computed
  score: HealthScore;
  reasons: string[];
  velocity: number; // units per day (30-day)
  daysInInventory: number;
  daysSinceLastSale: number;
  totalSold: number;
  isDeadStock: boolean;
  marginPct: number;
  stockValue: number;
}

/* ─── Scoring logic ─── */

function scoreProduct(
  variant: {
    variantId: string; productId: string; productTitle: string;
    vendor: string | null; sku: string | null; color: string | null;
    size: string | null; cost: number; retailPrice: number;
    quantity: number; createdAt: string;
  },
  sales: ProductSalesData | undefined,
  deadStockDays: number,
): ScoredProduct {
  const now = Date.now();
  const daysInInventory = Math.floor((now - new Date(variant.createdAt).getTime()) / 86400000);
  const totalSold = sales?.totalSold || 0;
  const lastSoldAt = sales?.lastSoldAt;

  // Real number of days since last sale, or null when there has never been a sale.
  // Never use a sentinel (e.g. 999) — that leaks into the UI as "999+ days".
  const daysSinceLastSale: number | null = lastSoldAt
    ? Math.floor((now - new Date(lastSoldAt).getTime()) / 86400000)
    : null;

  // Velocity: units sold per day over the product's lifetime (capped at 90 days)
  const velocityWindow = Math.min(daysInInventory, 90) || 1;
  const velocity = totalSold / velocityWindow;

  const marginPct = variant.cost > 0 && variant.retailPrice > 0
    ? ((variant.retailPrice - variant.cost) / variant.retailPrice) * 100 : -1;
  const stockValue = variant.quantity * variant.cost;

  // Dead-stock only counts when we have evidence: either a real "last sold" date
  // older than the threshold, OR the product has been live > deadStockDays AND
  // has never made a sale. Brand-new inventory (< deadStockDays old, no sales)
  // is "no_data", never "dead".
  const hasNeverSold = totalSold === 0 && !lastSoldAt;
  const isLongLivedNoSales = hasNeverSold && daysInInventory >= deadStockDays;
  const isDeadStock = variant.quantity > 0 && (
    (daysSinceLastSale !== null && daysSinceLastSale >= deadStockDays) ||
    isLongLivedNoSales
  );

  const reasons: string[] = [];
  let score: HealthScore = "green";

  // ── No-data short-circuit: brand-new variant with no sales yet ──
  if (hasNeverSold && daysInInventory < 30) {
    return {
      ...variant,
      score: "no_data",
      reasons: [`Just added · ${daysInInventory === 0 ? "today" : `${daysInInventory}d ago`} — sales data will appear after first sale`],
      velocity: 0,
      daysInInventory,
      daysSinceLastSale: 0,
      totalSold: 0,
      isDeadStock: false,
      marginPct,
      stockValue,
    };
  }

  // ── RED conditions ──
  if (variant.quantity <= 0 && velocity > 0.1) {
    score = "red";
    reasons.push("Out of stock — losing sales");
  }
  if (isDeadStock) {
    score = "red";
    if (daysSinceLastSale !== null) {
      reasons.push(`No sales in ${daysSinceLastSale} days`);
    } else {
      reasons.push(`No sales yet · added ${daysInInventory}d ago`);
    }
  }

  // ── AMBER conditions ──
  if (velocity > 0 && velocity < 0.1 && variant.quantity > 0) {
    if (score === "green") score = "amber";
    reasons.push(`Slow velocity: ${(velocity * 30).toFixed(1)} units/month`);
  }
  if (variant.quantity > 0 && velocity > 0) {
    const daysOfStock = variant.quantity / velocity;
    if (daysOfStock > 120) {
      if (score === "green") score = "amber";
      reasons.push(`Overstocked: ${Math.round(daysOfStock)} days of supply`);
    }
  }
  if (variant.quantity > 0 && variant.quantity <= 3 && velocity >= 0.1) {
    if (score === "green") score = "amber";
    reasons.push("Low stock — reorder soon");
  }
  if (marginPct >= 0 && marginPct < 30) {
    if (score === "green") score = "amber";
    reasons.push(`Low margin: ${marginPct.toFixed(0)}%`);
  }

  // ── GREEN ──
  if (reasons.length === 0) {
    if (velocity >= 0.3) reasons.push(`Strong seller: ${(velocity * 30).toFixed(0)} units/month`);
    else if (totalSold > 0) reasons.push("Selling steadily");
    else reasons.push(`No sales yet · added ${daysInInventory}d ago`);
  }

  return {
    ...variant, score, reasons, velocity, daysInInventory,
    daysSinceLastSale: daysSinceLastSale ?? 0,
    totalSold, isDeadStock, marginPct, stockValue,
  };
}

/* ─── Helpers ─── */

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/* ─── Component ─── */

interface Props { onBack: () => void; }

export default function ProductHealthPanel({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ScoredProduct[]>([]);
  const [deadStockDays, setDeadStockDays] = useState(60);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [tab, setTab] = useState("all");
  const [scanning, setScanning] = useState(false);
  const [lastScanQueued, setLastScanQueued] = useState(0);
  const navigate = useNavigate();

  const handleGapScan = async () => {
    setScanning(true);
    const toastId = toast.loading(
      "Scanning your Shopify store for products missing images or descriptions...",
    );
    try {
      const { data, error } = await supabase.functions.invoke("gap-scanner", {
        body: { manual: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const newly = data?.newly_queued ?? 0;
      const total = data?.incomplete_found ?? 0;
      setLastScanQueued(newly);
      toast.success(
        `Scan complete — ${newly} products added to enrichment queue. ${total} total need attention.`,
        { id: toastId },
      );
    } catch (e) {
      console.error("[gap-scanner]", e);
      toast.error("Scan failed — check your Shopify connection in Settings.", { id: toastId });
    } finally {
      setScanning(false);
    }
  };

  const fetchAndScore = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [variantsRes, productsRes, salesRes] = await Promise.all([
        supabase.from("variants")
          .select("id, product_id, sku, color, size, cost, retail_price, quantity, created_at")
          .eq("user_id", user.id),
        supabase.from("products")
          .select("id, title, vendor, product_type")
          .eq("user_id", user.id),
        supabase.from("sales_data")
          .select("variant_id, quantity_sold, revenue, sold_at")
          .eq("user_id", user.id),
      ]);

      const productMap = new Map((productsRes.data || []).map(p => [p.id, p]));

      // Aggregate sales per variant
      const salesMap = new Map<string, ProductSalesData>();
      for (const s of (salesRes.data || [])) {
        const existing = salesMap.get(s.variant_id) || {
          variantId: s.variant_id, totalSold: 0, lastSoldAt: null as string | null, totalRevenue: 0,
        };
        existing.totalSold += s.quantity_sold;
        existing.totalRevenue += Number(s.revenue) || 0;
        if (!existing.lastSoldAt || new Date(s.sold_at) > new Date(existing.lastSoldAt)) {
          existing.lastSoldAt = s.sold_at;
        }
        salesMap.set(s.variant_id, existing);
      }

      const scored = (variantsRes.data || []).map(v => {
        const prod = productMap.get(v.product_id);
        return scoreProduct(
          {
            variantId: v.id,
            productId: v.product_id,
            productTitle: prod?.title || "Unknown",
            vendor: prod?.vendor || null,
            sku: v.sku,
            color: v.color,
            size: v.size,
            cost: Number(v.cost) || 0,
            retailPrice: Number(v.retail_price) || 0,
            quantity: v.quantity || 0,
            createdAt: v.created_at,
          },
          salesMap.get(v.id),
          deadStockDays,
        );
      });

      setProducts(scored);
    } catch (e) {
      console.error("Health scoring error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAndScore(); }, [deadStockDays]);

  /* ─── Aggregates ─── */

  const counts = useMemo(() => {
    const green = products.filter(p => p.score === "green").length;
    const amber = products.filter(p => p.score === "amber").length;
    const red = products.filter(p => p.score === "red").length;
    const noData = products.filter(p => p.score === "no_data").length;
    const dead = products.filter(p => p.isDeadStock);
    const deadValue = dead.reduce((s, p) => s + p.stockValue, 0);
    return { green, amber, red, noData, deadCount: dead.length, deadValue, total: products.length };
  }, [products]);

  const vendors = useMemo(() =>
    [...new Set(products.map(p => p.vendor).filter(Boolean))] as string[],
    [products],
  );

  const filtered = useMemo(() => {
    let list = products;
    if (tab === "green") list = list.filter(p => p.score === "green");
    else if (tab === "amber") list = list.filter(p => p.score === "amber");
    else if (tab === "red") list = list.filter(p => p.score === "red");
    else if (tab === "no_data") list = list.filter(p => p.score === "no_data");
    else if (tab === "dead") list = list.filter(p => p.isDeadStock);
    if (vendorFilter) list = list.filter(p => p.vendor === vendorFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.productTitle.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.vendor?.toLowerCase().includes(q),
      );
    }
    // Sort: red first, then amber, then green, then no-data (least urgent)
    const order: Record<HealthScore, number> = { red: 0, amber: 1, green: 2, no_data: 3 };
    return list.sort((a, b) => order[a.score] - order[b.score] || b.stockValue - a.stockValue);
  }, [products, tab, vendorFilter, search]);

  const scoreDot = (score: HealthScore) => (
    <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", {
      "bg-green-500": score === "green",
      "bg-yellow-500": score === "amber",
      "bg-red-500": score === "red",
      "bg-muted-foreground/40": score === "no_data",
    })} />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Product Health Scores
          </h2>
          <p className="text-xs text-muted-foreground">AI-powered inventory health analysis</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGapScan}
          disabled={scanning}
          className="gap-1.5"
        >
          {scanning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Scan for missing content
        </Button>
        <Button variant="ghost" size="sm" onClick={fetchAndScore}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {lastScanQueued > 0 && (
        <Card className="p-3 mb-3 flex items-center justify-between bg-primary/5 border-primary/20">
          <p className="text-xs">
            <span className="font-semibold">{lastScanQueued}</span> products ready for enrichment.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/products/enrichment-queue")}
          >
            Review products ready to enrich →
          </Button>
        </Card>
      )}

      {products.length === 0 ? (
        <Card className="p-8 text-center">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-semibold">No products to score</p>
          <p className="text-xs text-muted-foreground mt-1">
            Import products via invoices or connect your Shopify store first.
          </p>
        </Card>
      ) : (
        <>
          {/* Traffic light summary — 4 tiles, "Awaiting data" is neutral, never alarmist */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <button onClick={() => setTab("green")}
              className={cn("text-center py-3 rounded-lg border transition-colors",
                tab === "green" ? "border-green-500 bg-green-50 dark:bg-green-900/30" : "bg-card border-border")}>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 font-mono">{counts.green}</p>
              <p className="text-[10px] text-green-700 dark:text-green-400">Healthy</p>
            </button>
            <button onClick={() => setTab("amber")}
              className={cn("text-center py-3 rounded-lg border transition-colors",
                tab === "amber" ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/30" : "bg-card border-border")}>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 font-mono">{counts.amber}</p>
              <p className="text-[10px] text-yellow-700 dark:text-yellow-400">Attention</p>
            </button>
            <button onClick={() => setTab("red")}
              className={cn("text-center py-3 rounded-lg border transition-colors",
                tab === "red" ? "border-red-500 bg-red-50 dark:bg-red-900/30" : "bg-card border-border")}>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 font-mono">{counts.red}</p>
              <p className="text-[10px] text-red-700 dark:text-red-400">Critical</p>
            </button>
            <button onClick={() => setTab("no_data")}
              className={cn("text-center py-3 rounded-lg border transition-colors",
                tab === "no_data" ? "border-muted-foreground bg-muted/40" : "bg-card border-border")}>
              <p className="text-2xl font-bold text-muted-foreground font-mono">{counts.noData}</p>
              <p className="text-[10px] text-muted-foreground">Awaiting sales data</p>
            </button>
          </div>

          {/* Dead stock alert — only shown when there's REAL evidence of dead stock,
              never just because everything is brand-new with no sales yet. */}
          {counts.deadCount > 0 && (
            <Card className="p-3 border-l-4 border-l-destructive mb-4">
              <button onClick={() => setTab("dead")} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <div className="text-left">
                    <p className="text-sm font-semibold">{counts.deadCount} dead stock items</p>
                    <p className="text-[10px] text-muted-foreground">{fmt(counts.deadValue)} tied up at cost</p>
                  </div>
                </div>
                <Badge variant="destructive" className="text-[10px]">View</Badge>
              </button>
            </Card>
          )}

          {/* Filters */}
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Search products..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <select
              value={vendorFilter}
              onChange={e => setVendorFilter(e.target.value)}
              className="h-8 text-xs rounded-md border border-input bg-background px-2"
            >
              <option value="">All vendors</option>
              {vendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select
              value={deadStockDays}
              onChange={e => setDeadStockDays(parseInt(e.target.value))}
              className="h-8 text-xs rounded-md border border-input bg-background px-2"
            >
              <option value={30}>30d dead</option>
              <option value={60}>60d dead</option>
              <option value={90}>90d dead</option>
              <option value={120}>120d dead</option>
            </select>
          </div>

          {/* Tab bar */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full mb-3">
              <TabsTrigger value="all" className="flex-1 text-xs">All ({counts.total})</TabsTrigger>
              <TabsTrigger value="green" className="flex-1 text-xs">Green</TabsTrigger>
              <TabsTrigger value="amber" className="flex-1 text-xs">Amber</TabsTrigger>
              <TabsTrigger value="red" className="flex-1 text-xs">Red</TabsTrigger>
              <TabsTrigger value="no_data" className="flex-1 text-xs">No data</TabsTrigger>
              <TabsTrigger value="dead" className="flex-1 text-xs">Dead</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Product list */}
          <div className="space-y-2">
            {filtered.length === 0 && (
              <Card className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No products match this filter.</p>
              </Card>
            )}
            {filtered.map(p => (
              <Card key={p.variantId} className="p-3">
                <div className="flex items-start gap-3">
                  {scoreDot(p.score)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.productTitle}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {[p.color, p.size, p.sku, p.vendor].filter(Boolean).join(" • ")}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.reasons.map((r, i) => (
                        <span key={i} className={cn("text-[10px] px-2 py-0.5 rounded-full", {
                          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400": p.score === "green",
                          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400": p.score === "amber",
                          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400": p.score === "red",
                          "bg-muted text-muted-foreground": p.score === "no_data",
                        })}>
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-sm font-mono font-semibold">{p.quantity}</p>
                    <p className="text-[10px] text-muted-foreground">in stock</p>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <BarChart3 className="w-3 h-3" />
                      <span className="font-mono">{(p.velocity * 30).toFixed(1)}/mo</span>
                    </div>
                    {p.marginPct >= 0 && (
                      <p className={cn("text-[10px] font-mono",
                        p.marginPct >= 50 ? "text-green-600" : p.marginPct >= 30 ? "text-yellow-600" : "text-red-600"
                      )}>
                        {p.marginPct.toFixed(0)}% margin
                      </p>
                    )}
                    {p.totalSold > 0 && (
                      <p className="text-[10px] text-muted-foreground">{p.totalSold} sold</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Summary card */}
          <Card className="p-4 mt-4 bg-primary/5 border-primary/20">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" /> Scoring Logic
            </h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">{scoreDot("green")} <strong>Green</strong> — selling well, good stock & margins</p>
              <p className="flex items-center gap-2">{scoreDot("amber")} <strong>Amber</strong> — slow velocity, low stock, low margin, or overstocked</p>
              <p className="flex items-center gap-2">{scoreDot("red")} <strong>Red</strong> — out of stock or no sales in {deadStockDays}+ days</p>
              <p className="mt-1">Based on: sales velocity, stock levels, time in inventory, margin, and last sale date.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
