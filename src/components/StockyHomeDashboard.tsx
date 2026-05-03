import { useState, useEffect, useMemo } from "react";
import {
  Package, FileText, AlertTriangle, ClipboardCheck, DollarSign,
  Plus, ArrowDownToLine, ScanBarcode, TrendingUp, TrendingDown,
  ArrowRight, Loader2, ToggleLeft, ToggleRight, GraduationCap, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import ConditionBuilderShowcase from "@/components/ConditionBuilderShowcase";

/* ─── Types ─── */

interface PendingPO {
  id: string;
  po_number: string;
  supplier_name: string;
  expected_date: string | null;
  status: string;
  total_cost: number;
}

interface LowStockItem {
  variantId: string;
  productTitle: string;
  sku: string | null;
  onHand: number;
  reorderPoint: number;
}

interface RecentStocktake {
  id: string;
  location: string;
  counted_at: string;
  status: string;
  lineCount: number;
  varianceCount: number;
}

interface StockMovement {
  date: string;
  in: number;
  out: number;
}

interface StockyHomeDashboardProps {
  onNavigate: (flow: string) => void;
  onSwitchToClassic: () => void;
}

export default function StockyHomeDashboard({ onNavigate, onSwitchToClassic }: StockyHomeDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [pendingPOs, setPendingPOs] = useState<PendingPO[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [recentStocktakes, setRecentStocktakes] = useState<RecentStocktake[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [totalVariants, setTotalVariants] = useState(0);
  const [stockMovement, setStockMovement] = useState<StockMovement[]>([]);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch all data in parallel
      const [posRes, variantsRes, reorderRes, stocktakesRes, adjustmentsRes, salesRes] = await Promise.all([
        supabase.from("purchase_orders").select("id, po_number, supplier_name, expected_date, status, total_cost")
          .eq("user_id", user.id)
          .in("status", ["sent", "partial", "awaiting"])
          .order("expected_date", { ascending: true })
          .limit(10),
        supabase.from("variants").select("id, sku, quantity, cost, product_id")
          .eq("user_id", user.id),
        supabase.from("product_reorder_settings").select("variant_id, min_order_qty, safety_stock_days, lead_time_days")
          .eq("user_id", user.id),
        supabase.from("stocktakes").select("id, location, counted_at, status")
          .eq("user_id", user.id)
          .order("counted_at", { ascending: false })
          .limit(3),
        supabase.from("inventory_adjustments").select("adjusted_at, adjustment_qty")
          .eq("user_id", user.id)
          .gte("adjusted_at", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
        supabase.from("sales_data").select("sold_at, quantity_sold")
          .eq("user_id", user.id)
          .gte("sold_at", new Date(Date.now() - 30 * 86400000).toISOString()),
      ]);

      // Pending POs
      setPendingPOs((posRes.data || []) as PendingPO[]);

      // Inventory value
      const variants = variantsRes.data || [];
      setTotalVariants(variants.length);
      const totalVal = variants.reduce((s, v) => s + (v.quantity || 0) * (v.cost || 0), 0);
      setInventoryValue(totalVal);

      // Products for low stock (need product titles)
      const productIds = [...new Set(variants.map(v => v.product_id))];
      let productMap: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: products } = await supabase.from("products").select("id, title")
          .eq("user_id", user.id)
          .in("id", productIds.slice(0, 100));
        if (products) products.forEach(p => { productMap[p.id] = p.title; });
      }

      // Low stock detection
      const reorderSettings = reorderRes.data || [];
      const reorderMap = new Map(reorderSettings.map(r => [r.variant_id, r]));
      const lowStockItems: LowStockItem[] = [];
      for (const v of variants) {
        const settings = reorderMap.get(v.id);
        const reorderPoint = settings ? settings.min_order_qty : 5; // default reorder point
        if (v.quantity <= reorderPoint && v.quantity >= 0) {
          lowStockItems.push({
            variantId: v.id,
            productTitle: productMap[v.product_id] || "Unknown Product",
            sku: v.sku,
            onHand: v.quantity,
            reorderPoint,
          });
        }
      }
      setLowStock(lowStockItems.sort((a, b) => a.onHand - b.onHand).slice(0, 10));

      // Recent stocktakes with line counts
      const stocktakes = stocktakesRes.data || [];
      const stocktakeDetails: RecentStocktake[] = [];
      for (const st of stocktakes) {
        const { count: lineCount } = await supabase.from("stocktake_lines").select("*", { count: "exact", head: true }).eq("stocktake_id", st.id);
        const { count: varianceCount } = await supabase.from("stocktake_lines").select("*", { count: "exact", head: true }).eq("stocktake_id", st.id).neq("variance", 0);
        stocktakeDetails.push({
          ...st,
          lineCount: lineCount || 0,
          varianceCount: varianceCount || 0,
        });
      }
      setRecentStocktakes(stocktakeDetails);

      // Stock movement chart (last 30 days)
      const movementMap = new Map<string, { in: number; out: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        movementMap.set(d, { in: 0, out: 0 });
      }
      (adjustmentsRes.data || []).forEach(a => {
        const d = a.adjusted_at;
        const entry = movementMap.get(d);
        if (entry) {
          if (a.adjustment_qty > 0) entry.in += a.adjustment_qty;
          else entry.out += Math.abs(a.adjustment_qty);
        }
      });
      (salesRes.data || []).forEach(s => {
        const d = new Date(s.sold_at).toISOString().slice(0, 10);
        const entry = movementMap.get(d);
        if (entry) entry.out += s.quantity_sold;
      });
      setStockMovement([...movementMap.entries()].map(([date, vals]) => ({
        date: date.slice(5), // MM-DD
        in: vals.in,
        out: vals.out,
      })));

    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-display">Inventory Dashboard</h1>
          <p className="text-xs text-muted-foreground">Your Stocky replacement — all the workflows you need</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSwitchToClassic} className="text-xs gap-1.5">
          <ToggleLeft className="w-4 h-4" /> Classic View
        </Button>
      </div>

      {/* ── Margin Guardian / Condition Builder showcase ─── */}
      <ConditionBuilderShowcase />

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: "New PO", icon: Plus, flow: "purchase_orders", color: "bg-primary/10 text-primary" },
          { label: "Receive Stock", icon: ArrowDownToLine, flow: "quick_receive", color: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400" },
          { label: "New Stocktake", icon: ClipboardCheck, flow: "stocktake_module", color: "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
          { label: "Scan Barcode", icon: ScanBarcode, flow: "scan_mode", color: "bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
          { label: "Guardian", icon: Shield, flow: "__route:/rules", color: "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
        ].map((action) => (
          <button
            key={action.label}
            onClick={() => {
              if (action.flow.startsWith("__route:")) {
                window.location.href = action.flow.slice("__route:".length);
              } else {
                onNavigate(action.flow);
              }
            }}
            className={`flex items-center gap-2 p-3 rounded-xl ${action.color} font-medium text-sm transition-transform active:scale-95`}
          >
            <action.icon className="w-5 h-5" />
            {action.label}
          </button>
        ))}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <DollarSign className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-lg font-bold">{fmt(inventoryValue)}</p>
          <p className="text-[10px] text-muted-foreground">Inventory Value</p>
        </Card>
        <Card className="p-3 text-center">
          <Package className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-lg font-bold">{totalVariants.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">Total Variants</p>
        </Card>
        <Card className="p-3 text-center">
          <FileText className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-lg font-bold">{pendingPOs.length}</p>
          <p className="text-[10px] text-muted-foreground">Pending POs</p>
        </Card>
        <Card className="p-3 text-center">
          <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{lowStock.length}</p>
          <p className="text-[10px] text-muted-foreground">Low Stock Items</p>
        </Card>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending POs */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Pending Purchase Orders
            </h3>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate("purchase_orders")}>
              View all <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {pendingPOs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No pending POs</p>
          ) : (
            <div className="space-y-2">
              {pendingPOs.slice(0, 5).map((po) => (
                <div key={po.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{po.po_number}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{po.supplier_name}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <Badge variant="outline" className="text-[10px]">
                      {po.status === "partial" ? "Partial" : po.status === "sent" ? "Sent" : "Awaiting"}
                    </Badge>
                    {po.expected_date && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        ETA: {new Date(po.expected_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Low Stock Alerts */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" /> Low Stock Alerts
            </h3>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate("reorder")}>
              Reorder <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {lowStock.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">All stock levels healthy ✅</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {lowStock.map((item) => (
                <div key={item.variantId} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{item.productTitle}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{item.sku || "No SKU"}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className={`text-sm font-bold ${item.onHand <= 0 ? "text-destructive" : "text-yellow-600 dark:text-yellow-400"}`}>
                      {item.onHand}
                    </p>
                    <p className="text-[10px] text-muted-foreground">/ {item.reorderPoint} min</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Stocktakes */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" /> Recent Stocktakes
            </h3>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate("stocktake_module")}>
              View all <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          {recentStocktakes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No stocktakes yet</p>
          ) : (
            <div className="space-y-2">
              {recentStocktakes.map((st) => (
                <div key={st.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                  <div>
                    <p className="text-xs font-medium">{st.location}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(st.counted_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs">{st.lineCount} items</p>
                    {st.varianceCount > 0 && (
                      <p className="text-[10px] text-yellow-600 dark:text-yellow-400">{st.varianceCount} variances</p>
                    )}
                    <Badge variant="outline" className="text-[10px]">{st.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Stock Movement Chart */}
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Stock Movement (30 days)
          </h3>
          {stockMovement.every(d => d.in === 0 && d.out === 0) ? (
            <p className="text-xs text-muted-foreground text-center py-8">No stock movement data yet. Process invoices and sales to see trends.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stockMovement} barGap={0}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={4} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} width={30} className="text-muted-foreground" />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Bar dataKey="in" name="Units In" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="out" name="Units Out" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Workflow shortcuts */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">More Workflows</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: "Teach Invoices Tour", flow: "teach_invoice_tutorial", icon: GraduationCap },
            { label: "Reorder Suggestions", flow: "reorder", icon: TrendingUp },
            { label: "Suppliers", flow: "suppliers", icon: Package },
            { label: "Transfer Orders", flow: "transfer_orders", icon: ArrowDownToLine },
            { label: "Stock Adjustments", flow: "stock_adjustment", icon: TrendingDown },
            { label: "Stocky Hub", flow: "stocky_hub", icon: Package },
            { label: "Reports", flow: "reports_hub", icon: FileText },
          ].map((item) => (
            <button
              key={item.flow}
              onClick={() => onNavigate(item.flow)}
              className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors text-xs font-medium"
            >
              <item.icon className="w-4 h-4 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
