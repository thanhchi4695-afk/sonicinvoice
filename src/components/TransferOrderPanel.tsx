import { useState, useEffect, useRef, useCallback } from "react";
import { useBarcode } from "@/components/BarcodeProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Plus, Truck, Package, Check, Loader2,
  Search, ArrowRightLeft, MapPin, Calendar, ScanBarcode, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { getLocations } from "@/lib/shopify-api";

/* ─── Types ─── */

interface LocationOption { id: string; name: string }

type TOStatus = "draft" | "shipped" | "received" | "cancelled";

interface TransferOrder {
  id: string;
  from_location: string;
  from_location_id: string | null;
  to_location: string;
  to_location_id: string | null;
  expected_ship_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  line_count?: number;
}

interface TransferLine {
  id: string;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  shopify_variant_id: string | null;
  shopify_inventory_item_id: string | null;
  quantity: number;
  shipped_qty: number;
  received_qty: number;
}

type Screen = "list" | "create" | "detail" | "ship" | "receive";

/* ─── Helpers ─── */

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  shipped: "bg-secondary text-secondary-foreground",
  received: "bg-primary/10 text-primary",
  cancelled: "bg-destructive/10 text-destructive",
};

/* ─── Component ─── */

interface TransferOrderPanelProps { onBack: () => void }

const TransferOrderPanel = ({ onBack }: TransferOrderPanelProps) => {
  const [screen, setScreen] = useState<Screen>("list");
  const [transfers, setTransfers] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create form
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [notes, setNotes] = useState("");
  const [newLines, setNewLines] = useState<{ sku: string; product_title: string; quantity: number; shopify_variant_id?: string; shopify_inventory_item_id?: string }[]>([]);
  const [skuInput, setSkuInput] = useState("");
  const [creating, setCreating] = useState(false);
  const skuRef = useRef<HTMLInputElement>(null);

  // Detail
  const [activeTO, setActiveTO] = useState<TransferOrder | null>(null);
  const [activeLines, setActiveLines] = useState<TransferLine[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => { loadTransfers(); loadLocations(); }, []);

  const loadLocations = async () => {
    try {
      const locs = await getLocations();
      setLocations(locs.map(l => ({ id: l.id, name: l.name })));
    } catch {
      setLocations([
        { id: "main", name: "Main Store" },
        { id: "warehouse", name: "Warehouse" },
      ]);
    }
  };

  const loadTransfers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("transfer_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const ids = (data || []).map(t => t.id);
      let lineCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: lines } = await supabase
          .from("transfer_order_lines")
          .select("transfer_order_id")
          .in("transfer_order_id", ids);
        if (lines) lines.forEach(l => {
          lineCounts[l.transfer_order_id] = (lineCounts[l.transfer_order_id] || 0) + 1;
        });
      }

      setTransfers((data || []).map(t => ({ ...t, line_count: lineCounts[t.id] || 0 })));
    } catch { toast.error("Failed to load transfers"); }
    finally { setLoading(false); }
  };

  /* ─── Add SKU to new transfer ─── */

  const handleAddSku = async () => {
    const code = skuInput.trim();
    if (!code) return;

    // Check if already added
    if (newLines.some(l => l.sku === code)) {
      setNewLines(prev => prev.map(l => l.sku === code ? { ...l, quantity: l.quantity + 1 } : l));
      setSkuInput("");
      skuRef.current?.focus();
      return;
    }

    // Lookup in local variants
    const { data: variants } = await supabase
      .from("variants")
      .select("sku, barcode, shopify_variant_id, product_id")
      .or(`sku.ilike.${code},barcode.eq.${code}`)
      .limit(1);

    let title = code;
    let variantId: string | undefined;

    if (variants && variants.length > 0) {
      const v = variants[0];
      variantId = v.shopify_variant_id || undefined;
      const { data: prod } = await supabase
        .from("products")
        .select("title")
        .eq("id", v.product_id)
        .single();
      if (prod) title = prod.title;
    }

    setNewLines(prev => [...prev, { sku: code, product_title: title, quantity: 1, shopify_variant_id: variantId }]);
    setSkuInput("");
    skuRef.current?.focus();
  };

  /* ─── Create Transfer ─── */

  const handleCreate = async () => {
    if (!fromLoc || !toLoc) { toast.error("Select both locations"); return; }
    if (fromLoc === toLoc) { toast.error("Locations must be different"); return; }
    if (newLines.length === 0) { toast.error("Add at least one item"); return; }

    setCreating(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const fromLocObj = locations.find(l => l.name === fromLoc);
      const toLocObj = locations.find(l => l.name === toLoc);

      const { data, error } = await supabase
        .from("transfer_orders")
        .insert({
          user_id: user.user.id,
          from_location: fromLoc,
          from_location_id: fromLocObj?.id || null,
          to_location: toLoc,
          to_location_id: toLocObj?.id || null,
          expected_ship_date: shipDate || null,
          status: "draft",
          notes: notes || null,
        })
        .select()
        .single();
      if (error) throw error;

      const lines = newLines.map(l => ({
        user_id: user.user!.id,
        transfer_order_id: data.id,
        sku: l.sku,
        product_title: l.product_title,
        quantity: l.quantity,
        shopify_variant_id: l.shopify_variant_id || null,
        shipped_qty: 0,
        received_qty: 0,
      }));

      await supabase.from("transfer_order_lines").insert(lines);

      addAuditEntry("transfer_created", `Transfer ${fromLoc} → ${toLoc}, ${newLines.length} items`);
      toast.success("Transfer order created");
      setNewLines([]);
      setNotes("");
      setShipDate("");
      loadTransfers();
      setScreen("list");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create transfer");
    } finally { setCreating(false); }
  };

  /* ─── Open Detail ─── */

  const openDetail = async (to: TransferOrder) => {
    setActiveTO(to);
    const { data } = await supabase
      .from("transfer_order_lines")
      .select("*")
      .eq("transfer_order_id", to.id)
      .order("product_title");
    setActiveLines((data || []) as TransferLine[]);
    setScreen("detail");
  };

  /* ─── Mark Shipped ─── */

  const handleShip = async () => {
    if (!activeTO) return;
    setProcessing(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      // Update shipped_qty to match quantity for all lines
      for (const line of activeLines) {
        const shippedQty = line.quantity; // full ship by default
        await supabase
          .from("transfer_order_lines")
          .update({ shipped_qty: shippedQty })
          .eq("id", line.id);

        // Decrease inventory at source via Shopify
        if (line.shopify_inventory_item_id && activeTO.from_location_id) {
          try {
            await supabase.functions.invoke("shopify-proxy", {
              body: {
                action: "graphql_adjust_inventory",
                inventory_changes: [{
                  inventoryItemId: line.shopify_inventory_item_id.startsWith("gid://")
                    ? line.shopify_inventory_item_id
                    : `gid://shopify/InventoryItem/${line.shopify_inventory_item_id}`,
                  locationId: activeTO.from_location_id.startsWith("gid://")
                    ? activeTO.from_location_id
                    : `gid://shopify/Location/${activeTO.from_location_id}`,
                  delta: -shippedQty,
                }],
                reason: "transfer_out",
              },
            });
          } catch { /* non-fatal */ }
        }
      }

      // Check if partial
      const allShipped = activeLines.every(l => l.quantity === l.quantity);
      await supabase
        .from("transfer_orders")
        .update({ status: "shipped" })
        .eq("id", activeTO.id);

      addAuditEntry("transfer_shipped", `Shipped transfer ${activeTO.from_location} → ${activeTO.to_location}`);
      toast.success("Transfer marked as shipped");
      await openDetail({ ...activeTO, status: "shipped" });
      loadTransfers();
    } catch (err) {
      toast.error("Failed to ship transfer");
    } finally { setProcessing(false); }
  };

  /* ─── Mark Received ─── */

  const handleReceive = async () => {
    if (!activeTO) return;
    setProcessing(true);
    try {
      for (const line of activeLines) {
        const receivedQty = line.shipped_qty || line.quantity;
        await supabase
          .from("transfer_order_lines")
          .update({ received_qty: receivedQty })
          .eq("id", line.id);

        // Increase inventory at destination via Shopify
        if (line.shopify_inventory_item_id && activeTO.to_location_id) {
          try {
            await supabase.functions.invoke("shopify-proxy", {
              body: {
                action: "graphql_adjust_inventory",
                inventory_changes: [{
                  inventoryItemId: line.shopify_inventory_item_id.startsWith("gid://")
                    ? line.shopify_inventory_item_id
                    : `gid://shopify/InventoryItem/${line.shopify_inventory_item_id}`,
                  locationId: activeTO.to_location_id.startsWith("gid://")
                    ? activeTO.to_location_id
                    : `gid://shopify/Location/${activeTO.to_location_id}`,
                  delta: receivedQty,
                }],
                reason: "transfer_in",
              },
            });
          } catch { /* non-fatal */ }
        }
      }

      await supabase
        .from("transfer_orders")
        .update({ status: "received" })
        .eq("id", activeTO.id);

      addAuditEntry("transfer_received", `Received transfer at ${activeTO.to_location}`);
      toast.success("Transfer marked as received");
      await openDetail({ ...activeTO, status: "received" });
      loadTransfers();
    } catch {
      toast.error("Failed to receive transfer");
    } finally { setProcessing(false); }
  };

  /* ─── Filtered list ─── */

  const filtered = transfers.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return t.from_location.toLowerCase().includes(q) ||
        t.to_location.toLowerCase().includes(q) ||
        (t.notes || "").toLowerCase().includes(q);
    }
    return true;
  });

  /* ═══════════════ SCREENS ═══════════════ */

  // ── LIST ──
  if (screen === "list") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold flex-1">Transfer Orders</h1>
          <Button onClick={() => setScreen("create")} size="sm">
            <Plus className="w-4 h-4 mr-1" /> New Transfer
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search transfers…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="received">Received</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ArrowRightLeft className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No transfer orders yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map(t => (
              <Card
                key={t.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => openDetail(t)}
              >
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <ArrowRightLeft className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {t.from_location} → {t.to_location}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()} · {t.line_count || 0} items
                      {t.notes ? ` · ${t.notes}` : ""}
                    </p>
                  </div>
                  <Badge className={STATUS_COLORS[t.status] || "bg-muted"}>{t.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── CREATE ──
  if (screen === "create") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setScreen("list")}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">New Transfer</h1>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> From
              </label>
              <Select value={fromLoc} onValueChange={setFromLoc}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> To
              </label>
              <Select value={toLoc} onValueChange={setToLoc}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Expected Ship Date
            </label>
            <Input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Restock for weekend" />
          </div>

          {/* Add items */}
          <div>
            <label className="text-sm font-medium mb-1 block flex items-center gap-1">
              <ScanBarcode className="w-3.5 h-3.5" /> Add Items (SKU / Barcode)
            </label>
            <div className="flex gap-2">
              <Input
                ref={skuRef}
                value={skuInput}
                onChange={e => setSkuInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddSku(); } }}
                placeholder="Scan or type SKU…"
                className="font-mono"
              />
              <Button variant="outline" size="sm" onClick={handleAddSku} disabled={!skuInput.trim()}>Add</Button>
            </div>
          </div>

          {newLines.length > 0 && (
            <div className="border rounded-lg overflow-auto max-h-[30vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newLines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                      <TableCell className="text-sm truncate max-w-[150px]">{l.product_title}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={e => setNewLines(prev => prev.map((ll, ii) => ii === i ? { ...ll, quantity: Math.max(1, parseInt(e.target.value) || 1) } : ll))}
                          className="w-16 h-7 text-right text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setNewLines(prev => prev.filter((_, ii) => ii !== i))}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Button onClick={handleCreate} disabled={creating || newLines.length === 0} className="w-full">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
            Create Transfer ({newLines.reduce((s, l) => s + l.quantity, 0)} units)
          </Button>
        </div>
      </div>
    );
  }

  // ── DETAIL ──
  if (screen === "detail" && activeTO) {
    const isDraft = activeTO.status === "draft";
    const isShipped = activeTO.status === "shipped";
    const isReceived = activeTO.status === "received";
    const totalQty = activeLines.reduce((s, l) => s + l.quantity, 0);
    const totalShipped = activeLines.reduce((s, l) => s + l.shipped_qty, 0);
    const totalReceived = activeLines.reduce((s, l) => s + l.received_qty, 0);

    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => { setScreen("list"); setActiveTO(null); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">
              {activeTO.from_location} → {activeTO.to_location}
            </h1>
            <p className="text-xs text-muted-foreground">
              Created {new Date(activeTO.created_at).toLocaleDateString()}
              {activeTO.expected_ship_date ? ` · Ship by ${new Date(activeTO.expected_ship_date).toLocaleDateString()}` : ""}
              {activeTO.notes ? ` · ${activeTO.notes}` : ""}
            </p>
          </div>
          <Badge className={STATUS_COLORS[activeTO.status] || "bg-muted"}>{activeTO.status}</Badge>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{totalQty}</p>
            <p className="text-xs text-muted-foreground">Ordered</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{totalShipped}</p>
            <p className="text-xs text-muted-foreground">Shipped</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{totalReceived}</p>
            <p className="text-xs text-muted-foreground">Received</p>
          </CardContent></Card>
        </div>

        {/* Line items */}
        <div className="border rounded-lg overflow-auto max-h-[45vh] mb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Shipped</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeLines.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                  <TableCell className="text-sm truncate max-w-[200px]">{l.product_title || "—"}</TableCell>
                  <TableCell className="text-right">{l.quantity}</TableCell>
                  <TableCell className="text-right">{l.shipped_qty}</TableCell>
                  <TableCell className="text-right">{l.received_qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {isDraft && (
            <Button onClick={handleShip} disabled={processing} className="flex-1">
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
              Mark as Shipped
            </Button>
          )}
          {isShipped && (
            <Button onClick={handleReceive} disabled={processing} className="flex-1">
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Package className="w-4 h-4 mr-2" />}
              Mark as Received
            </Button>
          )}
          {isReceived && (
            <div className="flex items-center gap-2 text-primary">
              <Check className="w-5 h-5" />
              <span className="text-sm font-medium">Transfer complete</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default TransferOrderPanel;
