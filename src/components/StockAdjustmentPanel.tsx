import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronLeft, Search, Plus, Minus, Loader2, RefreshCw,
  Filter, Download, Package, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";
import { adjustInventory, findVariantBySKU, getConnection, getLocations } from "@/lib/shopify-api";
import { cn } from "@/lib/utils";
import Papa from "papaparse";

const REASONS = ["Damaged", "Lost", "Sample", "Return", "Shrinkage", "Found", "Correction", "Other"] as const;
type Reason = typeof REASONS[number];

interface AdjustmentRow {
  id: string;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  adjustment_qty: number;
  reason: string | null;
  location: string;
  adjusted_at: string;
  created_at: string;
}

interface Props {
  onBack: () => void;
}

export default function StockAdjustmentPanel({ onBack }: Props) {
  // Form
  const [skuSearch, setSkuSearch] = useState("");
  const [matchedVariant, setMatchedVariant] = useState<{ title: string; sku: string; shopifyVariantId: string | null; inventoryItemId: string | null; currentQty: number } | null>(null);
  const [qty, setQty] = useState<number>(0);
  const [reason, setReason] = useState<Reason>("Correction");
  const [note, setNote] = useState("");
  const [location, setLocation] = useState("Main Store");
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);

  // History
  const [history, setHistory] = useState<AdjustmentRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [filterReason, setFilterReason] = useState<string>("all");

  // Shopify
  const [hasShopify, setHasShopify] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [shopifyLocationId, setShopifyLocationId] = useState<string | null>(null);

  // Tab
  const [tab, setTab] = useState<"adjust" | "history">("adjust");

  // Load Shopify connection & locations
  useEffect(() => {
    (async () => {
      const conn = await getConnection();
      if (conn) {
        setHasShopify(true);
        const locs = await getLocations();
        setLocations(locs.filter(l => l.active).map(l => ({ id: l.id, name: l.name })));
        if (conn.default_location_id) setShopifyLocationId(conn.default_location_id);
        else if (locs.length > 0) setShopifyLocationId(locs[0].id);
      }
    })();
  }, []);

  // Load history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from("inventory_adjustments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setHistory((data || []) as AdjustmentRow[]);
    setLoadingHistory(false);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Search variant by SKU
  const handleSearch = async () => {
    if (!skuSearch.trim()) return;
    setSearching(true);
    setMatchedVariant(null);

    // Try local DB first
    const { data: variants } = await supabase
      .from("variants")
      .select("id, sku, barcode, quantity, shopify_variant_id, product_id")
      .or(`sku.ilike.%${skuSearch.trim()}%,barcode.ilike.%${skuSearch.trim()}%`)
      .limit(1);

    if (variants && variants.length > 0) {
      const v = variants[0];
      const { data: prod } = await supabase.from("products").select("title").eq("id", v.product_id).single();
      setMatchedVariant({
        title: prod?.title || "Unknown",
        sku: v.sku || v.barcode || "",
        shopifyVariantId: v.shopify_variant_id,
        currentQty: v.quantity,
      });
    } else if (hasShopify) {
      // Try Shopify
      const shopifyResult = await findVariantBySKU(skuSearch.trim());
      if (shopifyResult) {
        setMatchedVariant({
          title: shopifyResult.product_title || "Shopify product",
          sku: shopifyResult.sku || skuSearch.trim(),
          shopifyVariantId: shopifyResult.variant_id,
          inventoryItemId: shopifyResult.inventory_item_id,
          currentQty: 0,
        });
      } else {
        toast.error("No variant found for that SKU/barcode");
      }
    } else {
      toast.error("No variant found for that SKU/barcode");
    }
    setSearching(false);
  };

  // Submit adjustment
  const handleSubmit = async () => {
    if (!matchedVariant) { toast.error("Search for a product first"); return; }
    if (qty === 0) { toast.error("Quantity cannot be zero"); return; }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSubmitting(false); return; }

    // Adjust in Shopify if connected
    if (hasShopify && matchedVariant.shopifyVariantId && shopifyLocationId) {
      try {
        await adjustInventory(matchedVariant.shopifyVariantId, qty, shopifyLocationId);
      } catch (e) {
        console.error("Shopify adjust error:", e);
        toast.error("Shopify inventory update failed — recording locally");
      }
    }

    // Update local variants table
    const { data: localVar } = await supabase
      .from("variants")
      .select("id, quantity")
      .eq("sku", matchedVariant.sku)
      .limit(1);

    if (localVar && localVar.length > 0) {
      await supabase.from("variants").update({
        quantity: localVar[0].quantity + qty,
      }).eq("id", localVar[0].id);
    }

    // Record in inventory_adjustments
    await supabase.from("inventory_adjustments").insert({
      user_id: user.id,
      sku: matchedVariant.sku,
      product_title: matchedVariant.title,
      adjustment_qty: qty,
      reason: reason,
      location: location,
      shopify_variant_id: matchedVariant.shopifyVariantId || null,
    });

    addAuditEntry("Stock Adjustment", `${qty > 0 ? "+" : ""}${qty} ${matchedVariant.sku} — ${reason}${note ? `: ${note}` : ""}`);
    toast.success(`Stock adjusted: ${qty > 0 ? "+" : ""}${qty} for ${matchedVariant.sku}`);

    // Reset form
    setSkuSearch("");
    setMatchedVariant(null);
    setQty(0);
    setNote("");
    setSubmitting(false);
    await loadHistory();
  };

  // Filtered history
  const filteredHistory = useMemo(() => {
    if (filterReason === "all") return history;
    return history.filter(h => h.reason === filterReason);
  }, [history, filterReason]);

  // CSV export
  const exportCSV = () => {
    if (filteredHistory.length === 0) { toast.error("No data to export"); return; }
    const csv = Papa.unparse(filteredHistory.map(h => ({
      date: new Date(h.created_at).toLocaleDateString(),
      sku: h.sku || "",
      product: h.product_title || "",
      quantity: h.adjustment_qty,
      reason: h.reason || "",
      location: h.location,
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "stock-adjustments.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Stock Adjustments</h2>
          <p className="text-xs text-muted-foreground">Manually adjust inventory with reason codes</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1 mb-4">
        {(["adjust", "history"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {t === "adjust" ? "New Adjustment" : `History (${history.length})`}
          </button>
        ))}
      </div>

      {tab === "adjust" && (
        <div className="space-y-4">
          {/* SKU search */}
          <Card className="p-4">
            <label className="text-xs font-semibold text-muted-foreground block mb-2">Find Product</label>
            <div className="flex gap-2">
              <Input
                placeholder="SKU or barcode…"
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                className="font-mono h-10"
                autoFocus
              />
              <Button onClick={handleSearch} disabled={searching} className="h-10 px-4">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </Card>

          {/* Matched product */}
          {matchedVariant && (
            <Card className="p-4 border-primary/30">
              <div className="flex items-center gap-3 mb-3">
                <Package className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{matchedVariant.title}</p>
                  <p className="text-xs text-muted-foreground font-mono">{matchedVariant.sku}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold font-mono">{matchedVariant.currentQty}</p>
                  <p className="text-[10px] text-muted-foreground">on hand</p>
                </div>
              </div>

              {/* Quantity */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Adjustment qty</label>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setQty(q => q - 1)}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Input
                      type="number"
                      value={qty}
                      onChange={e => setQty(parseInt(e.target.value) || 0)}
                      className="h-9 font-mono text-center"
                    />
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setQty(q => q + 1)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    New qty: <span className="font-mono font-semibold">{matchedVariant.currentQty + qty}</span>
                  </p>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Reason</label>
                  <Select value={reason} onValueChange={v => setReason(v as Reason)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REASONS.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Location */}
              {locations.length > 1 && (
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Location</label>
                  <Select value={location} onValueChange={setLocation}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map(l => <SelectItem key={l.id} value={l.name} className="text-xs">{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Note */}
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1 block">Note (optional)</label>
                <Input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Found behind shelf"
                  className="h-9 text-xs"
                />
              </div>

              {/* Warning for large adjustments */}
              {Math.abs(qty) >= 50 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive mb-3">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Large adjustment — please confirm
                </div>
              )}

              <Button
                className="w-full h-10"
                onClick={handleSubmit}
                disabled={submitting || qty === 0}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                {qty > 0 ? `Add ${qty} units` : qty < 0 ? `Remove ${Math.abs(qty)} units` : "Enter quantity"}
              </Button>

              {hasShopify && (
                <p className="text-[10px] text-primary flex items-center gap-1 mt-2">
                  <Package className="w-3 h-3" /> Shopify inventory will be updated
                </p>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <Select value={filterReason} onValueChange={setFilterReason}>
              <SelectTrigger className="h-8 text-xs w-36">
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue placeholder="All reasons" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All reasons</SelectItem>
                {REASONS.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={exportCSV}>
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadHistory}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{filteredHistory.length} adjustment{filteredHistory.length !== 1 ? "s" : ""}</p>

          {loadingHistory ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : filteredHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <Package className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No adjustments recorded</p>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {filteredHistory.map(adj => (
                <Card key={adj.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{adj.product_title || adj.sku || "Unknown"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {adj.sku && <span className="font-mono">{adj.sku}</span>}
                        {adj.sku && " • "}
                        {adj.location}
                        {" • "}
                        {new Date(adj.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-mono font-bold",
                        adj.adjustment_qty > 0 ? "text-green-600" : "text-destructive"
                      )}>
                        {adj.adjustment_qty > 0 ? "+" : ""}{adj.adjustment_qty}
                      </p>
                      <Badge variant="outline" className="text-[9px]">{adj.reason || "—"}</Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
