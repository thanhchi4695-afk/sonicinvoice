import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Plus, Trash2, Search, RefreshCw, Download, ExternalLink,
  TrendingUp, TrendingDown, Minus, AlertTriangle, Eye, DollarSign,
  Loader2, CheckCircle2, XCircle, HelpCircle, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { addAuditEntry } from "@/lib/audit-log";
import { formatRelativeTime } from "@/lib/audit-log";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

/* ─── Types ─── */

interface Competitor {
  id: string;
  name: string;
  website_url: string;
  is_shopify: boolean;
  is_active: boolean;
}

interface MonitoredProduct {
  id: string;
  product_title: string;
  product_vendor: string | null;
  product_type: string | null;
  product_sku: string | null;
  retail_price: number;
  product_id: string | null;
}

interface CompetitorPrice {
  id: string;
  monitored_product_id: string;
  competitor_id: string;
  matched_title: string | null;
  matched_url: string | null;
  competitor_price: number | null;
  confidence_score: number;
  match_status: string;
  error_message: string | null;
  last_checked: string;
}

interface PriceRow {
  product: MonitoredProduct;
  prices: Record<string, CompetitorPrice>;
}

type Tab = "dashboard" | "competitors" | "products";
type MatchMethod = "match" | "beat_dollar" | "beat_percent";

/* ─── Component ─── */

export default function CompetitorPriceMonitor({ onBack }: { onBack: () => void }) {
  const confirmDialog = useConfirmDialog();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [products, setProducts] = useState<MonitoredProduct[]>([]);
  const [prices, setPrices] = useState<CompetitorPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Price match modal
  const [matchModal, setMatchModal] = useState<{
    product: MonitoredProduct;
    competitorPrice: CompetitorPrice;
    competitor: Competitor;
  } | null>(null);
  const [matchMethod, setMatchMethod] = useState<MatchMethod>("match");
  const [beatAmount, setBeatAmount] = useState(0);
  const [updatingPrice, setUpdatingPrice] = useState(false);

  // Bulk match modal
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkMethod, setBulkMethod] = useState<MatchMethod>("beat_percent");
  const [bulkAmount, setBulkAmount] = useState(5);

  // Add competitor modal
  const [addCompModal, setAddCompModal] = useState(false);
  const [newComp, setNewComp] = useState({ name: "", website_url: "" });

  // Add product modal
  const [addProdModal, setAddProdModal] = useState(false);
  const [prodSearch, setProdSearch] = useState("");
  const [shopifyProducts, setShopifyProducts] = useState<any[]>([]);
  const [loadingShopify, setLoadingShopify] = useState(false);

  /* ─── Data Loading ─── */

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [compRes, prodRes, priceRes] = await Promise.all([
      supabase.from("competitors").select("*").eq("user_id", user.id).order("name"),
      supabase.from("competitor_monitored_products").select("*").eq("user_id", user.id).order("product_title"),
      supabase.from("competitor_prices").select("*").eq("user_id", user.id),
    ]);

    setCompetitors((compRes.data as any[]) || []);
    setProducts((prodRes.data as any[]) || []);
    setPrices((priceRes.data as any[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ─── Computed Data ─── */

  const priceRows: PriceRow[] = useMemo(() => {
    return products
      .filter(p => !search || p.product_title.toLowerCase().includes(search.toLowerCase()))
      .map(product => {
        const productPrices: Record<string, CompetitorPrice> = {};
        prices.filter(pr => pr.monitored_product_id === product.id).forEach(pr => {
          productPrices[pr.competitor_id] = pr;
        });
        return { product, prices: productPrices };
      });
  }, [products, prices, search]);

  const stats = useMemo(() => {
    const matched = prices.filter(p => p.match_status === "matched");
    const cheaper = matched.filter(p => p.competitor_price !== null && products.find(mp => mp.id === p.monitored_product_id)?.retail_price! < p.competitor_price!);
    const expensive = matched.filter(p => p.competitor_price !== null && products.find(mp => mp.id === p.monitored_product_id)?.retail_price! > p.competitor_price!);
    return { total: prices.length, matched: matched.length, cheaper: cheaper.length, expensive: expensive.length };
  }, [prices, products]);

  /* ─── Actions ─── */

  const addCompetitor = async () => {
    if (!newComp.name || !newComp.website_url) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let url = newComp.website_url.trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    url = url.replace(/\/+$/, "");

    const { error } = await supabase.from("competitors").insert({
      user_id: user.id,
      name: newComp.name.trim(),
      website_url: url,
      is_shopify: true,
    });

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    addAuditEntry("Competitor Added", `Added competitor: ${newComp.name}`);
    toast({ title: "Competitor added" });
    setNewComp({ name: "", website_url: "" });
    setAddCompModal(false);
    loadData();
  };

  const removeCompetitor = async (id: string) => {
    await supabase.from("competitors").delete().eq("id", id);
    loadData();
  };

  const addProductsFromShopify = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setLoadingShopify(true);

    const { data: conn } = await supabase.from("shopify_connections").select("*").eq("user_id", user.id).maybeSingle();
    if (!conn) {
      toast({ title: "No Shopify connection", description: "Connect your Shopify store first", variant: "destructive" });
      setLoadingShopify(false);
      return;
    }

    // Fetch from local products table
    const { data: localProducts } = await supabase
      .from("products")
      .select("id, title, vendor, product_type, shopify_product_id")
      .eq("user_id", user.id)
      .order("title")
      .limit(200);

    // Also get variants for pricing
    const productIds = (localProducts || []).map(p => p.id);
    const { data: variants } = await supabase
      .from("variants")
      .select("product_id, retail_price, sku")
      .in("product_id", productIds.length ? productIds : ["none"]);

    const enriched = (localProducts || []).map(p => {
      const v = (variants || []).find(v => v.product_id === p.id);
      return {
        ...p,
        retail_price: v?.retail_price || 0,
        sku: v?.sku || null,
      };
    });

    setShopifyProducts(enriched);
    setLoadingShopify(false);
  };

  const addMonitoredProduct = async (p: any) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if already monitored
    const exists = products.find(mp => mp.product_id === p.id);
    if (exists) { toast({ title: "Already monitored" }); return; }

    await supabase.from("competitor_monitored_products").insert({
      user_id: user.id,
      product_id: p.id,
      product_title: p.title,
      product_vendor: p.vendor,
      product_type: p.product_type,
      product_sku: p.sku,
      shopify_product_id: p.shopify_product_id,
      retail_price: p.retail_price || 0,
    });

    toast({ title: "Product added to monitoring" });
    loadData();
  };

  const removeMonitoredProduct = async (id: string) => {
    await supabase.from("competitor_monitored_products").delete().eq("id", id);
    loadData();
  };

  const fetchPrices = async (competitorId?: string) => {
    setFetching(true);
    const activeComps = competitorId
      ? competitors.filter(c => c.id === competitorId)
      : competitors.filter(c => c.is_active);

    if (!activeComps.length || !products.length) {
      toast({ title: "Nothing to fetch", description: "Add competitors and products first" });
      setFetching(false);
      return;
    }

    const productIds = products.map(p => p.id);
    setFetchProgress({ current: 0, total: activeComps.length });

    for (let i = 0; i < activeComps.length; i++) {
      setFetchProgress({ current: i + 1, total: activeComps.length });
      try {
        const { data, error } = await supabase.functions.invoke("competitor-price-fetch", {
          body: { competitor_id: activeComps[i].id, monitored_product_ids: productIds },
        });
        if (error) console.error(`Fetch error for ${activeComps[i].name}:`, error);
      } catch (e) {
        console.error(`Fetch error for ${activeComps[i].name}:`, e);
      }
      // Delay between competitors
      if (i < activeComps.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    addAuditEntry("Price Check", `Checked ${activeComps.length} competitors for ${products.length} products`);
    toast({ title: "Price check complete" });
    setFetching(false);
    loadData();
  };

  /* ─── Price Match ─── */

  const calculateNewPrice = (competitorPrice: number, method: MatchMethod, amount: number): number => {
    switch (method) {
      case "match": return competitorPrice;
      case "beat_dollar": return Math.max(0, competitorPrice - amount);
      case "beat_percent": return Math.max(0, competitorPrice * (1 - amount / 100));
    }
  };

  const executeMatchPrice = async (product: MonitoredProduct, competitorPrice: CompetitorPrice, competitor: Competitor, method: MatchMethod, amount: number) => {
    if (!competitorPrice.competitor_price) return;
    setUpdatingPrice(true);

    const newPrice = calculateNewPrice(competitorPrice.competitor_price, method, amount);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setUpdatingPrice(false); return; }

    // Check cost safety
    if (product.product_id) {
      const { data: variant } = await supabase.from("variants").select("cost").eq("product_id", product.product_id).maybeSingle();
      if (variant?.cost && newPrice < variant.cost) {
        const proceed = await confirmDialog({
          title: "Price below cost",
          description: `New price $${newPrice.toFixed(2)} is below cost $${variant.cost.toFixed(2)}. You'll lose money on every sale. Proceed anyway?`,
          confirmLabel: "Proceed anyway",
          destructive: true,
        });
        if (!proceed) { setUpdatingPrice(false); return; }
      }
    }

    // Update Shopify if connected
    let shopifyUpdated = false;
    if (product.product_id) {
      const { data: conn } = await supabase.from("shopify_connections").select("store_url, access_token").eq("user_id", user.id).maybeSingle();
      if (conn && product.product_id) {
        try {
          const { data: variant } = await supabase.from("variants").select("shopify_variant_id").eq("product_id", product.product_id).maybeSingle();
          if (variant?.shopify_variant_id) {
            const { error } = await supabase.functions.invoke("shopify-direct-proxy", {
              body: {
                endpoint: `/admin/api/2025-01/variants/${variant.shopify_variant_id}.json`,
                method: "PUT",
                payload: { variant: { id: variant.shopify_variant_id, price: newPrice.toFixed(2) } },
              },
            });
            if (!error) shopifyUpdated = true;
          }
        } catch (e) {
          console.error("Shopify update failed:", e);
        }
      }

      // Update local variant price
      await supabase.from("variants").update({ retail_price: newPrice }).eq("product_id", product.product_id);
    }

    // Update monitored product price
    await supabase.from("competitor_monitored_products").update({ retail_price: newPrice }).eq("id", product.id);

    // Log price change
    await supabase.from("competitor_price_changes").insert({
      user_id: user.id,
      monitored_product_id: product.id,
      competitor_id: competitor.id,
      old_price: product.retail_price,
      new_price: newPrice,
      competitor_price: competitorPrice.competitor_price,
      change_method: method,
      change_detail: method === "match" ? "Matched price" : `Beat by ${amount}${method === "beat_dollar" ? "$" : "%"}`,
      shopify_updated: shopifyUpdated,
    });

    addAuditEntry("Price Match", `${product.product_title}: $${product.retail_price.toFixed(2)} → $${newPrice.toFixed(2)} (vs ${competitor.name})`);
    toast({ title: "Price updated", description: `${product.product_title} → $${newPrice.toFixed(2)}${shopifyUpdated ? " (Shopify synced)" : ""}` });
    setUpdatingPrice(false);
    setMatchModal(null);
    loadData();
  };

  const executeBulkMatch = async () => {
    const selected = priceRows.filter(r => selectedRows.has(r.product.id));
    if (!selected.length) return;
    setUpdatingPrice(true);

    let count = 0;
    for (const row of selected) {
      // Find cheapest competitor price
      const cheapest = Object.entries(row.prices)
        .filter(([, p]) => p.competitor_price !== null && p.match_status === "matched")
        .sort((a, b) => (a[1].competitor_price || 0) - (b[1].competitor_price || 0))[0];

      if (cheapest) {
        const comp = competitors.find(c => c.id === cheapest[0]);
        if (comp) {
          await executeMatchPrice(row.product, cheapest[1], comp, bulkMethod, bulkAmount);
          count++;
        }
      }
    }

    toast({ title: `Updated ${count} prices` });
    setUpdatingPrice(false);
    setBulkModal(false);
    setSelectedRows(new Set());
    loadData();
  };

  /* ─── Export CSV ─── */

  const exportCSV = () => {
    const headers = ["Handle", "Title", "Your Price", "Competitor", "Competitor Price", "Difference $", "Difference %", "Status", "Confidence", "Last Checked"];
    const rows = priceRows.flatMap(row =>
      Object.entries(row.prices).map(([compId, price]) => {
        const comp = competitors.find(c => c.id === compId);
        const diff = price.competitor_price ? row.product.retail_price - price.competitor_price : 0;
        const pctDiff = price.competitor_price ? ((diff / price.competitor_price) * 100) : 0;
        return [
          row.product.product_title.toLowerCase().replace(/\s+/g, "-"),
          row.product.product_title,
          row.product.retail_price.toFixed(2),
          comp?.name || "",
          price.competitor_price?.toFixed(2) || "",
          diff.toFixed(2),
          pctDiff.toFixed(1) + "%",
          price.match_status,
          price.confidence_score + "%",
          price.last_checked,
        ];
      })
    );

    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "competitor-prices.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ─── Status Badge ─── */

  const StatusBadge = ({ yourPrice, compPrice, status }: { yourPrice: number; compPrice: number | null; status: string }) => {
    if (status === "error") return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
    if (status === "not_found") return <Badge variant="outline" className="text-[10px]">Not Found</Badge>;
    if (status === "pending") return <Badge variant="secondary" className="text-[10px]">Pending</Badge>;
    if (status === "review") return <Badge className="text-[10px] bg-amber-500/20 text-amber-700 border-amber-300">Review</Badge>;
    if (!compPrice) return <Badge variant="outline" className="text-[10px]">N/A</Badge>;

    if (yourPrice < compPrice) return <Badge className="text-[10px] bg-emerald-500/20 text-emerald-700 border-emerald-300"><TrendingDown className="h-3 w-3 mr-0.5" />Lower</Badge>;
    if (yourPrice > compPrice) return <Badge className="text-[10px] bg-red-500/20 text-red-700 border-red-300"><TrendingUp className="h-3 w-3 mr-0.5" />Higher</Badge>;
    return <Badge className="text-[10px] bg-blue-500/20 text-blue-700 border-blue-300"><Minus className="h-3 w-3 mr-0.5" />Matched</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* ─── Render ─── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <h2 className="text-lg font-bold">Competitor Price Monitor</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-1">
        {(["dashboard", "competitors", "products"] as Tab[]).map(t => (
          <Button key={t} variant={tab === t ? "default" : "ghost"} size="sm" className="text-xs capitalize" onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>

      {/* ── Competitors Tab ── */}
      {tab === "competitors" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Competitors ({competitors.length})</h3>
            <Button size="sm" className="h-7 text-xs" onClick={() => setAddCompModal(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
          </div>
          {competitors.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No competitors yet. Add a competitor's Shopify store to start monitoring.
            </Card>
          ) : (
            <div className="space-y-2">
              {competitors.map(c => (
                <Card key={c.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.website_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.is_active ? "default" : "secondary"} className="text-[10px]">
                      {c.is_shopify ? "Shopify" : "Other"}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeCompetitor(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Products Tab ── */}
      {tab === "products" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Monitored Products ({products.length})</h3>
            <Button size="sm" className="h-7 text-xs" onClick={() => { setAddProdModal(true); addProductsFromShopify(); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add from catalog
            </Button>
          </div>
          {products.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No products being monitored. Add products from your catalog to start.
            </Card>
          ) : (
            <div className="space-y-2">
              {products.map(p => (
                <Card key={p.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{p.product_title}</p>
                    <p className="text-xs text-muted-foreground">{p.product_vendor} · ${p.retail_price.toFixed(2)}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeMonitoredProduct(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Dashboard Tab ── */}
      {tab === "dashboard" && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2 text-center">
              <p className="text-lg font-bold">{stats.total}</p>
              <p className="text-[10px] text-muted-foreground">Tracked</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-lg font-bold text-emerald-600">{stats.cheaper}</p>
              <p className="text-[10px] text-muted-foreground">You're Cheaper</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-lg font-bold text-red-600">{stats.expensive}</p>
              <p className="text-[10px] text-muted-foreground">You're Pricier</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-lg font-bold">{stats.matched}</p>
              <p className="text-[10px] text-muted-foreground">Matched</p>
            </Card>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs w-48" />
            <Button size="sm" className="h-7 text-xs" onClick={() => fetchPrices()} disabled={fetching}>
              {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              {fetching ? `Checking ${fetchProgress.current}/${fetchProgress.total}...` : "Check All Prices"}
            </Button>
            {selectedRows.size > 0 && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setBulkModal(true)}>
                <DollarSign className="h-3.5 w-3.5 mr-1" />Bulk Match ({selectedRows.size})
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={exportCSV}>
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
          </div>

          {fetching && <Progress value={(fetchProgress.current / Math.max(fetchProgress.total, 1)) * 100} className="h-1" />}

          {/* Price Table */}
          {priceRows.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              {products.length === 0
                ? "Add products and competitors to start monitoring."
                : "No results yet. Click 'Check All Prices' to fetch competitor prices."}
            </Card>
          ) : (
            <div className="border border-border rounded-md overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium w-8">
                      <Checkbox
                        checked={selectedRows.size === priceRows.length && priceRows.length > 0}
                        onCheckedChange={v => {
                          if (v) setSelectedRows(new Set(priceRows.map(r => r.product.id)));
                          else setSelectedRows(new Set());
                        }}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-right font-medium">Your Price</th>
                    {competitors.filter(c => c.is_active).map(c => (
                      <th key={c.id} className="px-2 py-1.5 text-right font-medium" title={c.website_url}>{c.name}</th>
                    ))}
                    <th className="px-2 py-1.5 text-center font-medium w-16">Status</th>
                    <th className="px-2 py-1.5 text-center font-medium w-16">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows.map((row, i) => {
                    const activeComps = competitors.filter(c => c.is_active);
                    return (
                      <tr key={row.product.id} className={`border-t border-border hover:bg-muted/30 ${i % 2 === 1 ? "bg-muted/15" : ""}`}>
                        <td className="px-2 py-1">
                          <Checkbox
                            checked={selectedRows.has(row.product.id)}
                            onCheckedChange={v => {
                              const next = new Set(selectedRows);
                              if (v) next.add(row.product.id);
                              else next.delete(row.product.id);
                              setSelectedRows(next);
                            }}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <p className="font-medium truncate max-w-[200px]">{row.product.product_title}</p>
                          {row.product.product_vendor && <p className="text-[10px] text-muted-foreground">{row.product.product_vendor}</p>}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">${row.product.retail_price.toFixed(2)}</td>
                        {activeComps.map(comp => {
                          const price = row.prices[comp.id];
                          if (!price || !price.competitor_price) {
                            return (
                              <td key={comp.id} className="px-2 py-1 text-right text-muted-foreground">
                                {price?.match_status === "error" ? "Error" : price?.match_status === "not_found" ? "—" : "..."}
                              </td>
                            );
                          }
                          const diff = row.product.retail_price - price.competitor_price;
                          const pct = ((diff / price.competitor_price) * 100);
                          return (
                            <td key={comp.id} className="px-2 py-1 text-right">
                              <span className="font-mono">${price.competitor_price.toFixed(2)}</span>
                              <span className={`ml-1 text-[10px] ${diff > 0 ? "text-red-500" : diff < 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                                ({diff > 0 ? "+" : ""}{pct.toFixed(0)}%)
                              </span>
                              {price.confidence_score < 80 && (
                                <span title={`${price.confidence_score}% confidence`}><HelpCircle className="inline h-3 w-3 ml-0.5 text-amber-500" /></span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-center">
                          {(() => {
                            // Find worst status across competitors
                            const statuses = activeComps.map(c => row.prices[c.id]);
                            const matched = statuses.find(s => s?.match_status === "matched");
                            if (matched) return <StatusBadge yourPrice={row.product.retail_price} compPrice={matched.competitor_price} status="matched" />;
                            const review = statuses.find(s => s?.match_status === "review");
                            if (review) return <StatusBadge yourPrice={row.product.retail_price} compPrice={review.competitor_price} status="review" />;
                            return <StatusBadge yourPrice={0} compPrice={null} status={statuses[0]?.match_status || "pending"} />;
                          })()}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {(() => {
                            // Find first matched competitor with price
                            const activeComp = activeComps.find(c => row.prices[c.id]?.competitor_price && row.prices[c.id]?.match_status === "matched");
                            if (!activeComp) return null;
                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-[10px] px-1.5"
                                onClick={() => setMatchModal({ product: row.product, competitorPrice: row.prices[activeComp.id], competitor: activeComp })}
                              >
                                Match
                              </Button>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Disclaimer */}
          <Card className="p-3 bg-muted/30 border-amber-200">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[10px] text-muted-foreground">
                <strong>Disclaimer:</strong> This tool is for market research and price monitoring. It is the user's responsibility to ensure their use of this tool complies with all applicable laws, regulations, and the terms of service of any website they interact with. Competitor data is cached for up to 4 hours.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* ── Add Competitor Modal ── */}
      <Dialog open={addCompModal} onOpenChange={setAddCompModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Competitor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Competitor Name</Label>
              <Input value={newComp.name} onChange={e => setNewComp({ ...newComp, name: e.target.value })} placeholder="e.g. Rival Store" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Shopify Store URL</Label>
              <Input value={newComp.website_url} onChange={e => setNewComp({ ...newComp, website_url: e.target.value })} placeholder="e.g. rival-store.myshopify.com" className="h-8 text-sm" />
              <p className="text-[10px] text-muted-foreground mt-1">Must be a Shopify store (uses /products.json API)</p>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" onClick={addCompetitor} disabled={!newComp.name || !newComp.website_url}>Add Competitor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Product Modal ── */}
      <Dialog open={addProdModal} onOpenChange={setAddProdModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Products to Monitor</DialogTitle></DialogHeader>
          {loadingShopify ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Search products..." value={prodSearch} onChange={e => setProdSearch(e.target.value)} className="h-8 text-sm" />
              <div className="max-h-60 overflow-auto space-y-1">
                {shopifyProducts
                  .filter(p => !prodSearch || p.title.toLowerCase().includes(prodSearch.toLowerCase()))
                  .slice(0, 30)
                  .map(p => {
                    const already = products.some(mp => mp.product_id === p.id);
                    return (
                      <div key={p.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                        <div>
                          <p className="text-sm">{p.title}</p>
                          <p className="text-[10px] text-muted-foreground">{p.vendor} · ${p.retail_price?.toFixed(2) || "0.00"}</p>
                        </div>
                        <Button
                          size="sm"
                          variant={already ? "secondary" : "outline"}
                          className="h-6 text-[10px]"
                          disabled={already}
                          onClick={() => addMonitoredProduct(p)}
                        >
                          {already ? "Added" : "Add"}
                        </Button>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Price Match Modal ── */}
      {matchModal && (
        <Dialog open onOpenChange={() => setMatchModal(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Price Match</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm font-medium">{matchModal.product.product_title}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-[10px] text-muted-foreground">Your Price</p>
                  <p className="text-lg font-bold">${matchModal.product.retail_price.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-[10px] text-muted-foreground">{matchModal.competitor.name}</p>
                  <p className="text-lg font-bold">${matchModal.competitorPrice.competitor_price?.toFixed(2)}</p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Match Strategy</Label>
                <Select value={matchMethod} onValueChange={v => setMatchMethod(v as MatchMethod)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="match">Match price exactly</SelectItem>
                    <SelectItem value="beat_dollar">Beat by $ amount</SelectItem>
                    <SelectItem value="beat_percent">Beat by % discount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {matchMethod !== "match" && (
                <div>
                  <Label className="text-xs">Amount ({matchMethod === "beat_dollar" ? "$" : "%"})</Label>
                  <Input type="number" value={beatAmount} onChange={e => setBeatAmount(Number(e.target.value))} className="h-8 text-sm" min={0} />
                </div>
              )}

              {matchModal.competitorPrice.competitor_price && (
                <div className="p-3 bg-primary/5 rounded border border-primary/20">
                  <p className="text-xs text-muted-foreground">New Price Preview</p>
                  <p className="text-xl font-bold text-primary">
                    ${calculateNewPrice(matchModal.competitorPrice.competitor_price, matchMethod, beatAmount).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setMatchModal(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => executeMatchPrice(matchModal.product, matchModal.competitorPrice, matchModal.competitor, matchMethod, beatAmount)}
                disabled={updatingPrice}
              >
                {updatingPrice ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Set Price
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Bulk Match Modal ── */}
      <Dialog open={bulkModal} onOpenChange={setBulkModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Price Match ({selectedRows.size} products)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Match Strategy</Label>
              <Select value={bulkMethod} onValueChange={v => setBulkMethod(v as MatchMethod)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="match">Match price exactly</SelectItem>
                  <SelectItem value="beat_dollar">Beat by $ amount</SelectItem>
                  <SelectItem value="beat_percent">Beat by % discount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bulkMethod !== "match" && (
              <div>
                <Label className="text-xs">Amount ({bulkMethod === "beat_dollar" ? "$" : "%"})</Label>
                <Input type="number" value={bulkAmount} onChange={e => setBulkAmount(Number(e.target.value))} className="h-8 text-sm" min={0} />
              </div>
            )}
            <div className="p-2 bg-amber-50 border border-amber-200 rounded flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">This will update prices for {selectedRows.size} products against the cheapest competitor price found. Safety checks will run for each product.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkModal(false)}>Cancel</Button>
            <Button size="sm" onClick={executeBulkMatch} disabled={updatingPrice}>
              {updatingPrice ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Apply to {selectedRows.size} products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
