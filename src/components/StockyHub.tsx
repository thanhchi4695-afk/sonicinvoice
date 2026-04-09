import { useState, useMemo, useEffect } from "react";
import {
  ChevronLeft, Package, Users, FileText, TrendingUp, TrendingDown, ShoppingCart,
  AlertTriangle, ShoppingCart, BarChart3, ArrowRight, Zap, Shield,
  Clock, DollarSign, Tag, Truck, RefreshCw, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCostHistory } from "@/components/InvoiceFlow";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface InventoryProduct {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  variantSku?: string;
  vendor: string;
  currentStock: number;
  velocity: number;
  rop: number;
  daysOfStock: number;
  lostRevenuePerDay: number;
  price: number;
  costPrice?: number;
  abcClass?: "A" | "B" | "C";
  lastSoldAt?: string;
}

type HealthScore = "green" | "amber" | "red";

interface ProductHealth {
  product: InventoryProduct;
  score: HealthScore;
  reasons: string[];
  daysSinceLastSale: number;
  isDeadStock: boolean;
  reorderUrgency: "none" | "soon" | "now" | "overdue";
  marginPct: number;
}

interface DashboardStats {
  totalProducts: number;
  totalValue: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  deadStockCount: number;
  deadStockValue: number;
  outOfStockCount: number;
  lowStockCount: number;
  reorderNowCount: number;
  avgMargin: number;
  supplierCount: number;
  poCount: number;
}

/* ─── Helpers ─── */

function loadProducts(): InventoryProduct[] {
  try {
    const stored = localStorage.getItem("inventory_demo_products");
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function loadSuppliers(): any[] {
  try { return JSON.parse(localStorage.getItem("inventory_suppliers") || "[]"); } catch { return []; }
}

function loadPOs(): any[] {
  try { return JSON.parse(localStorage.getItem("inventory_pos") || "[]"); } catch { return []; }
}

function calcHealthScore(p: InventoryProduct, deadStockDays: number): ProductHealth {
  const reasons: string[] = [];
  let score: HealthScore = "green";

  const daysSinceLastSale = p.lastSoldAt
    ? Math.floor((Date.now() - new Date(p.lastSoldAt).getTime()) / 86400000)
    : p.velocity > 0 ? 0 : 999;

  const isDeadStock = daysSinceLastSale >= deadStockDays && p.currentStock > 0;
  const marginPct = p.costPrice && p.costPrice > 0 ? ((p.price - p.costPrice) / p.price) * 100 : -1;

  // Out of stock
  if (p.currentStock <= 0 && p.velocity > 0) {
    score = "red";
    reasons.push("Out of stock — losing revenue");
  }

  // Dead stock
  if (isDeadStock) {
    score = "red";
    reasons.push(`Not sold in ${daysSinceLastSale}+ days — consider markdown`);
  }

  // Low stock — below reorder point
  if (p.currentStock > 0 && p.currentStock <= p.rop) {
    if (score === "green") score = "amber";
    reasons.push(`Below reorder point (${p.rop} units)`);
  }

  // Low margin
  if (marginPct >= 0 && marginPct < 30) {
    if (score === "green") score = "amber";
    reasons.push(`Low margin: ${marginPct.toFixed(0)}%`);
  }

  // Overstocked
  if (p.velocity > 0 && p.daysOfStock > 90) {
    if (score === "green") score = "amber";
    reasons.push(`Overstocked: ${p.daysOfStock} days of supply`);
  }

  // Healthy
  if (reasons.length === 0) {
    reasons.push("Healthy — selling well, good stock levels");
  }

  // Reorder urgency
  let reorderUrgency: ProductHealth["reorderUrgency"] = "none";
  if (p.currentStock <= 0 && p.velocity > 0) reorderUrgency = "overdue";
  else if (p.currentStock > 0 && p.currentStock <= p.rop * 0.5) reorderUrgency = "now";
  else if (p.currentStock > 0 && p.currentStock <= p.rop) reorderUrgency = "soon";

  return { product: p, score, reasons, daysSinceLastSale, isDeadStock, reorderUrgency, marginPct };
}

const fmt = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/* ─── Component ─── */

interface StockyHubProps {
  onBack: () => void;
  onNavigate: (target: string) => void;
}

export default function StockyHub({ onBack, onNavigate }: StockyHubProps) {
  const [deadStockDays, setDeadStockDays] = useState(60);
  const [tab, setTab] = useState("overview");

  const products = useMemo(() => loadProducts(), []);
  const suppliers = useMemo(() => loadSuppliers(), []);
  const purchaseOrders = useMemo(() => loadPOs(), []);
  const costHistory = useMemo(() => getCostHistory(), []);

  const healthData = useMemo(() =>
    products.map((p) => calcHealthScore(p, deadStockDays)),
    [products, deadStockDays]
  );

  const stats: DashboardStats = useMemo(() => {
    const totalValue = products.reduce((s, p) => s + p.currentStock * (p.costPrice || 0), 0);
    const greenCount = healthData.filter((h) => h.score === "green").length;
    const amberCount = healthData.filter((h) => h.score === "amber").length;
    const redCount = healthData.filter((h) => h.score === "red").length;
    const deadStock = healthData.filter((h) => h.isDeadStock);
    const deadStockValue = deadStock.reduce((s, h) => s + h.product.currentStock * (h.product.costPrice || 0), 0);
    const outOfStock = healthData.filter((h) => h.product.currentStock <= 0 && h.product.velocity > 0);
    const lowStock = healthData.filter((h) => h.reorderUrgency !== "none");
    const reorderNow = healthData.filter((h) => h.reorderUrgency === "now" || h.reorderUrgency === "overdue");
    const margins = healthData.filter((h) => h.marginPct >= 0);
    const avgMargin = margins.length > 0 ? margins.reduce((s, h) => s + h.marginPct, 0) / margins.length : 0;

    return {
      totalProducts: products.length,
      totalValue,
      greenCount, amberCount, redCount,
      deadStockCount: deadStock.length,
      deadStockValue,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      reorderNowCount: reorderNow.length,
      avgMargin,
      supplierCount: suppliers.length,
      poCount: purchaseOrders.length,
    };
  }, [products, healthData, suppliers, purchaseOrders]);

  const scoreDot = (score: HealthScore) => (
    <span className={cn("inline-block w-2.5 h-2.5 rounded-full", {
      "bg-green-500": score === "green",
      "bg-yellow-500": score === "amber",
      "bg-red-500": score === "red",
    })} />
  );

  /* ─── Module quick nav cards ─── */
  const modules = [
    { id: "inventory_dashboard", label: "Inventory Dashboard", desc: "Real-time health overview", icon: <BarChart3 className="w-5 h-5" />, count: null, target: "inventory_dashboard" },
    { id: "product_health", label: "Product Health Scores", desc: "Green / Amber / Red scoring", icon: <Sparkles className="w-5 h-5" />, count: null, target: "product_health" },
    { id: "purchase_orders", label: "Purchase Orders", desc: "Track incoming stock", icon: <FileText className="w-5 h-5" />, count: stats.poCount, target: "purchase_orders" },
    { id: "suppliers", label: "Supplier Intelligence", desc: "Spend, margins & history", icon: <Users className="w-5 h-5" />, count: stats.supplierCount, target: "suppliers" },
    { id: "stock_monitor", label: "Stock Monitor", desc: "Low stock alerts", icon: <AlertTriangle className="w-5 h-5" />, count: stats.outOfStockCount, target: "stock_monitor" },
    { id: "reorder", label: "Reorder Intelligence", desc: "AI-powered reorder timing", icon: <Truck className="w-5 h-5" />, count: stats.reorderNowCount, target: "reorder" },
    { id: "margin_protection", label: "Margin Protection", desc: "Block below-cost sales", icon: <Shield className="w-5 h-5" />, count: null, target: "margin_protection" },
    { id: "markdown_ladder", label: "Markdown Ladder", desc: "Auto discount progression", icon: <Tag className="w-5 h-5" />, count: null, target: "markdown_ladder" },
    { id: "restock_analytics", label: "Restock Analytics", desc: "Best sellers & slow movers", icon: <BarChart3 className="w-5 h-5" />, count: null, target: "restock_analytics" },
    { id: "order_sync", label: "Shopify Order Sync", desc: "Import sales for velocity data", icon: <ShoppingCart className="w-5 h-5" />, count: null, target: "order_sync" },
    { id: "migration", label: "Stocky Migration", desc: "Import from Stocky", icon: <RefreshCw className="w-5 h-5" />, count: null, target: "stocky_migration" },
  ];

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" /> Inventory Intelligence
          </h2>
          <p className="text-xs text-muted-foreground">
            Your complete Stocky replacement — powered by AI
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          <Sparkles className="w-3 h-3 mr-1" /> Stocky Upgrade
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full mb-4">
          <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
          <TabsTrigger value="health" className="flex-1 text-xs">Health Scores</TabsTrigger>
          <TabsTrigger value="dead" className="flex-1 text-xs">Dead Stock</TabsTrigger>
          <TabsTrigger value="modules" className="flex-1 text-xs">Modules</TabsTrigger>
        </TabsList>

        {/* ─── Overview ─── */}
        <TabsContent value="overview" className="space-y-4">
          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Products Tracked</p>
              <p className="text-2xl font-bold font-mono-data text-primary">{stats.totalProducts}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Inventory Value</p>
              <p className="text-2xl font-bold font-mono-data">{fmt(stats.totalValue)}</p>
              <p className="text-[10px] text-muted-foreground">at cost</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Avg Margin</p>
              <p className="text-2xl font-bold font-mono-data text-success">{stats.avgMargin.toFixed(0)}%</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Suppliers</p>
              <p className="text-2xl font-bold font-mono-data">{stats.supplierCount}</p>
            </Card>
          </div>

          {/* Health traffic lights */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Inventory Health
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center py-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 font-mono-data">{stats.greenCount}</p>
                <p className="text-xs text-green-700 dark:text-green-400">Healthy</p>
              </div>
              <div className="text-center py-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400 font-mono-data">{stats.amberCount}</p>
                <p className="text-xs text-yellow-700 dark:text-yellow-400">Attention</p>
              </div>
              <div className="text-center py-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-3xl font-bold text-red-600 dark:text-red-400 font-mono-data">{stats.redCount}</p>
                <p className="text-xs text-red-700 dark:text-red-400">Critical</p>
              </div>
            </div>
          </Card>

          {/* Alerts */}
          {(stats.outOfStockCount > 0 || stats.deadStockCount > 0 || stats.reorderNowCount > 0) && (
            <Card className="p-4 border-l-4 border-l-destructive">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" /> Action Required
              </h3>
              <div className="space-y-2">
                {stats.outOfStockCount > 0 && (
                  <button onClick={() => onNavigate("stock_monitor")} className="flex items-center justify-between w-full py-1.5 text-sm hover:text-primary transition-colors">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      {stats.outOfStockCount} products out of stock
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {stats.reorderNowCount > 0 && (
                  <button onClick={() => onNavigate("reorder")} className="flex items-center justify-between w-full py-1.5 text-sm hover:text-primary transition-colors">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-yellow-500" />
                      {stats.reorderNowCount} products need reordering now
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {stats.deadStockCount > 0 && (
                  <button onClick={() => setTab("dead")} className="flex items-center justify-between w-full py-1.5 text-sm hover:text-primary transition-colors">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      {stats.deadStockCount} dead stock items ({fmt(stats.deadStockValue)} tied up)
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </Card>
          )}

          {/* Quick nav */}
          <div className="grid grid-cols-2 gap-3">
            {modules.slice(0, 4).map((m) => (
              <button
                key={m.id}
                onClick={() => onNavigate(m.target)}
                className="bg-card border border-border rounded-lg p-4 text-left hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-primary">{m.icon}</span>
                  {m.count !== null && m.count > 0 && (
                    <Badge variant="secondary" className="text-[10px] ml-auto">{m.count}</Badge>
                  )}
                </div>
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.desc}</p>
              </button>
            ))}
          </div>
        </TabsContent>

        {/* ─── Health Scores ─── */}
        <TabsContent value="health" className="space-y-3">
          {healthData.length === 0 ? (
            <Card className="p-8 text-center">
              <Package className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No inventory data yet. Connect your Shopify store or import from Stocky.
              </p>
              <Button variant="outline" className="mt-3" onClick={() => onNavigate("stocky_migration")}>
                <RefreshCw className="w-4 h-4 mr-2" /> Import from Stocky
              </Button>
            </Card>
          ) : (
            healthData
              .sort((a, b) => {
                const order: Record<HealthScore, number> = { red: 0, amber: 1, green: 2 };
                return order[a.score] - order[b.score];
              })
              .map((h) => (
                <Card key={h.product.variantId} className="p-3">
                  <div className="flex items-start gap-3">
                    {scoreDot(h.score)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{h.product.productTitle}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {h.product.variantTitle} • {h.product.variantSku} • {h.product.vendor}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {h.reasons.map((r, i) => (
                          <span key={i} className={cn("text-[10px] px-2 py-0.5 rounded-full", {
                            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400": h.score === "green",
                            "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400": h.score === "amber",
                            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400": h.score === "red",
                          })}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-mono-data font-semibold">{h.product.currentStock}</p>
                      <p className="text-[10px] text-muted-foreground">in stock</p>
                      {h.marginPct >= 0 && (
                        <p className={cn("text-[10px] font-mono-data", h.marginPct >= 50 ? "text-success" : h.marginPct >= 30 ? "text-warning" : "text-destructive")}>
                          {h.marginPct.toFixed(0)}% margin
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))
          )}
        </TabsContent>

        {/* ─── Dead Stock ─── */}
        <TabsContent value="dead" className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" /> Dead Stock Detection
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Threshold:</span>
                <select
                  value={deadStockDays}
                  onChange={(e) => setDeadStockDays(parseInt(e.target.value))}
                  className="text-xs rounded-md border border-input bg-background px-2 py-1"
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={120}>120 days</option>
                </select>
              </div>
            </div>

            {stats.deadStockCount > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mb-3">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {stats.deadStockCount} products haven't sold in {deadStockDays}+ days
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  {fmt(stats.deadStockValue)} tied up in dead stock at cost
                </p>
              </div>
            )}
          </Card>

          {healthData
            .filter((h) => h.isDeadStock)
            .sort((a, b) => (b.product.currentStock * (b.product.costPrice || 0)) - (a.product.currentStock * (a.product.costPrice || 0)))
            .map((h) => {
              const value = h.product.currentStock * (h.product.costPrice || 0);
              return (
                <Card key={h.product.variantId} className="p-3 border-l-4 border-l-destructive">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{h.product.productTitle}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {h.product.variantTitle} • {h.product.variantSku}
                      </p>
                      <p className="text-[10px] text-destructive mt-0.5">
                        No sales in {h.daysSinceLastSale}+ days
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono-data">{h.product.currentStock} units</p>
                      <p className="text-xs font-mono-data text-destructive">{fmt(value)} at cost</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs shrink-0"
                      onClick={() => onNavigate("markdown_ladder")}
                    >
                      <Tag className="w-3 h-3 mr-1" /> Markdown
                    </Button>
                  </div>
                </Card>
              );
            })}

          {stats.deadStockCount === 0 && (
            <Card className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-semibold">No dead stock detected!</p>
              <p className="text-xs text-muted-foreground">All products have sold within {deadStockDays} days</p>
            </Card>
          )}
        </TabsContent>

        {/* ─── Modules ─── */}
        <TabsContent value="modules" className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2">
            All Stocky features — plus AI upgrades you won't find anywhere else.
          </p>

          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => onNavigate(m.target)}
              className="w-full bg-card border border-border rounded-lg p-4 text-left hover:border-primary/50 transition-colors flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                {m.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.desc}</p>
              </div>
              {m.count !== null && m.count > 0 && (
                <Badge variant="secondary" className="text-xs">{m.count}</Badge>
              )}
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}

          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">AI Advantage</p>
                <p className="text-xs text-muted-foreground">
                  Sonic Invoice goes beyond Stocky with AI-powered health scoring,
                  dead stock detection, automated markdowns, and margin protection.
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
