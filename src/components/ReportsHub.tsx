import { useState, useMemo, useCallback } from "react";
import { ArrowLeft, Download, Calendar, TrendingUp, Package, Users, ShoppingCart, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { format, subDays, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ReportId = "valuation" | "ageing" | "supplier" | "sales" | "movement";

interface ReportsHubProps {
  onBack: () => void;
}

const REPORT_CARDS: { id: ReportId; title: string; desc: string; icon: React.ElementType }[] = [
  { id: "valuation", title: "Inventory Valuation", desc: "On hand × cost per product, grouped by type", icon: Package },
  { id: "ageing", title: "Stock Ageing", desc: "Variants grouped by days since last sale", icon: TrendingUp },
  { id: "supplier", title: "Supplier Performance", desc: "On-time delivery, fill rate & cost trends", icon: Users },
  { id: "sales", title: "Sales by Product", desc: "Quantity sold & revenue per variant (last 30d)", icon: ShoppingCart },
  { id: "movement", title: "Stock Movement", desc: "All inventory transactions per SKU", icon: ArrowRightLeft },
];

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--accent))",
  "hsl(180 60% 45%)",
  "hsl(340 65% 50%)",
  "hsl(45 90% 50%)",
];

// ── CSV export helper ──
function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  addAuditEntry("Export CSV", `${filename}`);
}

// ── Date range picker ──
function DateRangePicker({ from, to, onChange }: { from: Date; to: Date; onChange: (f: Date, t: Date) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {format(from, "dd MMM")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarPicker mode="single" selected={from} onSelect={(d) => d && onChange(d, to)} className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
      <span className="text-xs text-muted-foreground">→</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {format(to, "dd MMM")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarPicker mode="single" selected={to} onSelect={(d) => d && onChange(from, d)} className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
      <Select onValueChange={(v) => { const d = parseInt(v); onChange(subDays(new Date(), d), new Date()); }}>
        <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="Quick" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="7">7 days</SelectItem>
          <SelectItem value="30">30 days</SelectItem>
          <SelectItem value="60">60 days</SelectItem>
          <SelectItem value="90">90 days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ═══════════════════════════════════
// REPORT 1 — Inventory Valuation
// ═══════════════════════════════════
function InventoryValuationReport() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: variants } = await supabase.from("variants").select("quantity, cost, product_id").eq("user_id", user.id);
    const { data: products } = await supabase.from("products").select("id, title, product_type, vendor").eq("user_id", user.id);

    const productMap = new Map((products || []).map(p => [p.id, p]));
    const grouped: Record<string, { type: string; totalValue: number; totalUnits: number; items: number }> = {};

    (variants || []).forEach(v => {
      const prod = productMap.get(v.product_id);
      const type = prod?.product_type || "Uncategorised";
      if (!grouped[type]) grouped[type] = { type, totalValue: 0, totalUnits: 0, items: 0 };
      grouped[type].totalValue += (v.quantity || 0) * (v.cost || 0);
      grouped[type].totalUnits += v.quantity || 0;
      grouped[type].items += 1;
    });

    setData(Object.values(grouped).sort((a, b) => b.totalValue - a.totalValue));
    setLoaded(true);
    setLoading(false);
  }, []);

  if (!loaded) return (
    <div className="text-center py-8">
      <Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Generate Report"}</Button>
    </div>
  );

  const totalValue = data.reduce((s, d) => s + d.totalValue, 0);
  const chartConfig = Object.fromEntries(data.map((d, i) => [d.type, { label: d.type, color: CHART_COLORS[i % CHART_COLORS.length] }]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-sm">Total: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Badge>
        <Button size="sm" variant="outline" onClick={() => downloadCSV(data.map(d => ({ Type: d.type, Units: d.totalUnits, Value: d.totalValue.toFixed(2), Variants: d.items })), "inventory-valuation.csv")}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
      </div>
      <ChartContainer config={chartConfig} className="h-[250px]">
        <BarChart data={data}><XAxis dataKey="type" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="totalValue" name="Value ($)" radius={[4, 4, 0, 0]}>{data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart>
      </ChartContainer>
      <Table>
        <TableHeader><TableRow><TableHead>Product Type</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Variants</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map(d => (
            <TableRow key={d.type}><TableCell className="font-medium">{d.type}</TableCell><TableCell className="text-right">{d.totalUnits}</TableCell><TableCell className="text-right">{d.items}</TableCell><TableCell className="text-right">${d.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════
// REPORT 2 — Stock Ageing
// ═══════════════════════════════════
function StockAgeingReport() {
  const [data, setData] = useState<{ bucket: string; count: number; value: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: variants } = await supabase.from("variants").select("id, quantity, cost, retail_price").eq("user_id", user.id);
    const { data: sales } = await supabase.from("sales_data").select("variant_id, sold_at").eq("user_id", user.id).order("sold_at", { ascending: false });

    const lastSaleMap = new Map<string, string>();
    (sales || []).forEach(s => { if (s.variant_id && !lastSaleMap.has(s.variant_id)) lastSaleMap.set(s.variant_id, s.sold_at); });

    const buckets: Record<string, { count: number; value: number }> = {
      "0–30 days": { count: 0, value: 0 },
      "31–60 days": { count: 0, value: 0 },
      "61–90 days": { count: 0, value: 0 },
      "90+ days": { count: 0, value: 0 },
      "Never sold": { count: 0, value: 0 },
    };

    const now = new Date();
    (variants || []).filter(v => (v.quantity || 0) > 0).forEach(v => {
      const lastSale = lastSaleMap.get(v.id);
      const val = (v.quantity || 0) * (v.cost || 0);
      if (!lastSale) { buckets["Never sold"].count += v.quantity; buckets["Never sold"].value += val; return; }
      const days = differenceInDays(now, new Date(lastSale));
      if (days <= 30) { buckets["0–30 days"].count += v.quantity; buckets["0–30 days"].value += val; }
      else if (days <= 60) { buckets["31–60 days"].count += v.quantity; buckets["31–60 days"].value += val; }
      else if (days <= 90) { buckets["61–90 days"].count += v.quantity; buckets["61–90 days"].value += val; }
      else { buckets["90+ days"].count += v.quantity; buckets["90+ days"].value += val; }
    });

    setData(Object.entries(buckets).map(([bucket, d]) => ({ bucket, ...d })));
    setLoaded(true);
    setLoading(false);
  }, []);

  if (!loaded) return <div className="text-center py-8"><Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Generate Report"}</Button></div>;

  const chartConfig = Object.fromEntries(data.map((d, i) => [d.bucket, { label: d.bucket, color: CHART_COLORS[i % CHART_COLORS.length] }]));

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => downloadCSV(data.map(d => ({ Bucket: d.bucket, Units: d.count, Value: d.value.toFixed(2) })), "stock-ageing.csv")}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button></div>
      <ChartContainer config={chartConfig} className="h-[250px]">
        <PieChart><Pie data={data} dataKey="value" nameKey="bucket" cx="50%" cy="50%" outerRadius={80} label={({ bucket, percent }) => `${bucket} ${(percent * 100).toFixed(0)}%`}>{data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><ChartTooltip content={<ChartTooltipContent />} /></PieChart>
      </ChartContainer>
      <Table>
        <TableHeader><TableRow><TableHead>Age Bucket</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>{data.map(d => <TableRow key={d.bucket}><TableCell>{d.bucket}</TableCell><TableCell className="text-right">{d.count}</TableCell><TableCell className="text-right">${d.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell></TableRow>)}</TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════
// REPORT 3 — Supplier Performance
// ═══════════════════════════════════
function SupplierPerformanceReport() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dateFrom, setDateFrom] = useState(subDays(new Date(), 90));
  const [dateTo, setDateTo] = useState(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: pos } = await supabase.from("purchase_orders").select("id, supplier_name, expected_date, status, created_at, updated_at").eq("user_id", user.id);
    const { data: lines } = await supabase.from("purchase_order_lines").select("purchase_order_id, expected_qty, received_qty, expected_cost, actual_cost").eq("user_id", user.id);

    const linesByPo = new Map<string, typeof lines>();
    (lines || []).forEach(l => {
      const arr = linesByPo.get(l.purchase_order_id) || [];
      arr.push(l);
      linesByPo.set(l.purchase_order_id, arr);
    });

    const supplierMap: Record<string, { name: string; total: number; onTime: number; orderedQty: number; receivedQty: number; totalCost: number }> = {};

    (pos || []).forEach(po => {
      const name = po.supplier_name;
      if (!supplierMap[name]) supplierMap[name] = { name, total: 0, onTime: 0, orderedQty: 0, receivedQty: 0, totalCost: 0 };
      supplierMap[name].total += 1;

      const isReceived = po.status === "received" || po.status === "closed";
      if (isReceived && po.expected_date) {
        const receivedDate = new Date(po.updated_at);
        const expectedDate = new Date(po.expected_date);
        if (receivedDate <= expectedDate) supplierMap[name].onTime += 1;
      }

      const poLines = linesByPo.get(po.id) || [];
      poLines.forEach(l => {
        supplierMap[name].orderedQty += l.expected_qty || 0;
        supplierMap[name].receivedQty += l.received_qty || 0;
        supplierMap[name].totalCost += (l.actual_cost || l.expected_cost || 0) * (l.received_qty || 0);
      });
    });

    setData(Object.values(supplierMap).sort((a, b) => b.total - a.total));
    setLoaded(true);
    setLoading(false);
  }, []);

  if (!loaded) return (
    <div className="space-y-4">
      <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      <div className="text-center py-4"><Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Generate Report"}</Button></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => downloadCSV(data.map(d => ({ Supplier: d.name, POs: d.total, "On-Time": d.total > 0 ? `${((d.onTime / d.total) * 100).toFixed(0)}%` : "N/A", "Fill Rate": d.orderedQty > 0 ? `${((d.receivedQty / d.orderedQty) * 100).toFixed(0)}%` : "N/A", "Total Cost": d.totalCost.toFixed(2) })), "supplier-performance.csv")}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button></div>
      <Table>
        <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">POs</TableHead><TableHead className="text-right">On-Time %</TableHead><TableHead className="text-right">Fill Rate %</TableHead><TableHead className="text-right">Total Cost</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map(d => (
            <TableRow key={d.name}>
              <TableCell className="font-medium">{d.name}</TableCell>
              <TableCell className="text-right">{d.total}</TableCell>
              <TableCell className="text-right">{d.total > 0 ? `${((d.onTime / d.total) * 100).toFixed(0)}%` : "—"}</TableCell>
              <TableCell className="text-right">{d.orderedQty > 0 ? `${((d.receivedQty / d.orderedQty) * 100).toFixed(0)}%` : "—"}</TableCell>
              <TableCell className="text-right">${d.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════
// REPORT 4 — Sales by Product
// ═══════════════════════════════════
function SalesByProductReport() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dateFrom, setDateFrom] = useState(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(new Date());
  const [sortKey, setSortKey] = useState<"revenue" | "qty">("revenue");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: sales } = await supabase.from("sales_data").select("variant_id, product_id, quantity_sold, revenue, cost_of_goods, sold_at").eq("user_id", user.id).gte("sold_at", dateFrom.toISOString()).lte("sold_at", dateTo.toISOString());
    const { data: products } = await supabase.from("products").select("id, title").eq("user_id", user.id);
    const { data: variants } = await supabase.from("variants").select("id, sku, color, size, product_id").eq("user_id", user.id);

    const prodMap = new Map((products || []).map(p => [p.id, p]));
    const varMap = new Map((variants || []).map(v => [v.id, v]));

    const agg: Record<string, { title: string; sku: string; qty: number; revenue: number; cogs: number }> = {};
    (sales || []).forEach(s => {
      const key = s.variant_id || s.product_id || "unknown";
      if (!agg[key]) {
        const variant = s.variant_id ? varMap.get(s.variant_id) : null;
        const prod = variant ? prodMap.get(variant.product_id) : (s.product_id ? prodMap.get(s.product_id) : null);
        agg[key] = { title: prod?.title || "Unknown", sku: variant?.sku || "—", qty: 0, revenue: 0, cogs: 0 };
      }
      agg[key].qty += s.quantity_sold || 0;
      agg[key].revenue += s.revenue || 0;
      agg[key].cogs += s.cost_of_goods || 0;
    });

    setData(Object.values(agg).sort((a, b) => sortKey === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
    setLoaded(true);
    setLoading(false);
  }, [dateFrom, dateTo, sortKey]);

  const sorted = useMemo(() => [...data].sort((a, b) => sortKey === "revenue" ? b.revenue - a.revenue : b.qty - a.qty), [data, sortKey]);
  const chartData = sorted.slice(0, 10);
  const chartConfig = Object.fromEntries(chartData.map((d, i) => [d.sku, { label: d.title.slice(0, 20), color: CHART_COLORS[i % CHART_COLORS.length] }]));

  if (!loaded) return (
    <div className="space-y-4">
      <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      <div className="text-center py-4"><Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Generate Report"}</Button></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="revenue">By Revenue</SelectItem><SelectItem value="qty">By Quantity</SelectItem></SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => downloadCSV(sorted.map(d => ({ Product: d.title, SKU: d.sku, Qty: d.qty, Revenue: d.revenue.toFixed(2), COGS: d.cogs.toFixed(2) })), "sales-by-product.csv")}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
      </div>
      {chartData.length > 0 && (
        <ChartContainer config={chartConfig} className="h-[250px]">
          <BarChart data={chartData}><XAxis dataKey="sku" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="revenue" name="Revenue ($)" radius={[4, 4, 0, 0]}>{chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart>
        </ChartContainer>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">COGS</TableHead></TableRow></TableHeader>
        <TableBody>
          {sorted.map((d, i) => (
            <TableRow key={i}><TableCell className="font-medium max-w-[180px] truncate">{d.title}</TableCell><TableCell className="text-xs">{d.sku}</TableCell><TableCell className="text-right">{d.qty}</TableCell><TableCell className="text-right">${d.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell><TableCell className="text-right">${d.cogs.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════
// REPORT 5 — Stock Movement
// ═══════════════════════════════════
function StockMovementReport() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dateFrom, setDateFrom] = useState(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const movements: { date: string; sku: string; type: string; qty: number; reason: string; location: string }[] = [];

    // Inventory adjustments
    const { data: adj } = await supabase.from("inventory_adjustments").select("*").eq("user_id", user.id).gte("adjusted_at", format(dateFrom, "yyyy-MM-dd")).lte("adjusted_at", format(dateTo, "yyyy-MM-dd")).order("adjusted_at", { ascending: false });
    (adj || []).forEach(a => movements.push({ date: a.adjusted_at, sku: a.sku || a.barcode || "—", type: "Adjustment", qty: a.adjustment_qty, reason: a.reason || "", location: a.location }));

    // PO receives
    const { data: poLines } = await supabase.from("purchase_order_lines").select("sku, received_qty, created_at, purchase_order_id").eq("user_id", user.id).gt("received_qty", 0);
    (poLines || []).forEach(l => movements.push({ date: l.created_at.split("T")[0], sku: l.sku || "—", type: "PO Receive", qty: l.received_qty, reason: `PO`, location: "" }));

    // Transfer order lines
    const { data: txLines } = await supabase.from("transfer_order_lines").select("sku, shipped_qty, received_qty, created_at").eq("user_id", user.id);
    (txLines || []).forEach(l => {
      if (l.shipped_qty > 0) movements.push({ date: l.created_at.split("T")[0], sku: l.sku || "—", type: "Transfer Out", qty: -l.shipped_qty, reason: "", location: "" });
      if (l.received_qty > 0) movements.push({ date: l.created_at.split("T")[0], sku: l.sku || "—", type: "Transfer In", qty: l.received_qty, reason: "", location: "" });
    });

    // Sales
    const { data: sales } = await supabase.from("sales_data").select("variant_id, quantity_sold, sold_at").eq("user_id", user.id).gte("sold_at", dateFrom.toISOString()).lte("sold_at", dateTo.toISOString());
    const { data: variants } = await supabase.from("variants").select("id, sku").eq("user_id", user.id);
    const skuMap = new Map((variants || []).map(v => [v.id, v.sku]));
    (sales || []).forEach(s => movements.push({ date: s.sold_at.split("T")[0], sku: s.variant_id ? (skuMap.get(s.variant_id) || "—") : "—", type: "Sale", qty: -(s.quantity_sold || 0), reason: "", location: "" }));

    movements.sort((a, b) => b.date.localeCompare(a.date));
    setData(movements);
    setLoaded(true);
    setLoading(false);
  }, [dateFrom, dateTo]);

  if (!loaded) return (
    <div className="space-y-4">
      <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      <div className="text-center py-4"><Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Generate Report"}</Button></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{data.length} movements</Badge>
        <Button size="sm" variant="outline" onClick={() => downloadCSV(data.map(d => ({ Date: d.date, SKU: d.sku, Type: d.type, Qty: d.qty, Reason: d.reason, Location: d.location })), "stock-movement.csv")}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
      </div>
      <div className="max-h-[400px] overflow-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>SKU</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.slice(0, 200).map((d, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{d.date}</TableCell>
                <TableCell className="text-xs font-mono">{d.sku}</TableCell>
                <TableCell><Badge variant={d.qty > 0 ? "default" : "secondary"} className="text-[10px]">{d.type}</Badge></TableCell>
                <TableCell className={cn("text-right font-medium", d.qty > 0 ? "text-green-600" : "text-red-500")}>{d.qty > 0 ? "+" : ""}{d.qty}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data.length > 200 && <p className="text-xs text-muted-foreground text-center">Showing first 200 of {data.length}. Export CSV for full data.</p>}
    </div>
  );
}

// ═══════════════════════════════════
// MAIN HUB
// ═══════════════════════════════════
const ReportsHub = ({ onBack }: ReportsHubProps) => {
  const [activeReport, setActiveReport] = useState<ReportId | null>(null);

  if (activeReport) {
    const card = REPORT_CARDS.find(c => c.id === activeReport)!;
    const Icon = card.icon;
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setActiveReport(null)}><ArrowLeft className="h-4 w-4 mr-1" />Reports</Button>
          <Icon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{card.title}</h2>
        </div>
        {activeReport === "valuation" && <InventoryValuationReport />}
        {activeReport === "ageing" && <StockAgeingReport />}
        {activeReport === "supplier" && <SupplierPerformanceReport />}
        {activeReport === "sales" && <SalesByProductReport />}
        {activeReport === "movement" && <StockMovementReport />}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <h1 className="text-xl font-bold">Reports</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {REPORT_CARDS.map(card => {
          const Icon = card.icon;
          return (
            <Card key={card.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setActiveReport(card.id)}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="text-sm">{card.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent><CardDescription>{card.desc}</CardDescription></CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ReportsHub;
