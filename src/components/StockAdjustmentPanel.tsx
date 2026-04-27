import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronLeft, Search, Plus, Loader2, Download, Filter,
  Package, X, AlertTriangle, FileText, Archive, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";
import {
  adjustInventory, findVariantBySKU, findVariantByBarcode,
  getConnection, getLocations,
} from "@/lib/shopify-api";
import { cn } from "@/lib/utils";
import Papa from "papaparse";

const REASONS = [
  "Stocktake correction",
  "Damaged goods",
  "Theft / shrinkage",
  "Supplier error",
  "Internal transfer",
  "Opening stock entry",
  "Other",
] as const;
type Reason = typeof REASONS[number];

const DEFAULT_LOCATIONS = ["Darwin City", "Gateway"];

interface LineItem {
  product_id: string | null;
  variant_id: string | null;
  inventory_item_id: string | null;
  sku: string;
  barcode: string | null;
  product_title: string;
  variant_title: string;
  qty_before: number;
  qty_adjustment: number;
  qty_after: number;
  apply_status?: "pending" | "success" | "error";
  apply_error?: string;
}

interface AdjustmentRecord {
  id: string;
  adjustment_number: string;
  location: string;
  reason: string;
  notes: string | null;
  adjusted_by: string | null;
  adjustment_date: string;
  status: "open" | "archived";
  applied_at: string | null;
  line_items: LineItem[];
  created_at: string;
}

interface Props {
  onBack: () => void;
}

export default function StockAdjustmentPanel({ onBack }: Props) {
  const [view, setView] = useState<"list" | "create">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AdjustmentRecord | null>(null);

  // List state
  const [records, setRecords] = useState<AdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterReason, setFilterReason] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  // Form state
  const [location, setLocation] = useState<string>(DEFAULT_LOCATIONS[0]);
  const [reason, setReason] = useState<Reason>("Stocktake correction");
  const [notes, setNotes] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [adjustedBy, setAdjustedBy] = useState<string>("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Shopify
  const [hasShopify, setHasShopify] = useState(false);
  const [shopifyLocations, setShopifyLocations] = useState<{ id: string; name: string }[]>([]);

  // Load auth user name
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (u) {
        setAdjustedBy(
          (u.user_metadata?.full_name as string) ||
          (u.user_metadata?.name as string) ||
          u.email ||
          "Unknown",
        );
      }
    });
  }, []);

  // Load Shopify
  useEffect(() => {
    (async () => {
      const conn = await getConnection();
      if (conn) {
        setHasShopify(true);
        const locs = await getLocations();
        setShopifyLocations(locs.filter(l => l.active).map(l => ({ id: l.id, name: l.name })));
      }
    })();
  }, []);

  // Load records
  const loadRecords = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stock_adjustments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load adjustments");
    } else {
      setRecords((data || []) as unknown as AdjustmentRecord[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filterLocation !== "all" && r.location !== filterLocation) return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterReason !== "all" && r.reason !== filterReason) return false;
      if (filterFrom && r.adjustment_date < filterFrom) return false;
      if (filterTo && r.adjustment_date > filterTo) return false;
      return true;
    });
  }, [records, filterLocation, filterStatus, filterReason, filterFrom, filterTo]);

  // Resolve current qty for selected location from variant inventory_levels
  const fetchCurrentQty = async (inventoryItemId: string | null): Promise<number> => {
    if (!inventoryItemId || !hasShopify) return 0;
    const matchedLoc = shopifyLocations.find(l => l.name === location);
    if (!matchedLoc) return 0;
    try {
      // Use existing helper getInventoryLevels via shopify-api (call directly to avoid full fetch)
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: {
          action: "get_inventory_level_for_item",
          inventory_item_id: inventoryItemId,
          location_id: matchedLoc.id,
        },
      });
      if (error) return 0;
      return Number(data?.available || 0);
    } catch {
      return 0;
    }
  };

  // Add product/variant to line items
  const addProductByQuery = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      let variants: Array<{
        variant_id: string; sku: string | null; barcode: string | null;
        inventory_item_id: string; product_id: string; product_title: string;
      }> = [];

      // Try barcode first if numeric
      if (/^\d{6,}$/.test(q)) {
        const matches = await findVariantByBarcode(q);
        variants = matches;
      }
      if (variants.length === 0) {
        const v = await findVariantBySKU(q);
        if (v) variants = [v];
      }
      if (variants.length === 0) {
        toast.error(`No product found for "${q}"`);
        return;
      }

      const newLines: LineItem[] = [];
      for (const v of variants) {
        if (lineItems.find(li => li.variant_id === String(v.variant_id))) continue;
        const qtyBefore = await fetchCurrentQty(String(v.inventory_item_id));
        newLines.push({
          product_id: String(v.product_id),
          variant_id: String(v.variant_id),
          inventory_item_id: String(v.inventory_item_id),
          sku: v.sku || "",
          barcode: v.barcode,
          product_title: v.product_title,
          variant_title: [v.sku].filter(Boolean).join(" "),
          qty_before: qtyBefore,
          qty_adjustment: 0,
          qty_after: qtyBefore,
        });
      }
      setLineItems([...lineItems, ...newLines]);
      setSearchQuery("");
      toast.success(`Added ${newLines.length} variant${newLines.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(`Search failed: ${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const updateLineQty = (idx: number, qtyAdj: number) => {
    setLineItems(prev => prev.map((li, i) =>
      i === idx ? { ...li, qty_adjustment: qtyAdj, qty_after: li.qty_before + qtyAdj } : li,
    ));
  };

  const removeLine = (idx: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setEditingId(null);
    setLocation(DEFAULT_LOCATIONS[0]);
    setReason("Stocktake correction");
    setNotes("");
    setAdjustmentDate(new Date().toISOString().split("T")[0]);
    setLineItems([]);
    setSearchQuery("");
  };

  // Validation
  const formValid = useMemo(() => {
    if (!location || !reason || !adjustmentDate) return false;
    if (reason === "Other" && !notes.trim()) return false;
    if (lineItems.length === 0) return false;
    if (lineItems.some(li => li.qty_adjustment === 0)) return false;
    return true;
  }, [location, reason, notes, adjustmentDate, lineItems]);

  // Save
  const save = async (apply: boolean) => {
    if (!formValid) {
      toast.error("Please complete all required fields and add at least one line item with a non-zero adjustment.");
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      let workingLines = [...lineItems];
      let appliedAt: string | null = null;
      let status: "open" | "archived" = "open";

      if (apply) {
        if (!hasShopify) {
          toast.error("Shopify is not connected. Cannot apply.");
          setSubmitting(false);
          return;
        }
        const matchedLoc = shopifyLocations.find(l => l.name === location);
        if (!matchedLoc) {
          toast.error(`Location "${location}" not found in Shopify`);
          setSubmitting(false);
          return;
        }
        let allOk = true;
        for (let i = 0; i < workingLines.length; i++) {
          const li = workingLines[i];
          if (!li.inventory_item_id) {
            workingLines[i] = { ...li, apply_status: "error", apply_error: "Missing inventory_item_id" };
            allOk = false;
            continue;
          }
          try {
            await adjustInventory(matchedLoc.id, li.inventory_item_id, li.qty_adjustment);
            workingLines[i] = { ...li, apply_status: "success" };
          } catch (err) {
            workingLines[i] = { ...li, apply_status: "error", apply_error: (err as Error).message };
            allOk = false;
          }
        }
        if (allOk) {
          appliedAt = new Date().toISOString();
          status = "archived";
        }
      }

      const payload = {
        user_id: userId,
        location,
        reason,
        notes: notes || null,
        adjusted_by: adjustedBy,
        adjustment_date: adjustmentDate,
        status,
        applied_at: appliedAt,
        line_items: workingLines as unknown as never,
      };

      if (editingId) {
        const { error } = await supabase
          .from("stock_adjustments")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("stock_adjustments").insert(payload);
        if (error) throw error;
      }

      await addAuditEntry({
        action: apply ? "stock_adjustment_applied" : "stock_adjustment_saved",
        details: { location, reason, line_count: workingLines.length },
      });

      toast.success(apply ? "Adjustment applied to Shopify" : "Adjustment saved as draft");
      resetForm();
      setView("list");
      loadRecords();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (id: string) => {
    const { error } = await supabase
      .from("stock_adjustments")
      .update({ status: "archived" })
      .eq("id", id);
    if (error) {
      toast.error("Failed to archive");
    } else {
      toast.success("Archived");
      loadRecords();
    }
  };

  const exportCsv = () => {
    const rows = filteredRecords.map(r => ({
      adjustment_number: r.adjustment_number,
      date: r.adjustment_date,
      created_at: r.created_at,
      location: r.location,
      reason: r.reason,
      products_adjusted: (r.line_items || []).length,
      adjusted_by: r.adjusted_by || "",
      status: r.status,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-adjustments-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats for create form
  const summary = useMemo(() => {
    const added = lineItems.reduce((s, li) => s + Math.max(0, li.qty_adjustment), 0);
    const removed = lineItems.reduce((s, li) => s + Math.min(0, li.qty_adjustment), 0);
    return { count: lineItems.length, added, removed: Math.abs(removed) };
  }, [lineItems]);

  // ─── List View ─────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold font-display">Stock Adjustments</h1>
              <p className="text-sm text-muted-foreground">Manual inventory adjustments — Stocky replacement</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredRecords.length === 0}>
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </Button>
            <Button onClick={() => { resetForm(); setView("create"); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Create Adjustment
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={filterLocation} onValueChange={setFilterLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {DEFAULT_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Select value={filterReason} onValueChange={setFilterReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No adjustments yet. Click "Create Adjustment" to start.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Adjustment #</th>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Location</th>
                    <th className="text-left p-3">Reason</th>
                    <th className="text-right p-3">Products</th>
                    <th className="text-left p-3">Adjusted by</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(r => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-3 font-mono">{r.adjustment_number}</td>
                      <td className="p-3">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-3">{r.location}</td>
                      <td className="p-3">{r.reason}</td>
                      <td className="p-3 text-right">{(r.line_items || []).length}</td>
                      <td className="p-3 text-muted-foreground">{r.adjusted_by || "—"}</td>
                      <td className="p-3">
                        <Badge variant={r.status === "archived" ? "secondary" : "default"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {r.status === "open" && (
                          <Button size="sm" variant="ghost" onClick={() => archive(r.id)}>
                            <Archive className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* View dialog */}
        <Dialog open={!!viewing} onOpenChange={open => !open && setViewing(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            {viewing && (
              <>
                <DialogHeader>
                  <DialogTitle className="font-mono">{viewing.adjustment_number}</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Location:</span> {viewing.location}</div>
                  <div><span className="text-muted-foreground">Reason:</span> {viewing.reason}</div>
                  <div><span className="text-muted-foreground">Date:</span> {viewing.adjustment_date}</div>
                  <div><span className="text-muted-foreground">Status:</span> {viewing.status}</div>
                  <div><span className="text-muted-foreground">Adjusted by:</span> {viewing.adjusted_by || "—"}</div>
                  <div><span className="text-muted-foreground">Applied:</span> {viewing.applied_at ? new Date(viewing.applied_at).toLocaleString() : "Not applied"}</div>
                </div>
                {viewing.notes && (
                  <div className="text-sm">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <p className="mt-1">{viewing.notes}</p>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground">Line Items ({(viewing.line_items || []).length})</Label>
                  <div className="mt-2 border border-border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2">Product</th>
                          <th className="text-left p-2">SKU</th>
                          <th className="text-right p-2">Before</th>
                          <th className="text-right p-2">Adj</th>
                          <th className="text-right p-2">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(viewing.line_items || []).map((li, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="p-2">{li.product_title} <span className="text-muted-foreground">{li.variant_title}</span></td>
                            <td className="p-2 font-mono">{li.sku}</td>
                            <td className="p-2 text-right">{li.qty_before}</td>
                            <td className={cn("p-2 text-right font-medium", li.qty_adjustment > 0 ? "text-success" : li.qty_adjustment < 0 ? "text-destructive" : "")}>
                              {li.qty_adjustment > 0 ? "+" : ""}{li.qty_adjustment}
                            </td>
                            <td className="p-2 text-right">{li.qty_after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── Create Form ───────────────────────────────────────
  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => { resetForm(); setView("list"); }}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Cancel
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-display">Create Stock Adjustment</h1>
          <p className="text-sm text-muted-foreground">Add or remove inventory across selected variants</p>
        </div>
      </div>

      {!hasShopify && (
        <Card className="p-3 mb-4 border-amber-500/30 bg-amber-500/10 flex gap-2 items-center text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Shopify is not connected. You can save as draft, but cannot apply to Shopify.
        </Card>
      )}

      {/* Header form */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Location *</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEFAULT_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Adjustment date *</Label>
            <Input type="date" value={adjustmentDate} onChange={e => setAdjustmentDate(e.target.value)} />
          </div>
          <div>
            <Label>Adjusted by</Label>
            <Input value={adjustedBy} disabled />
          </div>
          <div className="md:col-span-2">
            <Label>Notes {reason === "Other" && <span className="text-destructive">*</span>}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={reason === "Other" ? "Required when reason is Other" : "Optional"}
              rows={2}
            />
          </div>
        </div>
      </Card>

      {/* Search line items */}
      <Card className="p-4 mb-4">
        <Label>Add product (search by title, SKU, or barcode)</Label>
        <div className="flex gap-2 mt-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addProductByQuery(); } }}
              placeholder="e.g. ABC-123 or barcode 9300000000000"
            />
          </div>
          <Button onClick={addProductByQuery} disabled={searching || !searchQuery.trim() || !hasShopify}>
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
        {!hasShopify && <p className="text-xs text-muted-foreground mt-2">Connect Shopify to search products.</p>}
      </Card>

      {/* Line items table */}
      <Card className="p-0 mb-4 overflow-hidden">
        {lineItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No line items yet. Search a product above to add.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Product</th>
                  <th className="text-left p-3">Variant</th>
                  <th className="text-left p-3">SKU</th>
                  <th className="text-left p-3">Barcode</th>
                  <th className="text-right p-3">Current</th>
                  <th className="text-right p-3">Adjustment</th>
                  <th className="text-right p-3">New</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="p-3">{li.product_title}</td>
                    <td className="p-3 text-muted-foreground">{li.variant_title}</td>
                    <td className="p-3 font-mono text-xs">{li.sku}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{li.barcode || "—"}</td>
                    <td className="p-3 text-right">{li.qty_before}</td>
                    <td className="p-3 text-right">
                      <Input
                        type="number"
                        className="w-20 text-right inline-block"
                        value={li.qty_adjustment}
                        onChange={e => updateLineQty(idx, parseInt(e.target.value || "0", 10))}
                      />
                    </td>
                    <td className={cn("p-3 text-right text-muted-foreground", li.qty_after < 0 && "text-destructive")}>
                      {li.qty_after}
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => removeLine(idx)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Summary */}
      {lineItems.length > 0 && (
        <Card className="p-4 mb-4 bg-muted/30">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-muted-foreground">Variants adjusted:</span> <span className="font-semibold">{summary.count}</span></div>
            <div><span className="text-muted-foreground">Units added:</span> <span className="font-semibold text-success">+{summary.added}</span></div>
            <div><span className="text-muted-foreground">Units removed:</span> <span className="font-semibold text-destructive">-{summary.removed}</span></div>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => save(false)} disabled={submitting || !formValid}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
          Save as Draft
        </Button>
        <Button onClick={() => save(true)} disabled={submitting || !formValid || !hasShopify}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
          Save & Apply to Shopify
        </Button>
      </div>
    </div>
  );
}
