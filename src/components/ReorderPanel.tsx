import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Settings, ShoppingCart, Check, Loader2,
  TrendingUp, Package, Clock, AlertTriangle, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import Papa from "papaparse";

/* ─── Types ─── */

interface ReorderPanelProps {
  onBack: () => void;
  onViewOrders?: () => void;
}

interface ReorderRow {
  variantId: string;
  productTitle: string;
  sku: string | null;
  vendor: string | null;
  onHand: number;
  avgDailySales: number;
  leadTimeDays: number;
  safetyStockDays: number;
  desiredCoverDays: number;
  minOrderQty: number;
  incomingStock: number;
  recommendedQty: number;
  supplierId: string | null;
  supplierName: string | null;
  selected: boolean;
}

interface GlobalDefaults {
  lead_time_days: number;
  safety_stock_days: number;
  desired_cover_days: number;
  min_order_qty: number;
}

const DEFAULTS_KEY = "reorder_global_defaults";

function getGlobalDefaults(): GlobalDefaults {
  try {
    return { lead_time_days: 14, safety_stock_days: 7, desired_cover_days: 30, min_order_qty: 1, ...JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "{}") };
  } catch {
    return { lead_time_days: 14, safety_stock_days: 7, desired_cover_days: 30, min_order_qty: 1 };
  }
}

/* ─── Component ─── */

const ReorderPanel = ({ onBack, onViewOrders }: ReorderPanelProps) => {
  const [rows, setRows] = useState<ReorderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [velocityDays, setVelocityDays] = useState<30 | 60 | 90>(30);
  const [defaults, setDefaults] = useState<GlobalDefaults>(getGlobalDefaults);
  const [editDefaults, setEditDefaults] = useState<GlobalDefaults>(getGlobalDefaults);
  const [creatingPO, setCreatingPO] = useState(false);
  const [createdPOs, setCreatedPOs] = useState<{ supplier: string; poNumber: string; lineCount: number }[]>([]);

  useEffect(() => { loadData(); }, [velocityDays]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;
      const userId = user.user.id;

      // Fetch variants, products, suppliers, reorder settings, sales data, and incoming PO lines in parallel
      const [varRes, prodRes, supRes, settRes, poLineRes] = await Promise.all([
        supabase.from("variants").select("*").eq("user_id", userId),
        supabase.from("products").select("id, title, vendor").eq("user_id", userId),
        supabase.from("suppliers").select("id, name").eq("user_id", userId),
        supabase.from("product_reorder_settings").select("*").eq("user_id", userId),
        supabase.from("purchase_order_lines").select("sku, expected_qty, received_qty, purchase_order_id").eq("user_id", userId),
      ]);

      const variants = varRes.data || [];
      const products = prodRes.data || [];
      const suppliers = supRes.data || [];
      const settings = settRes.data || [];
      const poLines = poLineRes.data || [];

      // Get open PO IDs (draft/sent/partial)
      const { data: openPOs } = await supabase
        .from("purchase_orders")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["draft", "sent", "partial"]);
      const openPOIds = new Set((openPOs || []).map(p => p.id));

      // Calculate incoming stock per SKU from open POs
      const incomingBySku: Record<string, number> = {};
      for (const pl of poLines) {
        if (pl.sku && openPOIds.has(pl.purchase_order_id)) {
          const remaining = (pl.expected_qty || 0) - (pl.received_qty || 0);
          if (remaining > 0) {
            incomingBySku[pl.sku.toLowerCase()] = (incomingBySku[pl.sku.toLowerCase()] || 0) + remaining;
          }
        }
      }

      // Fetch sales data for velocity
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - velocityDays);
      const { data: salesData } = await supabase
        .from("sales_data")
        .select("variant_id, quantity_sold, sold_at")
        .eq("user_id", userId)
        .gte("sold_at", cutoff.toISOString());

      // Aggregate daily sales per variant
      const salesByVariant: Record<string, number> = {};
      for (const s of salesData || []) {
        if (s.variant_id) {
          salesByVariant[s.variant_id] = (salesByVariant[s.variant_id] || 0) + (s.quantity_sold || 0);
        }
      }

      const productMap = new Map(products.map(p => [p.id, p]));
      const settingsMap = new Map(settings.map(s => [s.variant_id, s]));
      const defs = getGlobalDefaults();

      // Try to match vendor to supplier
      const supplierByName = new Map(suppliers.map(s => [s.name.toLowerCase(), s]));

      const reorderRows: ReorderRow[] = variants.map(v => {
        const product = productMap.get(v.product_id);
        const setting = settingsMap.get(v.id);
        const totalSold = salesByVariant[v.id] || 0;
        const avgDaily = totalSold / velocityDays;
        const leadTime = setting?.lead_time_days ?? defs.lead_time_days;
        const safetyDays = setting?.safety_stock_days ?? defs.safety_stock_days;
        const coverDays = setting?.desired_cover_days ?? defs.desired_cover_days;
        const minQty = setting?.min_order_qty ?? defs.min_order_qty;
        const incoming = v.sku ? (incomingBySku[v.sku.toLowerCase()] || 0) : 0;

        // Formula: ((lead_time + safety_stock) * avg_daily_sales) - current_stock - incoming
        const raw = ((leadTime + safetyDays) * avgDaily) - v.quantity - incoming;
        const recommended = Math.max(0, Math.ceil(raw));
        const finalQty = recommended > 0 ? Math.max(recommended, minQty) : 0;

        // Find supplier
        let supplierId = setting?.supplier_id || null;
        let supplierName: string | null = null;
        if (!supplierId && product?.vendor) {
          const match = supplierByName.get(product.vendor.toLowerCase());
          if (match) { supplierId = match.id; supplierName = match.name; }
          else supplierName = product.vendor;
        }
        if (supplierId) {
          const sup = suppliers.find(s => s.id === supplierId);
          if (sup) supplierName = sup.name;
        }

        return {
          variantId: v.id,
          productTitle: product?.title || "Unknown",
          sku: v.sku,
          vendor: product?.vendor || null,
          onHand: v.quantity,
          avgDailySales: avgDaily,
          leadTimeDays: leadTime,
          safetyStockDays: safetyDays,
          desiredCoverDays: coverDays,
          minOrderQty: minQty,
          incomingStock: incoming,
          recommendedQty: finalQty,
          supplierId,
          supplierName,
          selected: false,
        };
      });

      // Only show rows with recommended > 0, sorted by urgency
      setRows(
        reorderRows
          .filter(r => r.recommendedQty > 0)
          .sort((a, b) => {
            // Sort by days of stock remaining (ascending = most urgent first)
            const daysA = a.avgDailySales > 0 ? a.onHand / a.avgDailySales : 999;
            const daysB = b.avgDailySales > 0 ? b.onHand / b.avgDailySales : 999;
            return daysA - daysB;
          })
      );
    } catch (err) {
      toast.error("Failed to load reorder data");
    } finally { setLoading(false); }
  };

  const selectedRows = useMemo(() => rows.filter(r => r.selected), [rows]);
  const toggleAll = (checked: boolean) => setRows(prev => prev.map(r => ({ ...r, selected: checked })));
  const toggleRow = (variantId: string) => setRows(prev => prev.map(r => r.variantId === variantId ? { ...r, selected: !r.selected } : r));

  /* ─── Create PO from selected ─── */

  const handleCreatePOs = async () => {
    if (selectedRows.length === 0) { toast.error("Select items first"); return; }
    setCreatingPO(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      // Group by supplier
      const bySupplier: Record<string, ReorderRow[]> = {};
      for (const r of selectedRows) {
        const key = r.supplierName || "Unknown Supplier";
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(r);
      }

      const created: { supplier: string; poNumber: string; lineCount: number }[] = [];

      for (const [supplierName, items] of Object.entries(bySupplier)) {
        const poNumber = `PO-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const totalCost = items.reduce((s, r) => s + r.recommendedQty * 0, 0); // cost unknown here

        const { data: po, error } = await supabase
          .from("purchase_orders")
          .insert({
            user_id: user.user.id,
            po_number: poNumber,
            supplier_name: supplierName,
            supplier_id: items[0].supplierId,
            status: "draft",
            total_cost: totalCost,
          })
          .select()
          .single();
        if (error) throw error;

        const lines = items.map(r => ({
          user_id: user.user!.id,
          purchase_order_id: po.id,
          product_title: r.productTitle,
          sku: r.sku,
          expected_qty: r.recommendedQty,
          expected_cost: 0,
          received_qty: 0,
        }));

        await supabase.from("purchase_order_lines").insert(lines);
        created.push({ supplier: supplierName, poNumber, lineCount: items.length });
      }

      addAuditEntry("reorder_po_created", `Created ${created.length} POs from reorder suggestions (${selectedRows.length} items)`);
      setCreatedPOs(created);
      toast.success(`Created ${created.length} draft PO(s)`);
      setRows(prev => prev.map(r => ({ ...r, selected: false })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create POs");
    } finally { setCreatingPO(false); }
  };

  /* ─── Save global defaults ─── */

  const handleSaveDefaults = () => {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(editDefaults));
    setDefaults(editDefaults);
    setShowSettings(false);
    toast.success("Default settings saved");
    loadData();
  };

  /* ─── Export CSV ─── */

  const exportCSV = () => {
    const csv = Papa.unparse(rows.map(r => ({
      Product: r.productTitle,
      SKU: r.sku || "",
      Supplier: r.supplierName || "",
      On_Hand: r.onHand,
      Avg_Daily_Sales: r.avgDailySales.toFixed(2),
      Lead_Time: r.leadTimeDays,
      Safety_Days: r.safetyStockDays,
      Incoming: r.incomingStock,
      Recommended_Qty: r.recommendedQty,
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reorder-suggestions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  /* ─── Urgency helper ─── */

  const getUrgency = (r: ReorderRow) => {
    if (r.onHand === 0) return { label: "Out of stock", color: "bg-destructive/15 text-destructive" };
    const days = r.avgDailySales > 0 ? Math.floor(r.onHand / r.avgDailySales) : 999;
    if (days <= r.leadTimeDays) return { label: `${days}d left`, color: "bg-destructive/15 text-destructive" };
    if (days <= r.leadTimeDays + r.safetyStockDays) return { label: `${days}d left`, color: "bg-secondary text-secondary-foreground" };
    return { label: `${days}d left`, color: "bg-muted text-muted-foreground" };
  };

  return (
    <div className="px-4 pt-4 pb-24 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-semibold flex-1">Reorder Suggestions</h1>
        <Select value={String(velocityDays)} onValueChange={v => setVelocityDays(Number(v) as 30 | 60 | 90)}>
          <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
          <Settings className="w-5 h-5" />
        </Button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card className="mb-4">
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-semibold">Global Reorder Defaults</h3>
            <p className="text-xs text-muted-foreground">These apply to all products without per-product overrides.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Lead Time (days)</label>
                <Input
                  type="number" min={1}
                  value={editDefaults.lead_time_days}
                  onChange={e => setEditDefaults({ ...editDefaults, lead_time_days: parseInt(e.target.value) || 14 })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Safety Stock (days)</label>
                <Input
                  type="number" min={0}
                  value={editDefaults.safety_stock_days}
                  onChange={e => setEditDefaults({ ...editDefaults, safety_stock_days: parseInt(e.target.value) || 7 })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cover Days</label>
                <Input
                  type="number" min={1}
                  value={editDefaults.desired_cover_days}
                  onChange={e => setEditDefaults({ ...editDefaults, desired_cover_days: parseInt(e.target.value) || 30 })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Min Order Qty</label>
                <Input
                  type="number" min={1}
                  value={editDefaults.min_order_qty}
                  onChange={e => setEditDefaults({ ...editDefaults, min_order_qty: parseInt(e.target.value) || 1 })}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <Button size="sm" onClick={handleSaveDefaults}>Save Defaults</Button>
          </CardContent>
        </Card>
      )}

      {/* Created POs confirmation */}
      {createdPOs.length > 0 && (
        <Card className="mb-4 border-primary/30">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Created {createdPOs.length} draft PO(s)</span>
            </div>
            {createdPOs.map(po => (
              <p key={po.poNumber} className="text-xs text-muted-foreground">
                • <span className="font-mono">{po.poNumber}</span> — {po.supplier} — {po.lineCount} items
              </p>
            ))}
            <div className="flex gap-2 mt-2">
              {onViewOrders && <Button size="sm" variant="outline" onClick={onViewOrders}>View POs →</Button>}
              <Button size="sm" variant="ghost" onClick={() => setCreatedPOs([])}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No reorder suggestions right now.</p>
            <p className="text-xs text-muted-foreground mt-1">Sync sales data and add inventory to generate suggestions.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <Badge variant="outline" className="text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {rows.filter(r => r.onHand === 0).length} out of stock
            </Badge>
            <Badge variant="outline" className="text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              {rows.length} need reorder
            </Badge>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3 mb-3">
            <Button
              size="sm"
              disabled={selectedRows.length === 0 || creatingPO}
              onClick={handleCreatePOs}
            >
              {creatingPO ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShoppingCart className="w-4 h-4 mr-1" />}
              Create PO from {selectedRows.length || "selected"} items
            </Button>
            {rows.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => toggleAll(!rows.every(r => r.selected))}>
                {rows.every(r => r.selected) ? "Deselect all" : "Select all"}
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={rows.length > 0 && rows.every(r => r.selected)}
                      onCheckedChange={(c) => toggleAll(!!c)}
                    />
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Avg/Day</TableHead>
                  <TableHead className="text-right">Lead Time</TableHead>
                  <TableHead className="text-right">Incoming</TableHead>
                  <TableHead className="text-right">Reorder Qty</TableHead>
                  <TableHead>Urgency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const urgency = getUrgency(r);
                  return (
                    <TableRow key={r.variantId}>
                      <TableCell>
                        <Checkbox checked={r.selected} onCheckedChange={() => toggleRow(r.variantId)} />
                      </TableCell>
                      <TableCell className="text-sm font-medium truncate max-w-[180px]">{r.productTitle}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sku || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.supplierName || "—"}</TableCell>
                      <TableCell className={`text-right font-medium ${r.onHand === 0 ? "text-destructive" : ""}`}>{r.onHand}</TableCell>
                      <TableCell className="text-right text-xs">{r.avgDailySales.toFixed(1)}</TableCell>
                      <TableCell className="text-right text-xs">{r.leadTimeDays}d</TableCell>
                      <TableCell className="text-right text-xs">{r.incomingStock > 0 ? r.incomingStock : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{r.recommendedQty}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${urgency.color}`}>{urgency.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 text-center">
            Formula: ((Lead Time + Safety Stock) × Avg Daily Sales) − On Hand − Incoming · Velocity: last {velocityDays} days
          </p>
        </>
      )}
    </div>
  );
};

export default ReorderPanel;
