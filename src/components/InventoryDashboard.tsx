import { useState, useEffect, useMemo } from "react";
import { useBarcode } from "@/components/BarcodeProvider";
import DataGrid from "@/components/ui/data-grid";
import { type ColumnDef } from "@tanstack/react-table";
import {
  ChevronLeft, Package, DollarSign, AlertTriangle, TrendingUp,
  TrendingDown, MapPin, BarChart3, Loader2, RefreshCw,
} from "lucide-react";
import BulkInventoryActions from "@/components/BulkInventoryActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import LocationFilter from "@/components/LocationFilter";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";

/* ─── Types ─── */

interface ProductVariant {
  variantId: string;
  productId: string;
  productTitle: string;
  vendor: string | null;
  productType: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  cost: number;
  retailPrice: number;
  /** Quantity for the currently selected location (or sum across all locations). */
  quantity: number;
  /** Per-location breakdown: location name → qty (only includes locations with inventory rows). */
  byLocation: Record<string, number>;
}

interface InventoryLocation {
  variantId: string;
  location: string;
  quantity: number;
}

interface DashboardData {
  variants: ProductVariant[];
  locations: InventoryLocation[];
}

/* ─── Helpers ─── */

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pct = (n: number) => `${n.toFixed(1)}%`;

/* ─── Component ─── */

interface Props {
  onBack: () => void;
}

export default function InventoryDashboard({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData>({ variants: [], locations: [] });
  const [tab, setTab] = useState("overview");
  const [highlightedSku, setHighlightedSku] = useState<string | null>(null);
  const { selected: selectedLocation, selectedLocation: selectedLocationObj } = useShopifyLocations();

  // Global barcode scanner integration
  const { registerHandler } = useBarcode();
  useEffect(() => {
    return registerHandler("inventory", (barcode) => {
      setHighlightedSku(barcode.toLowerCase());
      // Clear highlight after 5s
      setTimeout(() => setHighlightedSku(null), 5000);
    });
  }, [registerHandler]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Fetch variants with product info
      const { data: variantsRaw } = await supabase
        .from("variants")
        .select("id, product_id, sku, color, size, cost, retail_price, quantity")
        .eq("user_id", user.id);

      const { data: productsRaw } = await supabase
        .from("products")
        .select("id, title, vendor, product_type")
        .eq("user_id", user.id);

      const { data: inventoryRaw } = await supabase
        .from("inventory")
        .select("variant_id, location, quantity")
        .eq("user_id", user.id);

      const productMap = new Map((productsRaw || []).map(p => [p.id, p]));

      const variants: ProductVariant[] = (variantsRaw || []).map(v => {
        const prod = productMap.get(v.product_id);
        return {
          variantId: v.id,
          productId: v.product_id,
          productTitle: prod?.title || "Unknown",
          vendor: prod?.vendor || null,
          productType: prod?.product_type || null,
          sku: v.sku,
          color: v.color,
          size: v.size,
          cost: Number(v.cost) || 0,
          retailPrice: Number(v.retail_price) || 0,
          quantity: v.quantity || 0,
        };
      });

      const locations: InventoryLocation[] = (inventoryRaw || []).map(i => ({
        variantId: i.variant_id,
        location: i.location,
        quantity: i.quantity || 0,
      }));

      setData({ variants, locations });
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  /* ─── Computed stats ─── */
  // ── Bug fix: Cost / Retail / Margin must be derived from the SAME variant set,
  // otherwise we get nonsense like "Retail < Cost with positive margin" when
  // many variants are missing a retail price. We compute over the
  // "priced" subset (cost > 0 AND retailPrice > 0) for retail & margin, and
  // expose the underlying counts so the UI can flag missing data.
  const stats = useMemo(() => {
    const { variants } = data;
    const totalUnits = variants.reduce((s, v) => s + v.quantity, 0);
    const totalValueAtCost = variants.reduce((s, v) => s + v.quantity * v.cost, 0);
    const uniqueProducts = new Set(variants.map(v => v.productId)).size;

    // Low stock: quantity > 0 but <= 3
    const lowStock = variants.filter(v => v.quantity > 0 && v.quantity <= 3);
    // Out of stock
    const outOfStock = variants.filter(v => v.quantity <= 0);

    // Margin & Retail derived from variants that have BOTH a cost and a retail price.
    const priced = variants.filter(v => v.cost > 0 && v.retailPrice > 0);
    const totalValueAtRetail = priced.reduce((s, v) => s + v.quantity * v.retailPrice, 0);
    const totalValueAtCostPriced = priced.reduce((s, v) => s + v.quantity * v.cost, 0);
    const avgMargin = totalValueAtRetail > 0
      ? ((totalValueAtRetail - totalValueAtCostPriced) / totalValueAtRetail) * 100
      : 0;
    const missingRetailCount = variants.filter(v => v.cost > 0 && v.retailPrice <= 0).length;

    return {
      totalUnits, totalValueAtCost, totalValueAtRetail, uniqueProducts,
      lowStockCount: lowStock.length, outOfStockCount: outOfStock.length,
      avgMargin, variantCount: variants.length,
      missingRetailCount,
      pricedCount: priced.length,
      // Cost value of the SAME priced subset that retail+margin are computed over,
      // so users can see apples-to-apples next to the totals.
      totalValueAtCostPriced,
    };
  }, [data]);

  // Best sellers = highest quantity (proxy for popular items stocked heavily)
  // Slow movers = lowest quantity > 0 with high cost (capital tied up)
  const bestSellers = useMemo(() => {
    return [...data.variants]
      .filter(v => v.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }, [data.variants]);

  const slowMovers = useMemo(() => {
    return [...data.variants]
      .filter(v => v.quantity > 0)
      .sort((a, b) => {
        // Sort by days-of-stock value (quantity * cost) ascending — least capital efficiency
        const aVal = a.quantity * a.cost;
        const bVal = b.quantity * b.cost;
        // Highest value with lowest quantity ratio = slow mover
        return (a.quantity > 0 ? aVal / a.quantity : 0) - (b.quantity > 0 ? bVal / b.quantity : 0);
      })
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 10);
  }, [data.variants]);

  const lowStockItems = useMemo(() => {
    return [...data.variants]
      .filter(v => v.quantity > 0 && v.quantity <= 3)
      .sort((a, b) => a.quantity - b.quantity);
  }, [data.variants]);

  const outOfStockItems = useMemo(() => {
    return data.variants.filter(v => v.quantity <= 0);
  }, [data.variants]);

  // Stock by location
  const locationSummary = useMemo(() => {
    const map = new Map<string, { units: number; variants: number }>();
    for (const loc of data.locations) {
      const existing = map.get(loc.location) || { units: 0, variants: 0 };
      existing.units += loc.quantity;
      existing.variants += 1;
      map.set(loc.location, existing);
    }
    // If no inventory table data, show from variants as "Default"
    if (map.size === 0 && data.variants.length > 0) {
      map.set("Default", {
        units: data.variants.reduce((s, v) => s + v.quantity, 0),
        variants: data.variants.length,
      });
    }
    return Array.from(map.entries()).map(([location, d]) => ({ location, ...d }))
      .sort((a, b) => b.units - a.units);
  }, [data]);

  // Top vendors by inventory value
  const vendorBreakdown = useMemo(() => {
    const map = new Map<string, { units: number; value: number; count: number }>();
    for (const v of data.variants) {
      const vendor = v.vendor || "Unknown";
      const existing = map.get(vendor) || { units: 0, value: 0, count: 0 };
      existing.units += v.quantity;
      existing.value += v.quantity * v.cost;
      existing.count += 1;
      map.set(vendor, existing);
    }
    return Array.from(map.entries())
      .map(([vendor, d]) => ({ vendor, ...d }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [data.variants]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const VariantRow = ({ v, showQty = true }: { v: ProductVariant; showQty?: boolean }) => {
    const margin = v.cost > 0 && v.retailPrice > 0
      ? ((v.retailPrice - v.cost) / v.retailPrice) * 100 : -1;
    return (
      <div className={cn("flex items-center gap-3 py-2 border-b border-border last:border-0 transition-all", highlightedSku && v.sku?.toLowerCase() === highlightedSku && "ring-2 ring-primary bg-primary/5 rounded-md px-2")}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{v.productTitle}</p>
          <p className="text-[10px] text-muted-foreground">
            {[v.color, v.size, v.sku].filter(Boolean).join(" • ")}
            {v.vendor && ` • ${v.vendor}`}
          </p>
        </div>
        {showQty && (
          <div className="text-right shrink-0">
            <p className="text-sm font-mono font-semibold">{v.quantity}</p>
            <p className="text-[10px] text-muted-foreground">units</p>
          </div>
        )}
        <div className="text-right shrink-0 w-16">
          <p className="text-xs font-mono">{fmt(v.cost)}</p>
          <p className="text-[10px] text-muted-foreground">cost</p>
        </div>
        {margin >= 0 && (
          <Badge variant={margin >= 50 ? "default" : margin >= 30 ? "secondary" : "destructive"} className="text-[10px] shrink-0">
            {margin.toFixed(0)}%
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Inventory Dashboard
          </h2>
          <p className="text-xs text-muted-foreground">Real-time inventory health overview</p>
        </div>
        <BulkInventoryActions mode="inventory" onComplete={fetchData} />
        <Button variant="ghost" size="sm" onClick={fetchData}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {data.variants.length === 0 ? (
        <Card className="p-8 text-center">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-semibold">No inventory data yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Import products via invoices, wholesale orders, or connect your Shopify store.
          </p>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
            <TabsTrigger value="products" className="flex-1 text-xs">Products</TabsTrigger>
            <TabsTrigger value="alerts" className="flex-1 text-xs">
              Alerts {(stats.lowStockCount + stats.outOfStockCount) > 0 && (
                <Badge variant="destructive" className="ml-1 text-[9px] px-1">{stats.lowStockCount + stats.outOfStockCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="locations" className="flex-1 text-xs">Locations</TabsTrigger>
          </TabsList>

          {/* ─── Overview ─── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Products</p>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.uniqueProducts}</p>
                <p className="text-[10px] text-muted-foreground">{stats.variantCount} variants</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Value (Cost)</p>
                </div>
                <p className="text-2xl font-bold font-mono">{fmt(stats.totalValueAtCost)}</p>
                <p className="text-[10px] text-muted-foreground">
                  all {stats.variantCount} variant{stats.variantCount === 1 ? "" : "s"}
                </p>
              </Card>
              <Card className="p-4" title={stats.pricedCount > 0
                ? `Computed from ${stats.pricedCount} of ${stats.variantCount} variants that have a retail price set.`
                : `0 of ${stats.variantCount} variants have a retail price set yet.`}>
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Value (Retail)</p>
                </div>
                {stats.pricedCount > 0 ? (
                  <>
                    <p className="text-2xl font-bold font-mono">{fmt(stats.totalValueAtRetail)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      from {stats.pricedCount} of {stats.variantCount} priced
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold font-mono text-muted-foreground">—</p>
                    <p className="text-[10px] text-amber-600">0 of {stats.variantCount} have retail set</p>
                  </>
                )}
              </Card>
              <Card className="p-4" title={stats.pricedCount > 0
                ? `Margin computed across the ${stats.pricedCount} variants that have both cost and retail. Other ${stats.variantCount - stats.pricedCount} excluded.`
                : "No variants have both cost and retail set yet."}>
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Avg Margin</p>
                </div>
                {stats.pricedCount > 0 ? (
                  <>
                    <p className={cn("text-2xl font-bold font-mono", stats.avgMargin >= 50 ? "text-green-600" : stats.avgMargin >= 30 ? "text-yellow-600" : "text-red-600")}>
                      {pct(stats.avgMargin)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      from {stats.pricedCount} of {stats.variantCount} priced
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold font-mono text-muted-foreground">—</p>
                    <p className="text-[10px] text-amber-600">set retail to see margin</p>
                  </>
                )}
              </Card>
            </div>

            {/* Honest banner when no retail data is set — replaces fake numbers */}
            {stats.pricedCount === 0 && stats.variantCount > 0 && (
              <Card className="p-3 border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-900/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">No retail prices set yet</p>
                    <p className="text-[11px] text-muted-foreground">
                      Set a retail price on your variants to see total stock value at retail and average margin.
                    </p>
                  </div>
                </div>
              </Card>
            )}
            {/* Partial-coverage hint — totals still shown but flagged so users know */}
            {stats.pricedCount > 0 && stats.missingRetailCount > 0 && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                Retail value &amp; margin computed from {stats.pricedCount} of {stats.variantCount} variants. {stats.missingRetailCount} are missing a retail price and excluded from the retail/margin tiles.
              </p>
            )}

            {/* Health bar */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">Stock Health</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">In Stock</span>
                    <span className="font-mono">{stats.variantCount - stats.outOfStockCount - stats.lowStockCount}</span>
                  </div>
                  <Progress value={stats.variantCount > 0 ? ((stats.variantCount - stats.outOfStockCount - stats.lowStockCount) / stats.variantCount) * 100 : 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-yellow-600">Low Stock (≤3)</span>
                    <span className="font-mono text-yellow-600">{stats.lowStockCount}</span>
                  </div>
                  <Progress value={stats.variantCount > 0 ? (stats.lowStockCount / stats.variantCount) * 100 : 0} className="h-2 [&>div]:bg-yellow-500" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-red-600">Out of Stock</span>
                    <span className="font-mono text-red-600">{stats.outOfStockCount}</span>
                  </div>
                  <Progress value={stats.variantCount > 0 ? (stats.outOfStockCount / stats.variantCount) * 100 : 0} className="h-2 [&>div]:bg-red-500" />
                </div>
              </div>
            </Card>

            {/* Vendor breakdown */}
            {vendorBreakdown.length > 0 && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">Top Vendors by Inventory Value</h3>
                <div className="space-y-2">
                  {vendorBreakdown.map(v => {
                    const maxVal = vendorBreakdown[0]?.value || 1;
                    return (
                      <div key={v.vendor}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="truncate">{v.vendor}</span>
                          <span className="font-mono shrink-0">{fmt(v.value)} ({v.units} units)</span>
                        </div>
                        <Progress value={(v.value / maxVal) * 100} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ─── Products DataGrid ─── */}
          <TabsContent value="products">
            <DataGrid
              data={data.variants}
              storageKey="inv_products"
              enableSelection
              pageSize={50}
              exportFilename="inventory-products.csv"
              columns={[
                { accessorKey: "sku", header: "SKU", size: 100, cell: ({ getValue, row }) => (
                  <span className={cn("font-mono", highlightedSku && (getValue() as string)?.toLowerCase() === highlightedSku && "text-primary font-bold")}>{(getValue() as string) || "—"}</span>
                )},
                { accessorKey: "productTitle", header: "Product", size: 200, cell: ({ getValue }) => <span className="font-medium truncate block max-w-[200px]">{getValue() as string}</span> },
                { accessorKey: "color", header: "Color", size: 70 },
                { accessorKey: "size", header: "Size", size: 60 },
                { accessorKey: "quantity", header: "On Hand", size: 70, cell: ({ getValue }) => <span className={cn("font-mono font-medium", (getValue() as number) === 0 && "text-destructive")}>{getValue() as number}</span> },
                { accessorKey: "cost", header: "Cost", size: 70, cell: ({ getValue }) => `$${(getValue() as number).toFixed(2)}` },
                { accessorKey: "retailPrice", header: "Retail", size: 70, cell: ({ getValue }) => `$${(getValue() as number).toFixed(2)}` },
                { id: "margin", header: "Margin", size: 70, accessorFn: (r) => r.cost > 0 && r.retailPrice > 0 ? ((r.retailPrice - r.cost) / r.retailPrice) * 100 : -1, cell: ({ getValue }) => { const m = getValue() as number; return m >= 0 ? <Badge variant={m >= 50 ? "default" : m >= 30 ? "secondary" : "destructive"} className="text-[10px]">{m.toFixed(0)}%</Badge> : "—"; }},
                { accessorKey: "vendor", header: "Vendor", size: 100, cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) || "—"}</span> },
              ] as ColumnDef<ProductVariant, any>[]}
            />
          </TabsContent>

          {/* ─── Alerts ─── */}
          <TabsContent value="alerts" className="space-y-4">
            {stats.outOfStockCount > 0 && (
              <Card className="p-4 border-l-4 border-l-destructive">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  Out of Stock ({outOfStockItems.length})
                </h3>
                <div className="max-h-64 overflow-y-auto">
                  {outOfStockItems.map(v => (
                    <VariantRow key={v.variantId} v={v} />
                  ))}
                </div>
              </Card>
            )}

            {stats.lowStockCount > 0 && (
              <Card className="p-4 border-l-4 border-l-yellow-500">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  Low Stock — 3 or fewer ({lowStockItems.length})
                </h3>
                <div className="max-h-64 overflow-y-auto">
                  {lowStockItems.map(v => (
                    <VariantRow key={v.variantId} v={v} />
                  ))}
                </div>
              </Card>
            )}

            {stats.outOfStockCount === 0 && stats.lowStockCount === 0 && (
              <Card className="p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                  <TrendingUp className="w-6 h-6 text-green-600" />
                </div>
                <p className="text-sm font-semibold">All stock levels healthy!</p>
                <p className="text-xs text-muted-foreground">No items are low or out of stock.</p>
              </Card>
            )}
          </TabsContent>

          {/* ─── Locations ─── */}
          <TabsContent value="locations" className="space-y-4">
            {locationSummary.map(loc => {
              const totalUnits = locationSummary.reduce((s, l) => s + l.units, 0);
              const pctOfTotal = totalUnits > 0 ? (loc.units / totalUnits) * 100 : 0;
              return (
                <Card key={loc.location} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{loc.location}</p>
                      <p className="text-xs text-muted-foreground">{loc.variants} variants tracked</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold font-mono">{loc.units.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">{pct(pctOfTotal)} of total</p>
                    </div>
                  </div>
                  <Progress value={pctOfTotal} className="h-1.5 mt-3" />
                </Card>
              );
            })}

            {locationSummary.length === 0 && (
              <Card className="p-6 text-center">
                <MapPin className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No location data available yet.</p>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
