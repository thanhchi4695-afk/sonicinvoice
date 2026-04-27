import { useState, useEffect, useMemo, useCallback } from "react";
import { Download, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import LocationFilter from "@/components/LocationFilter";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";

const CACHE_KEY = "stock_on_hand_cache_v1";
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

interface Row {
  vendor: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  location: string;
  productType: string;
  quantity: number;
  currentCost: number;
  averageCost: number;
  retailPrice: number;
}

type SortKey = keyof Row | "totalCost" | "totalRetail" | "margin";

function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(","),
    ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  addAuditEntry("Export CSV", filename);
}

const StockOnHandReport = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Filters
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const { selected: globalLocSelected, selectedLocation: globalLocObj } = useShopifyLocations();
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [hideZero, setHideZero] = useState<boolean>(true);
  const [costView, setCostView] = useState<"current" | "average">("current");
  const [sortKey, setSortKey] = useState<SortKey>("vendor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // History
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [historyDays, setHistoryDays] = useState<number>(90);

  const loadFromCache = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp > CACHE_TTL) return false;
      setRows(parsed.rows);
      setLastRefreshed(new Date(parsed.timestamp));
      return true;
    } catch {
      return false;
    }
  }, []);

  const saveSnapshot = useCallback(async (data: Row[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const totalUnits = data.reduce((s, r) => s + r.quantity, 0);
    const totalCost = data.reduce((s, r) => s + r.quantity * r.currentCost, 0);
    const totalRetail = data.reduce((s, r) => s + r.quantity * r.retailPrice, 0);
    await supabase.from("stock_snapshots").insert({
      user_id: user.id,
      total_skus: data.length,
      total_units: totalUnits,
      total_cost_value: totalCost,
      total_retail_value: totalRetail,
      location_filter: locationFilter,
    });
  }, [locationFilter]);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && loadFromCache()) return;
    setLoading(true);
    setProgress("Loading inventory…");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        setLoading(false);
        return;
      }

      // Fetch products + variants from local mirror (synced from Shopify)
      setProgress("Fetching products…");
      const { data: products } = await supabase
        .from("products")
        .select("id, title, vendor, product_type")
        .eq("user_id", user.id);

      setProgress("Fetching variants…");
      const { data: variants } = await supabase
        .from("variants")
        .select("id, product_id, sku, barcode, color, size, quantity, cost, retail_price")
        .eq("user_id", user.id);

      // Per-location inventory
      setProgress("Fetching per-location inventory…");
      const { data: invByLoc } = await supabase
        .from("inventory")
        .select("variant_id, location, quantity")
        .eq("user_id", user.id);

      // Average cost from purchase_order_lines (avg actual_cost over received_qty)
      setProgress("Computing average cost…");
      const { data: poLines } = await supabase
        .from("purchase_order_lines")
        .select("sku, actual_cost, expected_cost, received_qty")
        .eq("user_id", user.id);

      // Average cost is keyed by SKU (purchase_order_lines has no variant_id)
      const avgCostMap = new Map<string, { totalCost: number; totalQty: number }>();
      (poLines || []).forEach(l => {
        const cost = l.actual_cost ?? l.expected_cost ?? 0;
        const qty = l.received_qty ?? 0;
        if (qty <= 0 || !l.sku) return;
        const cur = avgCostMap.get(l.sku) || { totalCost: 0, totalQty: 0 };
        cur.totalCost += cost * qty;
        cur.totalQty += qty;
        avgCostMap.set(l.sku, cur);
      });

      const productMap = new Map((products || []).map(p => [p.id, p]));
      const invMap = new Map<string, { location: string; quantity: number }[]>();
      (invByLoc || []).forEach(i => {
        if (!i.variant_id) return;
        const arr = invMap.get(i.variant_id) || [];
        arr.push({ location: i.location || "Main store", quantity: i.quantity || 0 });
        invMap.set(i.variant_id, arr);
      });

      setProgress("Building rows…");
      const built: Row[] = [];
      (variants || []).forEach(v => {
        const prod = productMap.get(v.product_id);
        const locs = invMap.get(v.id);
        const avg = v.sku ? avgCostMap.get(v.sku) : undefined;
        const averageCost = avg && avg.totalQty > 0 ? avg.totalCost / avg.totalQty : (v.cost || 0);
        const variantTitle = [v.color, v.size].filter(Boolean).join(" / ") || "—";
        const baseRow = {
          vendor: prod?.vendor || "Unknown",
          productTitle: prod?.title || "Untitled",
          variantTitle,
          sku: v.sku || "—",
          barcode: v.barcode || "—",
          productType: prod?.product_type || "Uncategorised",
          currentCost: v.cost || 0,
          averageCost,
          retailPrice: v.retail_price || 0,
        };

        if (locs && locs.length > 0) {
          locs.forEach(l => {
            built.push({
              ...baseRow,
              location: l.location,
              quantity: l.quantity,
            });
          });
        } else {
          built.push({
            ...baseRow,
            location: "Main store",
            quantity: v.quantity || 0,
          });
        }
      });

      setRows(built);
      const now = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: now, rows: built }));
      setLastRefreshed(new Date(now));
      setProgress("Saving snapshot…");
      await saveSnapshot(built);
      toast.success(`Loaded ${built.length} stock lines`);
    } catch (e: any) {
      toast.error(`Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [loadFromCache, saveSnapshot]);

  const loadSnapshots = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const since = subDays(new Date(), historyDays).toISOString();
    const { data } = await supabase
      .from("stock_snapshots")
      .select("snapshot_date, total_units, total_cost_value, total_retail_value")
      .eq("user_id", user.id)
      .gte("snapshot_date", since)
      .order("snapshot_date", { ascending: true });
    setSnapshots((data || []).map(s => ({
      date: format(new Date(s.snapshot_date), "dd MMM"),
      cost: Number(s.total_cost_value),
      retail: Number(s.total_retail_value),
      units: s.total_units,
    })));
  }, [historyDays]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Derived options
  const allVendors = useMemo(() => Array.from(new Set(rows.map(r => r.vendor))).sort(), [rows]);
  const allTypes = useMemo(() => Array.from(new Set(rows.map(r => r.productType))).sort(), [rows]);
  const allLocations = useMemo(() => Array.from(new Set(rows.map(r => r.location))).sort(), [rows]);

  // Filtering
  const filteredRows = useMemo(() => {
    let out = rows;
    if (locationFilter !== "all") out = out.filter(r => r.location === locationFilter);
    if (vendorFilter.length > 0) out = out.filter(r => vendorFilter.includes(r.vendor));
    if (typeFilter.length > 0) out = out.filter(r => typeFilter.includes(r.productType));
    if (hideZero) out = out.filter(r => r.quantity > 0);
    return out;
  }, [rows, locationFilter, vendorFilter, typeFilter, hideZero]);

  // Sorting
  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const costA = costView === "current" ? a.currentCost : a.averageCost;
      const costB = costView === "current" ? b.currentCost : b.averageCost;
      const totalCostA = a.quantity * costA;
      const totalCostB = b.quantity * costB;
      const totalRetailA = a.quantity * a.retailPrice;
      const totalRetailB = b.quantity * b.retailPrice;
      const marginA = a.retailPrice > 0 ? ((a.retailPrice - costA) / a.retailPrice) * 100 : 0;
      const marginB = b.retailPrice > 0 ? ((b.retailPrice - costB) / b.retailPrice) * 100 : 0;

      let va: any, vb: any;
      switch (sortKey) {
        case "totalCost": va = totalCostA; vb = totalCostB; break;
        case "totalRetail": va = totalRetailA; vb = totalRetailB; break;
        case "margin": va = marginA; vb = marginB; break;
        case "currentCost": va = costA; vb = costB; break;
        default: va = (a as any)[sortKey]; vb = (b as any)[sortKey];
      }
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va || 0) - (vb || 0)) * dir;
    });
    // Default secondary sort: vendor → product title
    if (sortKey === "vendor") {
      arr.sort((a, b) => {
        const v = a.vendor.localeCompare(b.vendor) * dir;
        return v !== 0 ? v : a.productTitle.localeCompare(b.productTitle);
      });
    }
    return arr;
  }, [filteredRows, sortKey, sortDir, costView]);

  // Totals
  const totals = useMemo(() => {
    let units = 0, cost = 0, retail = 0;
    sortedRows.forEach(r => {
      const c = costView === "current" ? r.currentCost : r.averageCost;
      units += r.quantity;
      cost += r.quantity * c;
      retail += r.quantity * r.retailPrice;
    });
    const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
    return { skus: sortedRows.length, units, cost, retail, margin };
  }, [sortedRows, costView]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleExport = () => {
    // Export ignores hideZero — get the full inventory
    let out = rows;
    if (locationFilter !== "all") out = out.filter(r => r.location === locationFilter);
    if (vendorFilter.length > 0) out = out.filter(r => vendorFilter.includes(r.vendor));
    if (typeFilter.length > 0) out = out.filter(r => typeFilter.includes(r.productType));
    const csvRows = out.map(r => {
      const c = costView === "current" ? r.currentCost : r.averageCost;
      const totalCost = r.quantity * c;
      const totalRetail = r.quantity * r.retailPrice;
      const margin = r.retailPrice > 0 ? ((r.retailPrice - c) / r.retailPrice) * 100 : 0;
      return {
        Vendor: r.vendor,
        Product: r.productTitle,
        Variant: r.variantTitle,
        SKU: r.sku,
        Barcode: r.barcode,
        Location: r.location,
        "Product Type": r.productType,
        Available: r.quantity,
        [costView === "current" ? "Current Cost" : "Average Cost"]: c.toFixed(2),
        "Total Cost": totalCost.toFixed(2),
        "Retail Price": r.retailPrice.toFixed(2),
        "Total Retail Value": totalRetail.toFixed(2),
        "Margin %": margin.toFixed(1),
      };
    });
    downloadCSV(csvRows, `stock-on-hand-${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const SortHeader = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-foreground", align === "right" && "text-right")}
      onClick={() => handleSort(k)}
    >
      {label} {sortKey === k && (sortDir === "asc" ? "↑" : "↓")}
    </TableHead>
  );

  return (
    <Tabs defaultValue="report" className="space-y-4">
      <TabsList>
        <TabsTrigger value="report">Stock on Hand</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>

      {/* ── REPORT TAB ── */}
      <TabsContent value="report" className="space-y-3">
        {/* Summary KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Card><CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">SKUs</div>
            <div className="text-lg font-semibold">{totals.skus.toLocaleString()}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Units</div>
            <div className="text-lg font-semibold">{totals.units.toLocaleString()}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Cost Value</div>
            <div className="text-lg font-semibold">${totals.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Retail Value</div>
            <div className="text-lg font-semibold">${totals.retail.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Blended Margin</div>
            <div className="text-lg font-semibold">{totals.margin.toFixed(1)}%</div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <Card><CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Location</Label>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {allLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                Vendor {vendorFilter.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{vendorFilter.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 max-h-72 overflow-auto">
              {allVendors.map(v => (
                <label key={v} className="flex items-center gap-2 p-1 text-xs cursor-pointer hover:bg-muted rounded">
                  <input
                    type="checkbox"
                    checked={vendorFilter.includes(v)}
                    onChange={() => setVendorFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])}
                  />
                  {v}
                </label>
              ))}
              {vendorFilter.length > 0 && (
                <Button size="sm" variant="ghost" className="mt-2 w-full text-xs" onClick={() => setVendorFilter([])}>Clear</Button>
              )}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                Type {typeFilter.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{typeFilter.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 max-h-72 overflow-auto">
              {allTypes.map(t => (
                <label key={t} className="flex items-center gap-2 p-1 text-xs cursor-pointer hover:bg-muted rounded">
                  <input
                    type="checkbox"
                    checked={typeFilter.includes(t)}
                    onChange={() => setTypeFilter(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}
                  />
                  {t}
                </label>
              ))}
              {typeFilter.length > 0 && (
                <Button size="sm" variant="ghost" className="mt-2 w-full text-xs" onClick={() => setTypeFilter([])}>Clear</Button>
              )}
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            <Label className="text-xs">Cost view</Label>
            <Select value={costView} onValueChange={(v: any) => setCostView(v)}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="average">Average</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={!hideZero} onCheckedChange={(c) => setHideZero(!c)} />
            <Label className="text-xs">Show zero stock</Label>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {lastRefreshed && (
              <span className="text-[10px] text-muted-foreground">
                Updated {formatDistanceToNow(lastRefreshed, { addSuffix: true })}
              </span>
            )}
            <Button size="sm" variant="outline" className="h-8" onClick={() => fetchData(true)} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={handleExport}>
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
          </div>
        </CardContent></Card>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/50 rounded-md">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress || "Loading…"}
          </div>
        )}

        {/* Table */}
        <Card>
          <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <SortHeader k="vendor" label="Vendor" />
                  <SortHeader k="productTitle" label="Product" />
                  <SortHeader k="variantTitle" label="Variant" />
                  <SortHeader k="sku" label="SKU" />
                  <SortHeader k="barcode" label="Barcode" />
                  <SortHeader k="location" label="Location" />
                  <SortHeader k="quantity" label="Qty" align="right" />
                  <SortHeader k="currentCost" label={costView === "current" ? "Cost" : "Avg Cost"} align="right" />
                  <SortHeader k="totalCost" label="Total Cost" align="right" />
                  <SortHeader k="retailPrice" label="Retail" align="right" />
                  <SortHeader k="totalRetail" label="Total Retail" align="right" />
                  <SortHeader k="margin" label="Margin %" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      No stock lines match the current filters.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((r, i) => {
                  const cost = costView === "current" ? r.currentCost : r.averageCost;
                  const totalCost = r.quantity * cost;
                  const totalRetail = r.quantity * r.retailPrice;
                  const margin = r.retailPrice > 0 ? ((r.retailPrice - cost) / r.retailPrice) * 100 : 0;
                  return (
                    <TableRow key={`${r.sku}-${r.location}-${i}`}>
                      <TableCell className="text-xs">{r.vendor}</TableCell>
                      <TableCell className="text-xs">{r.productTitle}</TableCell>
                      <TableCell className="text-xs">{r.variantTitle}</TableCell>
                      <TableCell className="text-xs font-mono">{r.sku}</TableCell>
                      <TableCell className="text-xs font-mono">{r.barcode}</TableCell>
                      <TableCell className="text-xs">{r.location}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{r.quantity}</TableCell>
                      <TableCell className="text-xs text-right">${cost.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">${totalCost.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">${r.retailPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">${totalRetail.toFixed(2)}</TableCell>
                      <TableCell className={cn("text-xs text-right", margin < 30 ? "text-destructive" : "text-foreground")}>
                        {margin.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {/* Sticky footer */}
              <tfoot className="sticky bottom-0 bg-card border-t-2 border-border">
                <tr className="font-semibold">
                  <td colSpan={6} className="p-3 text-xs">
                    Totals — {totals.skus.toLocaleString()} SKUs
                  </td>
                  <td className="p-3 text-xs text-right">{totals.units.toLocaleString()}</td>
                  <td className="p-3 text-xs text-right">—</td>
                  <td className="p-3 text-xs text-right">${totals.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-3 text-xs text-right">—</td>
                  <td className="p-3 text-xs text-right">${totals.retail.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-3 text-xs text-right">{totals.margin.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </Table>
          </div>
        </Card>
      </TabsContent>

      {/* ── HISTORY TAB ── */}
      <TabsContent value="history" className="space-y-3">
        <Card><CardContent className="p-3 flex items-center gap-3">
          <Label className="text-xs">Range</Label>
          <Select value={String(historyDays)} onValueChange={(v) => setHistoryDays(Number(v))}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
              <SelectItem value="365">Last 365 days</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
          </span>
        </CardContent></Card>

        {snapshots.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No snapshots yet. Refresh the report to capture one.
          </CardContent></Card>
        ) : (
          <Card><CardContent className="p-4">
            <ChartContainer
              config={{
                cost: { label: "Cost Value", color: "hsl(var(--primary))" },
                retail: { label: "Retail Value", color: "hsl(var(--accent))" },
              }}
              className="h-[300px]"
            >
              <LineChart data={snapshots}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="retail" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          </CardContent></Card>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default StockOnHandReport;
