import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Download,
  AlertTriangle,
  TrendingDown,
  DollarSign,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";

interface Row {
  variantId: string;
  vendor: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  location: string;
  available: number;
  retailPrice: number;
  avgDailySales: number;
  daysUntilDepletion: number;
  depletionDate: Date | null;
  lostRevenue: number;
}

type SortKey =
  | "vendor"
  | "productTitle"
  | "variantTitle"
  | "sku"
  | "location"
  | "available"
  | "daysUntilDepletion"
  | "depletionDate"
  | "lostRevenue";

type FlagFilter = "all" | "critical" | "low" | "watch";

const CACHE_KEY = "low_stock_report_cache_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedPayload {
  fetchedAt: number;
  rows: Row[];
}

function loadCache(): CachedPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    // revive dates
    parsed.rows.forEach((r) => {
      r.depletionDate = r.depletionDate ? new Date(r.depletionDate) : null;
    });
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(rows: Row[]) {
  try {
    const payload: CachedPayload = { fetchedAt: Date.now(), rows };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function flagFor(days: number): {
  label: string;
  emoji: string;
  className: string;
} {
  if (days <= 7)
    return {
      label: "Critical",
      emoji: "🔴",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    };
  if (days <= 14)
    return {
      label: "Low",
      emoji: "🟠",
      className: "bg-orange-500/15 text-orange-600 border-orange-500/30",
    };
  return {
    label: "Watch",
    emoji: "🟡",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
  };
}

function downloadCSV(rows: Row[]) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  const header = [
    "Vendor",
    "Product",
    "Variant",
    "SKU",
    "Location",
    "Available",
    "Avg daily sales",
    "Days until depletion",
    "Depletion date",
    "Reorder flag",
    "Retail price",
    "Lost revenue to date",
  ];
  const lines = rows.map((r) => {
    const f = flagFor(r.daysUntilDepletion);
    return [
      r.vendor,
      r.productTitle,
      r.variantTitle,
      r.sku,
      r.location,
      r.available,
      r.avgDailySales.toFixed(2),
      r.daysUntilDepletion === Infinity ? "∞" : r.daysUntilDepletion,
      r.depletionDate ? format(r.depletionDate, "yyyy-MM-dd") : "",
      f.label,
      r.retailPrice.toFixed(2),
      r.lostRevenue.toFixed(2),
    ]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",");
  });
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  addAuditEntry("Export CSV", "low-stock-report.csv");
}

const LowStockReport = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // filters
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("all");
  const [maxDays, setMaxDays] = useState<number>(30);
  const [zeroOnly, setZeroOnly] = useState(false);

  // sorting
  const [sortKey, setSortKey] = useState<SortKey>("daysUntilDepletion");
  const [sortAsc, setSortAsc] = useState(true);

  const fetchData = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadCache();
      if (cached) {
        setRows(cached.rows);
        setFetchedAt(cached.fetchedAt);
        return;
      }
    }

    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const since = subDays(new Date(), 30).toISOString();

      const [variantsRes, productsRes, inventoryRes, salesRes] =
        await Promise.all([
          supabase
            .from("variants")
            .select("id, sku, color, size, product_id, retail_price, quantity")
            .eq("user_id", user.id),
          supabase
            .from("products")
            .select("id, title, vendor")
            .eq("user_id", user.id),
          supabase
            .from("inventory")
            .select("variant_id, location, quantity")
            .eq("user_id", user.id),
          supabase
            .from("sales_data")
            .select("variant_id, quantity_sold, sold_at")
            .eq("user_id", user.id)
            .gte("sold_at", since),
        ]);

      const variants = variantsRes.data || [];
      const products = productsRes.data || [];
      const inventory = inventoryRes.data || [];
      const sales = salesRes.data || [];

      const productMap = new Map(products.map((p) => [p.id, p]));

      // sales aggregated per variant (last 30 days)
      const salesByVariant = new Map<string, number>();
      sales.forEach((s) => {
        if (!s.variant_id) return;
        salesByVariant.set(
          s.variant_id,
          (salesByVariant.get(s.variant_id) || 0) + (s.quantity_sold || 0),
        );
      });

      // group inventory by variant -> locations
      const invByVariant = new Map<
        string,
        { location: string; quantity: number }[]
      >();
      inventory.forEach((i) => {
        const arr = invByVariant.get(i.variant_id) || [];
        arr.push({ location: i.location || "Unknown", quantity: i.quantity });
        invByVariant.set(i.variant_id, arr);
      });

      const today = new Date();
      const out: Row[] = [];

      variants.forEach((v) => {
        const product = productMap.get(v.product_id);
        const totalSold30 = salesByVariant.get(v.id) || 0;
        const avgDailySales = totalSold30 / 30;
        const variantTitle =
          [v.color, v.size].filter(Boolean).join(" / ") || "—";

        const invRows = invByVariant.get(v.id) || [];
        // If no per-location inventory present, fall back to a single
        // synthetic "All locations" row using variants.quantity.
        const buckets =
          invRows.length > 0
            ? invRows
            : [{ location: "All locations", quantity: v.quantity || 0 }];

        buckets.forEach((b) => {
          const days =
            avgDailySales > 0 ? Math.floor(b.quantity / avgDailySales) : Infinity;
          // Only include rows that are at risk: <= 30 days OR zero stock
          if (days > 90 && b.quantity > 0) return;

          const depletionDate =
            days === Infinity
              ? null
              : new Date(today.getTime() + days * 86400000);

          // Lost revenue = days currently out-of-stock × avg daily sales × retail price.
          // We approximate "out-of-stock days" as max(0, -days) only when stock is 0
          // and there is sales velocity recorded. For currently in-stock rows it's 0.
          let lostRevenue = 0;
          if (b.quantity <= 0 && avgDailySales > 0) {
            // assume product has been out for the period since avg was measured;
            // conservative: 1 day of lost revenue per zero-stock row currently.
            lostRevenue = avgDailySales * (v.retail_price || 0);
          }

          out.push({
            variantId: v.id,
            vendor: product?.vendor || "—",
            productTitle: product?.title || "Unknown",
            variantTitle,
            sku: v.sku || "—",
            location: b.location,
            available: b.quantity,
            retailPrice: v.retail_price || 0,
            avgDailySales,
            daysUntilDepletion: days,
            depletionDate,
            lostRevenue,
          });
        });
      });

      setRows(out);
      saveCache(out);
      setFetchedAt(Date.now());
      addAuditEntry("Generate Report", "Low Stock Report");
    } catch (err) {
      console.error("[LowStockReport] fetch failed", err);
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const vendors = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.vendor).filter(Boolean))).sort();
  }, [rows]);

  const locations = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.location).filter(Boolean))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (locationFilter !== "all")
      list = list.filter((r) => r.location === locationFilter);
    if (vendorFilter.length > 0)
      list = list.filter((r) => vendorFilter.includes(r.vendor));
    if (flagFilter !== "all") {
      list = list.filter((r) => {
        const f = flagFor(r.daysUntilDepletion).label.toLowerCase();
        return f === flagFilter;
      });
    }
    list = list.filter((r) => {
      const d =
        r.daysUntilDepletion === Infinity ? 9999 : r.daysUntilDepletion;
      return d <= maxDays || r.available <= 0;
    });
    if (zeroOnly) list = list.filter((r) => r.available <= 0);

    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (av instanceof Date || bv instanceof Date) {
        cmp =
          (av ? (av as Date).getTime() : 0) -
          (bv ? (bv as Date).getTime() : 0);
      } else if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [rows, locationFilter, vendorFilter, flagFilter, maxDays, zeroOnly, sortKey, sortAsc]);

  const kpis = useMemo(() => {
    let critical = 0;
    let low = 0;
    let lost = 0;
    filtered.forEach((r) => {
      const f = flagFor(r.daysUntilDepletion).label;
      if (f === "Critical") critical += 1;
      if (f === "Low") low += 1;
      lost += r.lostRevenue;
    });
    return { critical, low, lost };
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortHeader = ({ id, children, align = "left" }: { id: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => toggleSort(id)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          sortKey === id ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          {fetchedAt
            ? `Last refreshed ${format(new Date(fetchedAt), "dd MMM HH:mm")} · cached for 1h`
            : "No data yet"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchData(true)}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCSV(filtered)}
            disabled={!filtered.length}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-xs font-medium">🔴 Critical (≤7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{kpis.critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
            <TrendingDown className="h-4 w-4 text-orange-500" />
            <CardTitle className="text-xs font-medium">🟠 Low (8–14d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-500">{kpis.low}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
            <DollarSign className="h-4 w-4 text-primary" />
            <CardTitle className="text-xs font-medium">💰 Lost revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              ${kpis.lost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <Label className="text-xs">Location</Label>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Vendor</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 mt-1 w-full justify-start text-xs font-normal"
                >
                  {vendorFilter.length === 0
                    ? "All vendors"
                    : `${vendorFilter.length} selected`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2 max-h-72 overflow-auto">
                {vendors.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">No vendors</p>
                )}
                {vendors.map((v) => (
                  <label
                    key={v}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={vendorFilter.includes(v)}
                      onCheckedChange={(checked) => {
                        setVendorFilter((prev) =>
                          checked
                            ? [...prev, v]
                            : prev.filter((x) => x !== v),
                        );
                      }}
                    />
                    <span className="truncate">{v}</span>
                  </label>
                ))}
                {vendorFilter.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full mt-1 h-7 text-xs"
                    onClick={() => setVendorFilter([])}
                  >
                    Clear
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs">Reorder flag</Label>
            <Select value={flagFilter} onValueChange={(v) => setFlagFilter(v as FlagFilter)}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">🔴 Critical only</SelectItem>
                <SelectItem value="low">🟠 Low</SelectItem>
                <SelectItem value="watch">🟡 Watch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="lg:col-span-1">
            <Label className="text-xs">
              Days until depletion: ≤ {maxDays}d
            </Label>
            <Slider
              value={[maxDays]}
              min={0}
              max={90}
              step={1}
              onValueChange={(v) => setMaxDays(v[0])}
              className="mt-3"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="zero-only"
              checked={zeroOnly}
              onCheckedChange={setZeroOnly}
            />
            <Label htmlFor="zero-only" className="text-xs cursor-pointer">
              Show zero stock only
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader id="vendor">Vendor</SortHeader>
                  <SortHeader id="productTitle">Product</SortHeader>
                  <SortHeader id="variantTitle">Variant</SortHeader>
                  <SortHeader id="sku">SKU</SortHeader>
                  <SortHeader id="location">Location</SortHeader>
                  <SortHeader id="available" align="right">Available</SortHeader>
                  <SortHeader id="daysUntilDepletion" align="right">Days left</SortHeader>
                  <SortHeader id="depletionDate">Depletion</SortHeader>
                  <TableHead>Flag</TableHead>
                  <SortHeader id="lostRevenue" align="right">Lost rev.</SortHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                      No items match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.slice(0, 500).map((r) => {
                  const f = flagFor(r.daysUntilDepletion);
                  return (
                    <TableRow key={`${r.variantId}-${r.location}`}>
                      <TableCell className="text-xs">{r.vendor}</TableCell>
                      <TableCell className="text-xs font-medium max-w-[220px] truncate">{r.productTitle}</TableCell>
                      <TableCell className="text-xs">{r.variantTitle}</TableCell>
                      <TableCell className="text-xs font-mono">{r.sku}</TableCell>
                      <TableCell className="text-xs">{r.location}</TableCell>
                      <TableCell className={cn("text-right text-xs font-medium", r.available <= 0 && "text-destructive")}>
                        {r.available}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.daysUntilDepletion === Infinity ? "∞" : r.daysUntilDepletion}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.depletionDate ? format(r.depletionDate, "dd MMM") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", f.className)}>
                          {f.emoji} {f.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.lostRevenue > 0
                          ? `$${r.lostRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > 500 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                Showing first 500 of {filtered.length}. Export CSV for full list.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LowStockReport;
