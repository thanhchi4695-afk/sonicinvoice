import { useState, useMemo } from "react";
import { ChevronLeft, Download, TrendingUp, Package, Users, DollarSign, BarChart3, PieChart, LineChart, Award, Filter, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getStoreConfig } from "@/lib/prompt-builder";

// ── Types ──────────────────────────────────────────────────
interface InvoiceRecord {
  id: string;
  date: string;
  brand: string;
  productName: string;
  productType: string;
  cost: number;
  rrp: number | null;
  qty: number;
  matched: boolean;
  deliveryStatus: "on_time" | "late" | "overdue";
  invoiceAccurate: boolean;
}

// ── Sample data (reads from localStorage if available) ────
function loadAnalyticsData(): InvoiceRecord[] {
  try {
    const raw = localStorage.getItem("analytics_invoice_data");
    if (raw) return JSON.parse(raw);
  } catch {}
  // Demo data for first-time users
  const config = getStoreConfig();
  const sym = config.currencySymbol || "$";
  return [
    { id: "1", date: "2026-01-15", brand: "Seafolly", productName: "Active Multi Strap Bralette", productType: "Bikini Tops", cost: 48, rrp: 129.95, qty: 6, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "2", date: "2026-01-15", brand: "Seafolly", productName: "Active Hipster", productType: "Bikini Bottoms", cost: 38, rrp: 89.95, qty: 8, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "3", date: "2026-01-20", brand: "Bond Eye", productName: "Mara One Piece", productType: "One Pieces", cost: 62, rrp: 219, qty: 4, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "4", date: "2026-02-01", brand: "Jantzen", productName: "Mood Bandeau Blouson Singlet", productType: "Bikini Tops", cost: 43.5, rrp: 79.95, qty: 5, matched: true, deliveryStatus: "late", invoiceAccurate: false },
    { id: "5", date: "2026-02-01", brand: "Jantzen", productName: "Sahara Kaftan", productType: "Clothing", cost: 38, rrp: 89.95, qty: 3, matched: true, deliveryStatus: "late", invoiceAccurate: true },
    { id: "6", date: "2026-02-10", brand: "Bond Eye", productName: "Splice One Piece", productType: "One Pieces", cost: 65, rrp: 229, qty: 3, matched: false, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "7", date: "2026-02-15", brand: "Sea Level", productName: "Spinnaker Cross Front Top", productType: "Bikini Tops", cost: 42, rrp: 109.95, qty: 6, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "8", date: "2026-03-01", brand: "Baku", productName: "Rococco D-DD Bikini Top", productType: "Bikini Tops", cost: 45, rrp: 119.95, qty: 4, matched: true, deliveryStatus: "overdue", invoiceAccurate: true },
    { id: "9", date: "2026-03-05", brand: "Sea Level", productName: "Eco Essentials Cross Front", productType: "One Pieces", cost: 55, rrp: 179.95, qty: 5, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "10", date: "2026-03-10", brand: "Seafolly", productName: "Mira One Piece", productType: "One Pieces", cost: 58, rrp: 199.95, qty: 4, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
    { id: "11", date: "2026-03-12", brand: "Baku", productName: "Boho Bikini Bottom", productType: "Bikini Bottoms", cost: 32, rrp: 79.95, qty: 6, matched: true, deliveryStatus: "overdue", invoiceAccurate: true },
    { id: "12", date: "2026-03-15", brand: "Rhythm", productName: "Rustic Oversized Tee", productType: "Clothing", cost: 28, rrp: 59.95, qty: 8, matched: true, deliveryStatus: "on_time", invoiceAccurate: true },
  ];
}

// ── Helpers ────────────────────────────────────────────────
const fmt = (n: number, sym: string) => `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDec = (n: number, sym: string) => `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const MARGIN_COLORS = {
  low: "bg-destructive/15 text-destructive",
  mid: "bg-warning/15 text-warning",
  high: "bg-success/15 text-success",
};
const marginClass = (m: number) => m < 0.35 ? MARGIN_COLORS.low : m < 0.5 ? MARGIN_COLORS.mid : MARGIN_COLORS.high;
const marginFlag = (m: number) => m < 0.35 ? "🔴 low" : m < 0.5 ? "⚠ watch" : "✓ healthy";

// ── Component ──────────────────────────────────────────────
const AnalyticsPanel = () => {
  const config = getStoreConfig();
  const sym = config.currencySymbol || "$";
  const data = useMemo(loadAnalyticsData, []);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let d = data;
    if (brandFilter) d = d.filter(r => r.brand === brandFilter);
    if (typeFilter) d = d.filter(r => r.productType === typeFilter);
    return d;
  }, [data, brandFilter, typeFilter]);

  // ── KPIs ─────────────────────────────────────────────────
  const totalSpend = filtered.reduce((s, r) => s + r.cost * r.qty, 0);
  const totalProducts = filtered.reduce((s, r) => s + r.qty, 0);
  const uniqueBrands = new Set(filtered.map(r => r.brand)).size;
  const avgCost = totalProducts > 0 ? totalSpend / totalProducts : 0;

  // ── Spend by brand ──────────────────────────────────────
  const brandSpend = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => { map[r.brand] = (map[r.brand] || 0) + r.cost * r.qty; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);
  const maxBrandSpend = brandSpend.length > 0 ? brandSpend[0][1] : 1;

  // ── Product type breakdown ──────────────────────────────
  const typeBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => { map[r.productType] = (map[r.productType] || 0) + r.qty; });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: total > 0 ? count / total : 0 }));
  }, [filtered]);

  // ── Monthly trend ───────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const map: Record<string, { spend: number; units: number }> = {};
    filtered.forEach(r => {
      const m = r.date.slice(0, 7);
      if (!map[m]) map[m] = { spend: 0, units: 0 };
      map[m].spend += r.cost * r.qty;
      map[m].units += r.qty;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({
      label: new Date(month + "-01").toLocaleString("default", { month: "short" }),
      spend: v.spend,
      avgCost: v.units > 0 ? v.spend / v.units : 0,
    }));
  }, [filtered]);
  const maxMonthSpend = Math.max(...monthlyTrend.map(m => m.spend), 1);

  // ── Margin analysis ─────────────────────────────────────
  const marginData = useMemo(() => {
    return filtered.filter(r => r.rrp && r.rrp > 0).map(r => ({
      ...r,
      margin: (r.rrp! - r.cost) / r.rrp!,
    })).sort((a, b) => a.margin - b.margin);
  }, [filtered]);
  const avgMargin = marginData.length > 0 ? marginData.reduce((s, r) => s + r.margin, 0) / marginData.length : 0;

  // ── Brand scorecard ─────────────────────────────────────
  const brandScores = useMemo(() => {
    const brands = [...new Set(data.map(r => r.brand))];
    return brands.map(brand => {
      const items = data.filter(r => r.brand === brand);
      const matchRate = items.filter(r => r.matched).length / items.length;
      const onTimeRate = items.filter(r => r.deliveryStatus === "on_time").length / items.length;
      const withRrp = items.filter(r => r.rrp && r.rrp > 0);
      const avgM = withRrp.length > 0 ? withRrp.reduce((s, r) => s + (r.rrp! - r.cost) / r.rrp!, 0) / withRrp.length : 0;
      const accuracyRate = items.filter(r => r.invoiceAccurate).length / items.length;

      const matchScore = Math.round(matchRate * 25);
      const deliveryScore = Math.round(onTimeRate * 25);
      const marginScore = Math.min(25, Math.round(avgM * 25 / 0.7));
      const accuracyScore = Math.round(accuracyRate * 25);
      const total = matchScore + deliveryScore + marginScore + accuracyScore;

      const deliveryLabel = onTimeRate >= 0.9 ? "On time" : onTimeRate >= 0.5 ? "Sometimes late" : "Overdue";
      return { brand, total, matchRate, deliveryLabel, avgMargin: avgM, accuracyRate, onTimeRate };
    }).sort((a, b) => b.total - a.total);
  }, [data]);

  // ── Donut chart SVG ─────────────────────────────────────
  const donutColors = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(142 71% 45%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)", "hsl(262 83% 58%)"];
  const DonutChart = ({ segments }: { segments: { name: string; pct: number }[] }) => {
    let offset = 0;
    const r = 60, cx = 80, cy = 80, circ = 2 * Math.PI * r;
    return (
      <svg viewBox="0 0 160 160" className="w-40 h-40 mx-auto">
        {segments.map((s, i) => {
          const dash = s.pct * circ;
          const gap = circ - dash;
          const rot = offset * 360 - 90;
          offset += s.pct;
          return (
            <circle key={i} r={r} cx={cx} cy={cy} fill="none" stroke={donutColors[i % donutColors.length]}
              strokeWidth="24" strokeDasharray={`${dash} ${gap}`}
              transform={`rotate(${rot} ${cx} ${cy})`}
              className="cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setTypeFilter(typeFilter === s.name ? null : s.name)} />
          );
        })}
        <circle r="48" cx={cx} cy={cy} fill="hsl(var(--card))" />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-foreground text-xs font-bold">{totalProducts}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>products</text>
      </svg>
    );
  };

  // ── Export ──────────────────────────────────────────────
  const handleExport = () => {
    const lines = [
      `Analytics Report — ${config.name || "My Store"}`,
      `Generated: ${new Date().toLocaleDateString()}`,
      "",
      "KPIs",
      `Total Spend,${totalSpend}`,
      `Products,${totalProducts}`,
      `Brands,${uniqueBrands}`,
      `Avg Cost,${avgCost.toFixed(2)}`,
      "",
      "Spend by Brand",
      "Brand,Spend,% of Total",
      ...brandSpend.map(([b, s]) => `${b},${s.toFixed(2)},${pct(s / totalSpend)}`),
      "",
      "Margin Analysis",
      "Product,Brand,Cost,RRP,Margin",
      ...marginData.map(r => `${r.productName},${r.brand},${r.cost},${r.rrp},${pct(r.margin)}`),
      "",
      "Brand Scorecard",
      "Brand,Score,Match Rate,Delivery,Margin,Accuracy",
      ...brandScores.map(b => `${b.brand},${b.total}/100,${pct(b.matchRate)},${b.deliveryLabel},${pct(b.avgMargin)},${pct(b.accuracyRate)}`),
      "",
      `Generated by SupplierSync`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `analytics_${config.name?.replace(/\s/g, "_") || "report"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const clearFilters = () => { setBrandFilter(null); setTypeFilter(null); };
  const hasFilter = brandFilter || typeFilter;

  return (
    <div className="pb-24 px-4 pt-4 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">📊 Analytics</h1>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
          <Download className="w-4 h-4" /> Export
        </Button>
      </div>

      {/* Active filters */}
      {hasFilter && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {brandFilter && (
            <button onClick={() => setBrandFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary border border-primary/30">
              {brandFilter} <X className="w-3 h-3" />
            </button>
          )}
          {typeFilter && (
            <button onClick={() => setTypeFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-secondary/15 text-secondary border border-secondary/30">
              {typeFilter} <X className="w-3 h-3" />
            </button>
          )}
          <button onClick={clearFilters} className="text-xs text-muted-foreground underline">Clear all</button>
        </div>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: DollarSign, label: "Total spend", value: fmt(totalSpend, sym), sub: "this period" },
          { icon: Package, label: "Products", value: totalProducts.toString(), sub: "bought" },
          { icon: Users, label: "Brands", value: uniqueBrands.toString(), sub: "ordered from" },
          { icon: TrendingUp, label: "Avg cost", value: fmtDec(avgCost, sym), sub: "per product" },
        ].map((kpi, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
            </div>
            <div className="text-xl font-bold text-foreground">{kpi.value}</div>
            <div className="text-[11px] text-muted-foreground">{kpi.sub}</div>
          </Card>
        ))}
      </div>

      {/* Spend by Brand */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Spend by Brand</h2>
        </div>
        <div className="space-y-2">
          {brandSpend.map(([brand, spend]) => (
            <button key={brand} onClick={() => setBrandFilter(brandFilter === brand ? null : brand)}
              className={`w-full text-left rounded-lg p-2 transition-colors ${brandFilter === brand ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50"}`}>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="font-medium text-foreground">{brand}</span>
                <span className="text-muted-foreground">{fmt(spend, sym)} ({pct(spend / totalSpend)})</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(spend / maxBrandSpend) * 100}%` }} />
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Product Type Donut */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <PieChart className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Product Type Breakdown</h2>
        </div>
        <DonutChart segments={typeBreakdown} />
        <div className="mt-3 grid grid-cols-2 gap-1">
          {typeBreakdown.map((t, i) => (
            <button key={t.name} onClick={() => setTypeFilter(typeFilter === t.name ? null : t.name)}
              className={`flex items-center gap-2 text-xs p-1 rounded transition-colors ${typeFilter === t.name ? "bg-primary/10" : "hover:bg-muted/50"}`}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: donutColors[i % donutColors.length] }} />
              <span className="text-foreground truncate">{t.name}</span>
              <span className="text-muted-foreground ml-auto">{Math.round(t.pct * 100)}%</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Monthly Trend */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <LineChart className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Cost Trend Over Time</h2>
        </div>
        {monthlyTrend.length > 1 ? (
          <div className="relative h-40">
            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map(p => (
              <div key={p} className="absolute left-10 right-0 border-t border-border/40" style={{ bottom: `${p * 100}%` }}>
                <span className="absolute -left-10 -top-2 text-[9px] text-muted-foreground w-9 text-right">{fmt(maxMonthSpend * p, sym)}</span>
              </div>
            ))}
            {/* Bars */}
            <div className="absolute left-10 right-0 bottom-0 top-0 flex items-end justify-around gap-1">
              {monthlyTrend.map((m, i) => (
                <div key={i} className="flex flex-col items-center flex-1">
                  <div className="w-full max-w-[40px] rounded-t bg-primary transition-all" style={{ height: `${(m.spend / maxMonthSpend) * 100}%` }} />
                  <span className="text-[9px] text-muted-foreground mt-1">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-8">Not enough data for trend chart. Process more invoices to see trends.</p>
        )}
        <div className="flex items-center gap-4 mt-2 justify-center">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-3 h-0.5 bg-primary inline-block rounded" /> Total spend</span>
        </div>
      </Card>

      {/* Margin Analysis */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Margin Analysis</h2>
        </div>
        {marginData.length > 0 ? (
          <>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Product</th>
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Brand</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Cost</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">RRP</th>
                    <th className="text-right py-1.5 font-medium text-muted-foreground">Margin</th>
                    <th className="text-center py-1.5 font-medium text-muted-foreground">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {marginData.map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 text-foreground truncate max-w-[120px]">{r.productName}</td>
                      <td className="py-1.5 text-muted-foreground">{r.brand}</td>
                      <td className="py-1.5 text-right text-foreground">{fmtDec(r.cost, sym)}</td>
                      <td className="py-1.5 text-right text-foreground">{fmtDec(r.rrp!, sym)}</td>
                      <td className="py-1.5 text-right font-medium text-foreground">{pct(r.margin)}</td>
                      <td className="py-1.5 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${marginClass(r.margin)}`}>
                          {marginFlag(r.margin)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-muted-foreground text-center">
              Average margin: <span className="font-semibold text-foreground">{pct(avgMargin)}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-6">No RRP data available yet. Process invoices with price lookup enabled.</p>
        )}
      </Card>

      {/* Brand Scorecard */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Award className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">Brand Performance Scorecard</h2>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 font-medium text-muted-foreground">Brand</th>
                <th className="text-center py-1.5 font-medium text-muted-foreground">Score</th>
                <th className="text-center py-1.5 font-medium text-muted-foreground">Match</th>
                <th className="text-center py-1.5 font-medium text-muted-foreground">Delivery</th>
                <th className="text-center py-1.5 font-medium text-muted-foreground">Margin</th>
                <th className="text-center py-1.5 font-medium text-muted-foreground">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {brandScores.map((b, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1.5 font-medium text-foreground">{b.brand}</td>
                  <td className="py-1.5 text-center">
                    <span className={`font-bold ${b.total >= 80 ? "text-success" : b.total >= 60 ? "text-warning" : "text-destructive"}`}>
                      {b.total}/100
                    </span>
                  </td>
                  <td className="py-1.5 text-center text-muted-foreground">{pct(b.matchRate)}</td>
                  <td className="py-1.5 text-center text-muted-foreground">{b.deliveryLabel}</td>
                  <td className="py-1.5 text-center text-muted-foreground">{pct(b.avgMargin)}</td>
                  <td className="py-1.5 text-center">
                    {b.accuracyRate >= 0.9 ? "✓" : "⚠"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Footer */}
      <p className="text-[10px] text-muted-foreground text-center">
        Generated by SupplierSync · suppliersync.app
      </p>
    </div>
  );
};

export default AnalyticsPanel;
