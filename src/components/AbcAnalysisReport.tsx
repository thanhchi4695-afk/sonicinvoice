import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import LocationFilter from "./LocationFilter";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Grade = "A" | "B" | "C" | "U";

interface Row {
  variantId: string;
  productId: string | null;
  vendor: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  revenue: number;
  unitsSold: number;
  available: number;
  retailPrice: number;
  marginPct: number;
  grade: Grade;
  pctOfTotal: number; // % of total revenue
  cumulativePct: number; // cumulative % of revenue (sorted desc)
  byLocation: Record<string, number>;
}

const PERIOD_OPTIONS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
];

const GRADE_COLORS: Record<Grade, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  B: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  C: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  U: "bg-muted text-muted-foreground border-border",
};

const GRADE_ICON: Record<Grade, string> = { A: "🅰", B: "🅱", C: "🅲", U: "ⓤ" };

function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(","),
    ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
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

const THRESHOLD_LS_KEY = "abc_thresholds_v1";
type Thresholds = { a: number; b: number };
function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(THRESHOLD_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { a: 80, b: 15 };
}

export default function AbcAnalysisReport() {
  const { selected: globalLocSelected, selectedLocation: globalLocObj } = useShopifyLocations();

  const [periodDays, setPeriodDays] = useState<number>(365);
  const [thresholds, setThresholds] = useState<Thresholds>(loadThresholds);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [gradeFilter, setGradeFilter] = useState<Grade[]>([]);

  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // ── Load + compute ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const since = new Date(Date.now() - periodDays * 86400_000).toISOString();

      const [{ data: variants }, { data: products }, { data: sales }, { data: inventory }] = await Promise.all([
        supabase.from("variants").select("id, product_id, sku, color, size, retail_price, cost, quantity").eq("user_id", user.id),
        supabase.from("products").select("id, title, vendor").eq("user_id", user.id),
        supabase.from("sales_data").select("variant_id, quantity_sold, revenue, sold_at").eq("user_id", user.id).gte("sold_at", since),
        supabase.from("inventory").select("variant_id, location, quantity").eq("user_id", user.id),
      ]);

      const productMap = new Map((products || []).map((p) => [p.id, p]));

      // aggregate sales per variant
      const revByVariant = new Map<string, number>();
      const qtyByVariant = new Map<string, number>();
      (sales || []).forEach((s) => {
        if (!s.variant_id) return;
        revByVariant.set(s.variant_id, (revByVariant.get(s.variant_id) || 0) + (Number(s.revenue) || 0));
        qtyByVariant.set(s.variant_id, (qtyByVariant.get(s.variant_id) || 0) + (s.quantity_sold || 0));
      });

      // location-aware inventory
      const invByVariant = new Map<string, Record<string, number>>();
      (inventory || []).forEach((i) => {
        const m = invByVariant.get(i.variant_id) || {};
        const loc = i.location || "Unknown";
        m[loc] = (m[loc] || 0) + (i.quantity || 0);
        invByVariant.set(i.variant_id, m);
      });

      // sort variants by revenue desc and assign cumulative
      const sortedVariants = (variants || []).slice().sort((a, b) => {
        return (revByVariant.get(b.id) || 0) - (revByVariant.get(a.id) || 0);
      });
      const totalRevenue = Array.from(revByVariant.values()).reduce((a, b) => a + b, 0);

      const aThreshold = thresholds.a / 100;
      const bThreshold = (thresholds.a + thresholds.b) / 100;

      let cum = 0;
      const out: Row[] = sortedVariants.map((v) => {
        const product = productMap.get(v.product_id);
        const rev = revByVariant.get(v.id) || 0;
        const qty = qtyByVariant.get(v.id) || 0;
        const byLoc = invByVariant.get(v.id) || {};
        const totalAvail =
          Object.values(byLoc).reduce((a, b) => a + b, 0) || (v.quantity || 0);

        let grade: Grade;
        if (rev <= 0) {
          grade = "U";
        } else {
          cum += rev;
          const pct = totalRevenue > 0 ? cum / totalRevenue : 0;
          if (pct <= aThreshold) grade = "A";
          else if (pct <= bThreshold) grade = "B";
          else grade = "C";
        }
        const cumulativePct = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
        const pctOfTotal = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
        const marginPct =
          (v.retail_price || 0) > 0
            ? (((v.retail_price || 0) - (v.cost || 0)) / (v.retail_price || 0)) * 100
            : 0;

        return {
          variantId: v.id,
          productId: v.product_id,
          vendor: product?.vendor || "—",
          productTitle: product?.title || "—",
          variantTitle: [v.color, v.size].filter(Boolean).join(" / ") || "—",
          sku: v.sku || "",
          revenue: rev,
          unitsSold: qty,
          available: totalAvail,
          retailPrice: v.retail_price || 0,
          marginPct,
          grade,
          pctOfTotal,
          cumulativePct,
          byLocation: byLoc,
        };
      });

      setRawRows(out);
      setRefreshedAt(new Date());

      // ── Write back to product_abc_grades (best-effort, cached cap) ──
      const writeRows = out.slice(0, 5000).map((r) => ({
        user_id: user.id,
        variant_id: r.variantId,
        product_id: r.productId,
        grade: r.grade,
        period_days: periodDays,
        revenue: r.revenue,
        units_sold: r.unitsSold,
      }));
      if (writeRows.length > 0) {
        const { error: upsertErr } = await supabase
          .from("product_abc_grades")
          .upsert(writeRows, { onConflict: "user_id,variant_id,period_days" });
        if (upsertErr) console.warn("[AbcAnalysisReport] grade upsert failed", upsertErr);
      }
    } catch (err) {
      console.error("[AbcAnalysisReport] load failed", err);
      toast.error("Failed to load ABC report");
    } finally {
      setLoading(false);
    }
  }, [periodDays, thresholds]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filters ──
  const vendors = useMemo(() => {
    return Array.from(new Set(rawRows.map((r) => r.vendor))).filter(Boolean).sort();
  }, [rawRows]);

  const filteredRows = useMemo(() => {
    let out = rawRows;
    if (vendorFilter.length > 0) out = out.filter((r) => vendorFilter.includes(r.vendor));
    if (gradeFilter.length > 0) out = out.filter((r) => gradeFilter.includes(r.grade));
    if (globalLocSelected !== "all" && globalLocObj) {
      out = out.filter((r) => (r.byLocation[globalLocObj.name] || 0) > 0);
    }
    return out;
  }, [rawRows, vendorFilter, gradeFilter, globalLocSelected, globalLocObj]);

  // ── Summary stats by grade (over filtered) ──
  const summary = useMemo(() => {
    const init = (): { count: number; revenue: number; retailValue: number } => ({
      count: 0,
      revenue: 0,
      retailValue: 0,
    });
    const totals: Record<Grade, ReturnType<typeof init>> = {
      A: init(),
      B: init(),
      C: init(),
      U: init(),
    };
    let totalRev = 0;
    filteredRows.forEach((r) => {
      totals[r.grade].count += 1;
      totals[r.grade].revenue += r.revenue;
      totals[r.grade].retailValue += r.available * r.retailPrice;
      totalRev += r.revenue;
    });
    return { totals, totalRev };
  }, [filteredRows]);

  // ── Pareto chart data (use all sorted rows for canonical curve) ──
  const paretoData = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => b.revenue - a.revenue);
    const total = sorted.reduce((s, r) => s + r.revenue, 0);
    if (total <= 0 || sorted.length === 0) return [];
    let cumRev = 0;
    return sorted.map((r, i) => {
      cumRev += r.revenue;
      return {
        skuPct: ((i + 1) / sorted.length) * 100,
        revPct: (cumRev / total) * 100,
      };
    });
  }, [filteredRows]);

  const fmt$ = (n: number) =>
    "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(parseInt(v))}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <LocationFilter />
          </div>

          {/* Vendor filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Vendor {vendorFilter.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{vendorFilter.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2 max-h-72 overflow-y-auto">
              <div className="space-y-1">
                {vendors.map((v) => (
                  <label key={v} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                    <Checkbox
                      checked={vendorFilter.includes(v)}
                      onCheckedChange={(c) =>
                        setVendorFilter((f) => (c ? [...f, v] : f.filter((x) => x !== v)))
                      }
                    />
                    {v}
                  </label>
                ))}
                {vendorFilter.length > 0 && (
                  <Button size="sm" variant="ghost" className="w-full mt-1" onClick={() => setVendorFilter([])}>
                    Clear
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Grade filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                Grade {gradeFilter.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{gradeFilter.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2">
              <div className="space-y-1">
                {(["A", "B", "C", "U"] as Grade[]).map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                    <Checkbox
                      checked={gradeFilter.includes(g)}
                      onCheckedChange={(c) =>
                        setGradeFilter((f) => (c ? [...f, g] : f.filter((x) => x !== g)))
                      }
                    />
                    Grade {g}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Threshold settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1">
                <Settings className="h-3.5 w-3.5" />
                Thresholds
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3">
              <div className="text-xs font-medium">ABC thresholds (% of revenue)</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="w-16 text-xs">Grade A</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={thresholds.a}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, a: Math.min(99, Math.max(1, Number(e.target.value) || 0)) }))
                    }
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-16 text-xs">Grade B</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={thresholds.b}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, b: Math.min(99, Math.max(1, Number(e.target.value) || 0)) }))
                    }
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-16 text-xs">Grade C</Label>
                  <Input
                    value={Math.max(0, 100 - thresholds.a - thresholds.b)}
                    disabled
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  try {
                    localStorage.setItem(THRESHOLD_LS_KEY, JSON.stringify(thresholds));
                  } catch {}
                  toast.success("Thresholds saved");
                }}
              >
                Save thresholds
              </Button>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-2">
            {refreshedAt && (
              <span className="text-xs text-muted-foreground">
                Refreshed {refreshedAt.toLocaleTimeString()}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCSV(
                  filteredRows.map((r) => ({
                    Grade: r.grade,
                    Vendor: r.vendor,
                    Product: r.productTitle,
                    Variant: r.variantTitle,
                    SKU: r.sku,
                    Revenue: r.revenue.toFixed(2),
                    "% of Revenue": r.pctOfTotal.toFixed(2),
                    "Units Sold": r.unitsSold,
                    "Cumulative %": r.cumulativePct.toFixed(2),
                    Available: r.available,
                    "Retail Price": r.retailPrice.toFixed(2),
                    "Margin %": r.marginPct.toFixed(1),
                  })),
                  `abc-analysis-${periodDays}d.csv`,
                )
              }
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {(["A", "B", "C", "U"] as Grade[]).map((g) => {
          const s = summary.totals[g];
          const pctOfRev = summary.totalRev > 0 ? (s.revenue / summary.totalRev) * 100 : 0;
          return (
            <Card key={g} className={cn("border", GRADE_COLORS[g].split(" ").find((x) => x.startsWith("border-")))}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-2xl">{GRADE_ICON[g]}</div>
                  <Badge variant="outline" className={cn("text-xs", GRADE_COLORS[g])}>Grade {g}</Badge>
                </div>
                <div className="text-2xl font-bold mt-2">{s.count.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">SKUs</span></div>
                {g !== "U" ? (
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmtPct(pctOfRev)} of revenue
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-1">Unsold in period</div>
                )}
                <div className="text-sm font-medium mt-1">
                  {fmt$(s.retailValue)} <span className="text-xs text-muted-foreground">retail</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pareto chart */}
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-2">Pareto curve — cumulative revenue by SKU</div>
          {paretoData.length > 0 ? (
            <div className="h-[280px]">
              <ResponsiveContainer>
                <AreaChart data={paretoData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="paretoFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="skuPct"
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    label={{ value: "% of SKUs", position: "insideBottom", offset: -2, fontSize: 11 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    label={{ value: "% of revenue", angle: -90, position: "insideLeft", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => `${v.toFixed(1)}%`}
                    labelFormatter={(l: number) => `${Number(l).toFixed(1)}% of SKUs`}
                  />
                  <Area type="monotone" dataKey="revPct" stroke="hsl(var(--primary))" fill="url(#paretoFill)" strokeWidth={2} />
                  <ReferenceLine y={thresholds.a} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: `A ${thresholds.a}%`, position: "right", fontSize: 11 }} />
                  <ReferenceLine y={thresholds.a + thresholds.b} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: `B ${thresholds.a + thresholds.b}%`, position: "right", fontSize: 11 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">No revenue data in this period.</div>
          )}
        </CardContent>
      </Card>

      {/* Detailed table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-16">Grade</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">% Total</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Cum %</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.slice(0, 500).map((r) => (
                  <TableRow key={r.variantId}>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs", GRADE_COLORS[r.grade])}>
                        {r.grade}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.vendor}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate" title={r.productTitle}>
                      {r.productTitle}
                    </TableCell>
                    <TableCell className="text-xs">{r.variantTitle}</TableCell>
                    <TableCell className="text-xs font-mono">{r.sku}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{fmt$(r.revenue)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtPct(r.pctOfTotal)}</TableCell>
                    <TableCell className="text-right text-xs">{r.unitsSold}</TableCell>
                    <TableCell className="text-right text-xs">{fmtPct(r.cumulativePct)}</TableCell>
                    <TableCell className="text-right text-xs">{r.available}</TableCell>
                    <TableCell className="text-right text-xs">{fmt$(r.retailPrice)}</TableCell>
                    <TableCell className="text-right text-xs">{r.marginPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filteredRows.length > 500 && (
            <div className="p-2 text-xs text-muted-foreground text-center border-t">
              Showing first 500 of {filteredRows.length.toLocaleString()} variants. Export CSV for the full set.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
