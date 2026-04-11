import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft, Plus, Trash2, Check, X, AlertTriangle,
  FileText, Upload, Loader2, Search, Edit2, Package,
  ArrowDownToLine, Link2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";
import { adjustInventory, findVariantBySKU, getConnection, getLocations } from "@/lib/shopify-api";

// ── Types ──────────────────────────────────────────────────
interface POLine {
  id: string;
  product_title: string;
  sku: string;
  color: string;
  size: string;
  expected_qty: number;
  received_qty: number;
  expected_cost: number;
  actual_cost: number | null;
  notes: string;
}

export type POStatus = "draft" | "sent" | "awaiting" | "partial" | "received" | "discrepancy" | "closed";

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  expected_date: string | null;
  notes: string | null;
  status: POStatus;
  total_cost: number;
  linked_document_id: string | null;
  match_result: MatchResult | null;
  created_at: string;
  updated_at: string;
  lines: POLine[];
}

interface MatchLine {
  product: string;
  sku: string;
  poQty: number;
  invoiceQty: number;
  poCost: number;
  invoiceCost: number;
  status: "match" | "qty_diff" | "price_diff" | "not_on_po" | "missing";
}

interface MatchResult {
  matchedAt: string;
  invoiceName: string;
  lines: MatchLine[];
  summary: { matched: number; qtyDiff: number; priceDiff: number; notOnPo: number; missing: number };
}

// For external use
export function getPurchaseOrders(): PurchaseOrder[] {
  try { return JSON.parse(localStorage.getItem("purchase_orders") || "[]"); } catch { return []; }
}

const STATUS_BADGES: Record<POStatus, { emoji: string; label: string; cls: string }> = {
  draft: { emoji: "📝", label: "Draft", cls: "bg-muted text-muted-foreground" },
  sent: { emoji: "📤", label: "Sent", cls: "bg-primary/15 text-primary" },
  awaiting: { emoji: "⏳", label: "Awaiting", cls: "bg-secondary/15 text-secondary" },
  partial: { emoji: "🔶", label: "Partial", cls: "bg-secondary/15 text-secondary" },
  received: { emoji: "✅", label: "Received", cls: "bg-success/15 text-success" },
  discrepancy: { emoji: "⚠", label: "Discrepancy", cls: "bg-destructive/15 text-destructive" },
  closed: { emoji: "🔒", label: "Closed", cls: "bg-muted text-muted-foreground" },
};

function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10); }

// ── Component ──────────────────────────────────────────────
interface Props { onBack: () => void; }
type View = "list" | "create" | "edit" | "receive" | "match" | "detail";

const PurchaseOrderPanel = ({ onBack }: Props) => {
  const [view, setView] = useState<View>("list");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailPO, setDetailPO] = useState<PurchaseOrder | null>(null);

  // Suppliers from DB
  const [dbSuppliers, setDbSuppliers] = useState<{ id: string; name: string }[]>([]);

  // Create/Edit form
  const [poNumber, setPoNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [expectedDate, setExpectedDate] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [lines, setLines] = useState<POLine[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Receive state
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [receiveCosts, setReceiveCosts] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState(false);
  const [showReceiveConfirm, setShowReceiveConfirm] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");

  // Match state
  const [matchingPO, setMatchingPO] = useState<PurchaseOrder | null>(null);
  const [matchStep, setMatchStep] = useState<"upload" | "matching" | "result">("upload");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // Linked documents
  const [linkedDocs, setLinkedDocs] = useState<{ id: string; document_number: string | null; date: string | null; total: number }[]>([]);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<{ id: string; document_number: string | null; supplier_name: string | null; date: string | null; total: number }[]>([]);

  // Shopify connection for inventory sync
  const [hasShopify, setHasShopify] = useState(false);
  const [shopifyLocationId, setShopifyLocationId] = useState<string | null>(null);

  // ── Load data ───────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!pos) { setLoading(false); return; }

    // Load lines for all POs
    const poIds = pos.map(p => p.id);
    const { data: allLines } = poIds.length > 0
      ? await supabase.from("purchase_order_lines").select("*").in("purchase_order_id", poIds)
      : { data: [] };

    const linesByPO: Record<string, POLine[]> = {};
    for (const line of (allLines || [])) {
      if (!linesByPO[line.purchase_order_id]) linesByPO[line.purchase_order_id] = [];
      linesByPO[line.purchase_order_id].push({
        id: line.id,
        product_title: line.product_title,
        sku: line.sku || "",
        color: line.color || "",
        size: line.size || "",
        expected_qty: line.expected_qty,
        received_qty: line.received_qty,
        expected_cost: Number(line.expected_cost),
        actual_cost: line.actual_cost ? Number(line.actual_cost) : null,
        notes: line.notes || "",
      });
    }

    const mapped: PurchaseOrder[] = pos.map(po => ({
      id: po.id,
      po_number: po.po_number,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      expected_date: po.expected_date,
      notes: po.notes,
      status: po.status as POStatus,
      total_cost: Number(po.total_cost),
      linked_document_id: po.linked_document_id,
      match_result: po.match_result as unknown as MatchResult | null,
      created_at: po.created_at,
      updated_at: po.updated_at,
      lines: linesByPO[po.id] || [],
    }));

    setOrders(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Load suppliers
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("suppliers").select("id, name").order("name");
      setDbSuppliers(data || []);
    })();
  }, []);

  // Check Shopify
  useEffect(() => {
    (async () => {
      const conn = await getConnection();
      if (conn) {
        setHasShopify(true);
        if (conn.default_location_id) setShopifyLocationId(conn.default_location_id);
        else {
          const locs = await getLocations();
          const active = locs.find(l => l.active);
          if (active) setShopifyLocationId(active.id);
        }
      }
    })();
  }, []);

  const filteredSuppliers = supplier.trim()
    ? dbSuppliers.filter(s => s.name.toLowerCase().includes(supplier.toLowerCase()))
    : dbSuppliers;

  const poTotal = lines.reduce((s, l) => s + l.expected_qty * l.expected_cost, 0);

  // ── Generate PO number ──────────────────────────────────
  const generatePONumber = () => {
    const year = new Date().getFullYear();
    const next = orders.length + 1;
    return `PO-${year}-${String(next).padStart(3, "0")}`;
  };

  const newLine = (): POLine => ({
    id: uid(), product_title: "", sku: "", color: "", size: "",
    expected_qty: 0, received_qty: 0, expected_cost: 0, actual_cost: null, notes: "",
  });

  const resetForm = () => {
    setPoNumber(generatePONumber());
    setSupplier("");
    setSupplierId(null);
    setExpectedDate("");
    setPoNotes("");
    setLines([newLine()]);
    setEditingId(null);
  };

  // ── Save PO ─────────────────────────────────────────────
  const handleSave = async (asDraft: boolean) => {
    if (!supplier.trim()) { toast.error("Supplier name required"); return; }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }

    const validLines = lines.filter(l => l.product_title.trim());
    const total = validLines.reduce((s, l) => s + l.expected_qty * l.expected_cost, 0);

    if (editingId) {
      // Update existing PO
      const { error } = await supabase.from("purchase_orders").update({
        po_number: poNumber,
        supplier_id: supplierId,
        supplier_name: supplier,
        expected_date: expectedDate || null,
        notes: poNotes || null,
        status: asDraft ? "draft" : "sent",
        total_cost: total,
      }).eq("id", editingId);

      if (error) { toast.error("Failed to save PO"); setSaving(false); return; }

      // Delete old lines and reinsert
      await supabase.from("purchase_order_lines").delete().eq("purchase_order_id", editingId);
      if (validLines.length > 0) {
        await supabase.from("purchase_order_lines").insert(
          validLines.map(l => ({
            user_id: session.user.id,
            purchase_order_id: editingId,
            product_title: l.product_title,
            sku: l.sku || null,
            color: l.color || null,
            size: l.size || null,
            expected_qty: l.expected_qty,
            received_qty: l.received_qty,
            expected_cost: l.expected_cost,
            actual_cost: l.actual_cost,
            notes: l.notes || null,
          }))
        );
      }
    } else {
      // Create new PO
      const { data: po, error } = await supabase.from("purchase_orders").insert({
        user_id: session.user.id,
        po_number: poNumber,
        supplier_id: supplierId,
        supplier_name: supplier,
        expected_date: expectedDate || null,
        notes: poNotes || null,
        status: asDraft ? "draft" : "sent",
        total_cost: total,
      }).select("id").single();

      if (error || !po) { toast.error("Failed to create PO"); setSaving(false); return; }

      if (validLines.length > 0) {
        await supabase.from("purchase_order_lines").insert(
          validLines.map(l => ({
            user_id: session.user.id,
            purchase_order_id: po.id,
            product_title: l.product_title,
            sku: l.sku || null,
            color: l.color || null,
            size: l.size || null,
            expected_qty: l.expected_qty,
            expected_cost: l.expected_cost,
            notes: l.notes || null,
          }))
        );
      }
    }

    addAuditEntry("PO", `PO ${asDraft ? "drafted" : "created"}: ${poNumber} — ${supplier} — ${validLines.length} lines`);
    toast.success(editingId ? "PO updated" : "PO created");
    resetForm();
    await loadOrders();
    setView("list");
    setSaving(false);
  };

  // ── Status change ───────────────────────────────────────
  const handleStatusChange = async (id: string, status: POStatus) => {
    await supabase.from("purchase_orders").update({ status }).eq("id", id);
    await loadOrders();
  };

  // ── Delete PO ───────────────────────────────────────────
  const handleDelete = async (id: string) => {
    const po = orders.find(o => o.id === id);
    if (!confirm(`Delete ${po?.po_number}?`)) return;
    await supabase.from("purchase_orders").delete().eq("id", id);
    toast.success("PO deleted");
    await loadOrders();
  };

  // ── Edit PO ─────────────────────────────────────────────
  const handleEdit = (po: PurchaseOrder) => {
    setEditingId(po.id);
    setPoNumber(po.po_number);
    setSupplier(po.supplier_name);
    setSupplierId(po.supplier_id);
    setExpectedDate(po.expected_date || "");
    setPoNotes(po.notes || "");
    setLines(po.lines.length > 0 ? po.lines : [newLine()]);
    setView("edit");
  };

  // ── Receive stock ───────────────────────────────────────
  const startReceive = (po: PurchaseOrder) => {
    setReceivePO(po);
    const qtys: Record<string, number> = {};
    const costs: Record<string, number> = {};
    po.lines.forEach(l => {
      qtys[l.id] = l.expected_qty - l.received_qty;
      costs[l.id] = l.actual_cost ?? l.expected_cost;
    });
    setReceiveQtys(qtys);
    setReceiveCosts(costs);
    setBarcodeInput("");
    setView("receive");
  };

  // Barcode scan handler for receive view
  const handleBarcodeScan = (barcode: string) => {
    if (!receivePO || !barcode.trim()) return;
    const line = receivePO.lines.find(l =>
      l.sku.toLowerCase() === barcode.trim().toLowerCase()
    );
    if (line) {
      const remaining = line.expected_qty - line.received_qty;
      const current = receiveQtys[line.id] || 0;
      if (current < remaining) {
        setReceiveQtys(prev => ({ ...prev, [line.id]: current + 1 }));
        toast.success(`+1 ${line.product_title || line.sku}`);
      } else {
        toast(`${line.sku} already fully counted`, { icon: "⚠️" });
      }
    } else {
      toast.error(`SKU "${barcode}" not found on this PO`);
    }
    setBarcodeInput("");
  };

  // Close PO handler
  const handleClosePO = async (po: PurchaseOrder) => {
    await supabase.from("purchase_orders").update({ status: "closed" }).eq("id", po.id);
    addAuditEntry("PO", `Closed PO ${po.po_number}`);
    toast.success(`${po.po_number} closed`);
    await loadOrders();
    if (detailPO?.id === po.id) setDetailPO(null);
    setView("list");
  };

  const handleReceive = async () => {
    if (!receivePO) return;
    setShowReceiveConfirm(false);
    setReceiving(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setReceiving(false); return; }

    // Update received_qty and actual_cost on each line
    const receiveDetails: string[] = [];
    for (const line of receivePO.lines) {
      const qty = receiveQtys[line.id] || 0;
      if (qty > 0) {
        const newReceived = line.received_qty + qty;
        const actualCost = receiveCosts[line.id] ?? line.expected_cost;
        await supabase.from("purchase_order_lines").update({
          received_qty: newReceived,
          actual_cost: actualCost,
        }).eq("id", line.id);

        receiveDetails.push(`${line.sku || line.product_title}: ${qty} @ $${actualCost.toFixed(2)}`);

        // Update variant cost for COGS if we have a matching variant
        if (line.sku) {
          const { data: variant } = await supabase.from("variants")
            .select("id")
            .eq("sku", line.sku)
            .maybeSingle();
          if (variant) {
            await supabase.from("variants").update({ cost: actualCost }).eq("id", variant.id);
          }
        }

        // Sync inventory to Shopify if connected
        if (hasShopify && shopifyLocationId && line.sku) {
          try {
            const match = await findVariantBySKU(line.sku);
            if (match?.inventory_item_id) {
              await adjustInventory(shopifyLocationId, match.inventory_item_id, qty);
            }
          } catch (err) {
            console.error(`Shopify inventory sync failed for ${line.sku}:`, err);
          }
        }
      }
    }

    // Determine new PO status
    const updatedLines = receivePO.lines.map(l => ({
      ...l,
      received_qty: l.received_qty + (receiveQtys[l.id] || 0),
    }));
    const allReceived = updatedLines.every(l => l.received_qty >= l.expected_qty);
    const anyReceived = updatedLines.some(l => l.received_qty > 0);
    const newStatus: POStatus = allReceived ? "received" : anyReceived ? "partial" : receivePO.status;

    // Calculate backorder info for partial receives
    const backordered = updatedLines
      .filter(l => l.received_qty < l.expected_qty)
      .map(l => `${l.sku || l.product_title}: ${l.expected_qty - l.received_qty} backordered`);

    await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", receivePO.id);

    const totalReceived = Object.values(receiveQtys).reduce((a, b) => a + b, 0);
    const auditDetails = receiveDetails.join("; ");
    const backorderNote = backordered.length > 0 ? ` | Backordered: ${backordered.join("; ")}` : "";
    addAuditEntry("PO Receive", `Received ${totalReceived} units on ${receivePO.po_number} — status: ${newStatus} | ${auditDetails}${backorderNote}`);
    toast.success(`${totalReceived} units received`);

    setReceiving(false);
    await loadOrders();
    setView("list");
  };

  // ── Link invoice ────────────────────────────────────────
  const openLinkDialog = async (po: PurchaseOrder) => {
    setDetailPO(po);
    const { data } = await supabase.from("documents")
      .select("id, document_number, supplier_name, date, total")
      .order("created_at", { ascending: false })
      .limit(20);
    setAvailableDocs(data || []);
    setShowLinkDialog(true);
  };

  const linkDocument = async (docId: string) => {
    if (!detailPO) return;
    await supabase.from("purchase_orders").update({ linked_document_id: docId }).eq("id", detailPO.id);
    toast.success("Invoice linked to PO");
    setShowLinkDialog(false);
    await loadOrders();
  };

  // ── Match invoice (simulation — uses PO lines vs uploaded invoice) ──
  const startMatch = (po: PurchaseOrder) => {
    setMatchingPO(po);
    setMatchStep("upload");
    setMatchResult(null);
    setView("match");
  };

  const runMatch = async () => {
    if (!matchingPO) return;
    setMatchStep("matching");

    // If PO has a linked document, match against its lines
    if (matchingPO.linked_document_id) {
      const { data: docLines } = await supabase
        .from("document_lines")
        .select("product_title, sku, quantity, unit_cost")
        .eq("document_id", matchingPO.linked_document_id);

      if (docLines && docLines.length > 0) {
        const matchLines: MatchLine[] = matchingPO.lines.map(poLine => {
          const invLine = docLines.find(d =>
            (d.sku && poLine.sku && d.sku.toLowerCase() === poLine.sku.toLowerCase()) ||
            (d.product_title && poLine.product_title && d.product_title.toLowerCase().includes(poLine.product_title.toLowerCase()))
          );
          if (!invLine) {
            return { product: poLine.product_title, sku: poLine.sku, poQty: poLine.expected_qty, invoiceQty: 0, poCost: poLine.expected_cost, invoiceCost: 0, status: "missing" as const };
          }
          const qtyMatch = invLine.quantity === poLine.expected_qty;
          const costMatch = Math.abs(Number(invLine.unit_cost) - poLine.expected_cost) < 0.01;
          return {
            product: poLine.product_title,
            sku: poLine.sku,
            poQty: poLine.expected_qty,
            invoiceQty: invLine.quantity,
            poCost: poLine.expected_cost,
            invoiceCost: Number(invLine.unit_cost),
            status: (!qtyMatch ? "qty_diff" : !costMatch ? "price_diff" : "match") as MatchLine["status"],
          };
        });

        // Check for invoice lines not on PO
        for (const inv of docLines) {
          const onPO = matchingPO.lines.some(pl =>
            (pl.sku && inv.sku && pl.sku.toLowerCase() === inv.sku.toLowerCase()) ||
            (pl.product_title && inv.product_title && inv.product_title.toLowerCase().includes(pl.product_title.toLowerCase()))
          );
          if (!onPO) {
            matchLines.push({ product: inv.product_title || "Unknown", sku: inv.sku || "", poQty: 0, invoiceQty: inv.quantity, poCost: 0, invoiceCost: Number(inv.unit_cost), status: "not_on_po" });
          }
        }

        const summary = {
          matched: matchLines.filter(l => l.status === "match").length,
          qtyDiff: matchLines.filter(l => l.status === "qty_diff").length,
          priceDiff: matchLines.filter(l => l.status === "price_diff").length,
          notOnPo: matchLines.filter(l => l.status === "not_on_po").length,
          missing: matchLines.filter(l => l.status === "missing").length,
        };

        const result: MatchResult = { matchedAt: new Date().toISOString(), invoiceName: "Linked invoice", lines: matchLines, summary };
        setMatchResult(result);
        setMatchStep("result");

        const hasIssues = summary.qtyDiff + summary.priceDiff + summary.notOnPo + summary.missing > 0;
        await supabase.from("purchase_orders").update({
          status: hasIssues ? "discrepancy" : "received",
          match_result: result as any,
        }).eq("id", matchingPO.id);
        await loadOrders();
        return;
      }
    }

    // Simulated match if no linked doc
    setTimeout(async () => {
      const matchLines: MatchLine[] = matchingPO.lines.map((line, i) => {
        if (i % 3 === 0) return { product: line.product_title, sku: line.sku, poQty: line.expected_qty, invoiceQty: line.expected_qty, poCost: line.expected_cost, invoiceCost: line.expected_cost, status: "match" as const };
        if (i % 3 === 1) return { product: line.product_title, sku: line.sku, poQty: line.expected_qty, invoiceQty: Math.max(1, line.expected_qty - 2), poCost: line.expected_cost, invoiceCost: line.expected_cost, status: "qty_diff" as const };
        return { product: line.product_title, sku: line.sku, poQty: line.expected_qty, invoiceQty: line.expected_qty, poCost: line.expected_cost, invoiceCost: +(line.expected_cost * 1.05).toFixed(2), status: "price_diff" as const };
      });

      const summary = {
        matched: matchLines.filter(l => l.status === "match").length,
        qtyDiff: matchLines.filter(l => l.status === "qty_diff").length,
        priceDiff: matchLines.filter(l => l.status === "price_diff").length,
        notOnPo: 0,
        missing: 0,
      };

      const result: MatchResult = { matchedAt: new Date().toISOString(), invoiceName: "Uploaded invoice", lines: matchLines, summary };
      setMatchResult(result);
      setMatchStep("result");

      const hasIssues = summary.qtyDiff + summary.priceDiff > 0;
      await supabase.from("purchase_orders").update({
        status: hasIssues ? "discrepancy" : "received",
        match_result: result as any,
      }).eq("id", matchingPO.id);
      await loadOrders();
    }, 2000);
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button onClick={view === "list" || view === "detail" ? (view === "detail" ? () => { setDetailPO(null); setView("list"); } : onBack) : () => { resetForm(); setDetailPO(null); setView("list"); }}
        className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ChevronLeft className="w-4 h-4" /> {view === "list" ? "Back" : view === "detail" ? "All purchase orders" : "All purchase orders"}
      </button>

      {/* ── LIST VIEW ─────────────────────────────────────── */}
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold font-display">📋 Purchase Orders</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{orders.length} orders</p>
            </div>
            <Button variant="teal" size="sm" onClick={() => { resetForm(); setView("create"); }}>
              <Plus className="w-4 h-4 mr-1" /> New PO
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-16 text-sm text-muted-foreground">Loading…</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-sm font-medium">No purchase orders yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create a PO before goods arrive, then match the invoice when it comes in.</p>
              <Button variant="teal" className="mt-4" onClick={() => { resetForm(); setView("create"); }}>
                <Plus className="w-4 h-4 mr-1" /> Create first PO
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-card rounded-lg border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total POs</p>
                  <p className="text-lg font-bold">{orders.length}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Open</p>
                  <p className="text-lg font-bold">{orders.filter(o => !["received", "discrepancy"].includes(o.status)).length}</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total value</p>
                  <p className="text-lg font-bold">${orders.reduce((a, o) => a + o.total_cost, 0).toLocaleString()}</p>
                </div>
              </div>

              {orders.map(po => {
                const badge = STATUS_BADGES[po.status];
                const receivedUnits = po.lines.reduce((a, l) => a + l.received_qty, 0);
                const expectedUnits = po.lines.reduce((a, l) => a + l.expected_qty, 0);
                const backordered = po.lines.reduce((a, l) => a + Math.max(0, l.expected_qty - l.received_qty), 0);
                return (
                  <div key={po.id} className="bg-card rounded-lg border border-border p-4 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => { setDetailPO(po); setView("detail"); }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold font-mono">{po.po_number}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.emoji} {badge.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {po.expected_date || "No date"}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{po.supplier_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {po.lines.length} line{po.lines.length !== 1 ? "s" : ""} · ${po.total_cost.toFixed(2)}
                      {receivedUnits > 0 && ` · ${receivedUnits}/${expectedUnits} received`}
                      {po.status === "partial" && backordered > 0 && ` · ${backordered} backordered`}
                    </p>
                    {po.linked_document_id && (
                      <p className="text-[10px] text-primary flex items-center gap-1 mt-1">
                        <Link2 className="w-3 h-3" /> Invoice linked
                      </p>
                    )}
                    <div className="flex gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
                      {["draft", "sent", "awaiting", "partial"].includes(po.status) && (
                        <Button variant="teal" size="sm" className="h-7 text-xs" onClick={() => startReceive(po)}>
                          <ArrowDownToLine className="w-3 h-3 mr-1" /> Receive
                        </Button>
                      )}
                      {["received", "discrepancy"].includes(po.status) && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleClosePO(po)}>
                          🔒 Close PO
                        </Button>
                      )}
                      {["sent", "awaiting", "draft"].includes(po.status) && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => startMatch(po)}>
                          <Search className="w-3 h-3 mr-1" /> Match
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleEdit(po)}>
                        <Edit2 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      {po.status === "draft" && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(po.id, "sent")}>
                          📤 Send
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(po.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── DETAIL VIEW ───────────────────────────────────── */}
      {view === "detail" && detailPO && (() => {
        const badge = STATUS_BADGES[detailPO.status];
        const totalExpected = detailPO.lines.reduce((a, l) => a + l.expected_qty, 0);
        const totalReceived = detailPO.lines.reduce((a, l) => a + l.received_qty, 0);
        const totalBackordered = detailPO.lines.reduce((a, l) => a + Math.max(0, l.expected_qty - l.received_qty), 0);
        return (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold font-display flex items-center gap-2">
                  {detailPO.po_number}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                    {badge.emoji} {badge.label}
                  </span>
                </h1>
                <p className="text-sm text-muted-foreground">{detailPO.supplier_name}</p>
              </div>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-lg font-bold">{totalExpected}</p>
                <p className="text-[10px] text-muted-foreground">Ordered</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-lg font-bold text-success">{totalReceived}</p>
                <p className="text-[10px] text-muted-foreground">Received</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className={`text-lg font-bold ${totalBackordered > 0 ? "text-secondary" : "text-muted-foreground"}`}>{totalBackordered}</p>
                <p className="text-[10px] text-muted-foreground">Backordered</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-lg font-bold">${detailPO.total_cost.toFixed(0)}</p>
                <p className="text-[10px] text-muted-foreground">Total Cost</p>
              </div>
            </div>

            {detailPO.expected_date && (
              <p className="text-xs text-muted-foreground mb-2">Expected: {detailPO.expected_date}</p>
            )}
            {detailPO.notes && (
              <p className="text-xs text-muted-foreground mb-4 italic">{detailPO.notes}</p>
            )}

            {/* Line items table */}
            <div className="bg-card rounded-lg border border-border overflow-hidden mb-4">
              <div className="grid grid-cols-[1fr_60px_60px_60px_70px] gap-1 px-3 py-2 bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Product</span>
                <span className="text-center">Ordered</span>
                <span className="text-center">Received</span>
                <span className="text-center">B/O</span>
                <span className="text-right">Cost</span>
              </div>
              <div className="divide-y divide-border">
                {detailPO.lines.map(line => {
                  const backorder = Math.max(0, line.expected_qty - line.received_qty);
                  return (
                    <div key={line.id} className="grid grid-cols-[1fr_60px_60px_60px_70px] gap-1 px-3 py-2.5 text-xs items-center">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{line.product_title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {line.sku && `SKU: ${line.sku}`}{line.color && ` · ${line.color}`}{line.size && ` · ${line.size}`}
                        </p>
                      </div>
                      <span className="text-center font-mono">{line.expected_qty}</span>
                      <span className={`text-center font-mono ${line.received_qty >= line.expected_qty ? "text-success" : ""}`}>
                        {line.received_qty}
                      </span>
                      <span className={`text-center font-mono ${backorder > 0 ? "text-secondary font-semibold" : "text-muted-foreground"}`}>
                        {backorder}
                      </span>
                      <span className="text-right font-mono">
                        ${(line.actual_cost ?? line.expected_cost).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              {["draft", "sent", "awaiting", "partial"].includes(detailPO.status) && (
                <Button variant="teal" size="sm" onClick={() => startReceive(detailPO)}>
                  <ArrowDownToLine className="w-4 h-4 mr-1" /> Receive Stock
                </Button>
              )}
              {["received", "discrepancy"].includes(detailPO.status) && (
                <Button variant="outline" size="sm" onClick={() => handleClosePO(detailPO)}>
                  🔒 Close PO
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => handleEdit(detailPO)}>
                <Edit2 className="w-4 h-4 mr-1" /> Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openLinkDialog(detailPO)}>
                <Link2 className="w-4 h-4 mr-1" /> Link Invoice
              </Button>
            </div>
          </>
        );
      })()}

      {(view === "create" || view === "edit") && (
        <>
          <h1 className="text-2xl font-bold font-display mb-4">
            {view === "edit" ? "Edit Purchase Order" : "New Purchase Order"}
          </h1>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">PO Number</label>
              <Input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="font-mono" />
            </div>

            <div className="relative">
              <label className="text-xs text-muted-foreground mb-1 block">Supplier</label>
              <Input
                value={supplier}
                onChange={e => { setSupplier(e.target.value); setSupplierId(null); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. Jantzen, Seafolly..."
              />
              {showSuggestions && filteredSuppliers.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-32 overflow-y-auto">
                  {filteredSuppliers.map(s => (
                    <button key={s.id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                      onMouseDown={() => { setSupplier(s.name); setSupplierId(s.id); setShowSuggestions(false); }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Expected arrival date</label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
              <textarea
                value={poNotes}
                onChange={e => setPoNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none"
                placeholder="e.g. Min order $500, ships from Sydney"
              />
            </div>

            {/* Product lines */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block font-semibold uppercase tracking-wider">Product lines</label>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={line.id} className="bg-muted/30 rounded-lg border border-border p-3">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <Input
                        placeholder="Product name"
                        value={line.product_title}
                        onChange={e => { const u = [...lines]; u[i] = { ...u[i], product_title: e.target.value }; setLines(u); }}
                        className="text-xs h-9"
                      />
                      <Input
                        placeholder="SKU"
                        value={line.sku}
                        onChange={e => { const u = [...lines]; u[i] = { ...u[i], sku: e.target.value }; setLines(u); }}
                        className="text-xs h-9 font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Qty</label>
                        <Input
                          type="number"
                          value={line.expected_qty || ""}
                          onChange={e => { const u = [...lines]; u[i] = { ...u[i], expected_qty: +e.target.value }; setLines(u); }}
                          className="text-xs h-9 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Cost ($)</label>
                        <Input
                          type="number" step="0.01"
                          value={line.expected_cost || ""}
                          onChange={e => { const u = [...lines]; u[i] = { ...u[i], expected_cost: +e.target.value }; setLines(u); }}
                          className="text-xs h-9 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Colour</label>
                        <Input
                          value={line.color}
                          onChange={e => { const u = [...lines]; u[i] = { ...u[i], color: e.target.value }; setLines(u); }}
                          className="text-xs h-9"
                        />
                      </div>
                      <div className="flex items-end">
                        {lines.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-9 w-9 text-destructive" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setLines([...lines, newLine()])}>
                <Plus className="w-3 h-3 mr-1" /> Add line
              </Button>
            </div>

            <div className="bg-card rounded-lg border border-border p-3 flex items-center justify-between">
              <span className="text-sm font-medium">PO Total</span>
              <span className="text-lg font-bold font-mono">${poTotal.toFixed(2)}</span>
            </div>

            <div className="flex gap-2">
              <Button variant="teal" className="flex-1 h-11" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />} Save PO
              </Button>
              <Button variant="outline" className="flex-1 h-11" onClick={() => handleSave(true)} disabled={saving}>
                Save as draft
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── RECEIVE VIEW ──────────────────────────────────── */}
      {view === "receive" && receivePO && (
        <>
          <h1 className="text-xl font-bold font-display mb-1">Receive Stock</h1>
          <p className="text-sm text-muted-foreground mb-3">
            {receivePO.po_number} — {receivePO.supplier_name}
          </p>

          {/* Barcode scanner input */}
          <div className="bg-card rounded-lg border-2 border-dashed border-primary/30 p-3 mb-4">
            <label className="text-xs font-semibold text-muted-foreground block mb-1">📷 Scan Barcode / SKU</label>
            <div className="flex gap-2">
              <Input
                placeholder="Scan or type SKU…"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { handleBarcodeScan(barcodeInput); } }}
                className="font-mono h-10 text-sm"
                autoFocus
              />
              <Button variant="teal" size="sm" className="h-10 px-4" onClick={() => handleBarcodeScan(barcodeInput)}>
                Scan
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Each scan increments qty by 1 for the matching SKU</p>
          </div>

          <div className="space-y-2 mb-4">
            {receivePO.lines.map(line => {
              const remaining = line.expected_qty - line.received_qty;
              const qty = receiveQtys[line.id] || 0;
              const cost = receiveCosts[line.id] ?? line.expected_cost;
              return (
                <div key={line.id} className={`bg-card rounded-lg border p-3 ${qty >= remaining && remaining > 0 ? "border-success/40" : "border-border"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{line.product_title}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.sku && <span className="font-mono">{line.sku}</span>}
                        {line.sku && " · "}
                        Expected: {line.expected_qty} · Already received: {line.received_qty} · Remaining: {remaining}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-muted-foreground shrink-0">Qty:</label>
                      <Input
                        type="number"
                        value={qty || ""}
                        onChange={e => setReceiveQtys({ ...receiveQtys, [line.id]: Math.min(Math.max(0, +e.target.value), remaining) })}
                        className="w-20 h-8 text-xs font-mono"
                        max={remaining}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-muted-foreground shrink-0">Cost $:</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={cost || ""}
                        onChange={e => setReceiveCosts({ ...receiveCosts, [line.id]: +e.target.value })}
                        className="w-20 h-8 text-xs font-mono"
                      />
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setReceiveQtys({ ...receiveQtys, [line.id]: remaining })}>
                      All ({remaining})
                    </Button>
                  </div>
                  {qty > 0 && qty < remaining && (
                    <p className="text-[10px] text-secondary flex items-center gap-1 mt-1.5">
                      🔶 {remaining - qty} will be backordered
                    </p>
                  )}
                  {qty >= 50 && (
                    <p className="text-[10px] flex items-center gap-1 mt-1 text-destructive">
                      <AlertTriangle className="w-3 h-3" /> High quantity — please confirm
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {hasShopify && (
            <p className="text-xs text-primary flex items-center gap-1 mb-3">
              <Package className="w-3 h-3" /> Shopify inventory will be updated automatically
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="teal" className="flex-1 h-11"
              onClick={() => setShowReceiveConfirm(true)}
              disabled={Object.values(receiveQtys).every(q => !q)}>
              <ArrowDownToLine className="w-4 h-4 mr-1" />
              Receive {Object.values(receiveQtys).reduce((a, b) => a + b, 0)} units
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setView("list")}>Cancel</Button>
          </div>
        </>
      )}

      {/* ── MATCH VIEW ────────────────────────────────────── */}
      {view === "match" && matchingPO && (
        <>
          {matchStep === "upload" && (
            <>
              <h1 className="text-xl font-bold font-display mb-1">Match Invoice</h1>
              <p className="text-sm text-muted-foreground mb-4">
                Match against <span className="font-semibold">{matchingPO.po_number}</span>
                {matchingPO.linked_document_id && " (linked invoice found)"}
              </p>

              <div className="bg-card rounded-lg border border-border p-4 mb-4">
                <h3 className="text-sm font-semibold mb-2">{matchingPO.po_number} — {matchingPO.supplier_name}</h3>
                <div className="space-y-1">
                  {matchingPO.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1">{l.product_title}</span>
                      <span className="text-muted-foreground ml-2 font-mono">{l.expected_qty} × ${l.expected_cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={runMatch} className="w-full h-36 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-2 active:bg-muted transition-colors">
                <Upload className="w-8 h-8 text-primary" />
                <p className="text-sm font-medium">
                  {matchingPO.linked_document_id ? "Match against linked invoice" : "Upload invoice to match"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {matchingPO.linked_document_id ? "Click to compare PO vs invoice lines" : "PDF · Excel · CSV · Photo"}
                </p>
              </button>
            </>
          )}

          {matchStep === "matching" && (
            <div className="flex flex-col items-center justify-center pt-20">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-semibold font-display mb-1">Matching invoice...</h3>
              <p className="text-sm text-muted-foreground">Comparing {matchingPO.lines.length} PO lines</p>
            </div>
          )}

          {matchStep === "result" && matchResult && (
            <>
              <h1 className="text-xl font-bold font-display mb-1">Discrepancy Report</h1>
              <p className="text-xs text-muted-foreground mb-4">
                {matchingPO.po_number} vs {matchResult.invoiceName}
              </p>

              <div className="bg-card rounded-lg border border-border p-3 mb-4">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-success">✅ {matchResult.summary.matched} matched</span>
                  {matchResult.summary.qtyDiff > 0 && <span className="text-secondary">🔶 {matchResult.summary.qtyDiff} qty diff</span>}
                  {matchResult.summary.priceDiff > 0 && <span className="text-secondary">🔶 {matchResult.summary.priceDiff} price diff</span>}
                  {matchResult.summary.notOnPo > 0 && <span className="text-destructive">❌ {matchResult.summary.notOnPo} not on PO</span>}
                  {matchResult.summary.missing > 0 && <span className="text-destructive">⚠ {matchResult.summary.missing} missing</span>}
                </div>
              </div>

              <div className="space-y-2 mb-6">
                {matchResult.lines.map((line, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${
                    line.status === "match" ? "border-success/30 bg-success/5" :
                    line.status === "not_on_po" || line.status === "missing" ? "border-destructive/30 bg-destructive/5" :
                    "border-secondary/30 bg-secondary/5"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{line.product}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        line.status === "match" ? "bg-success/15 text-success" :
                        line.status === "not_on_po" || line.status === "missing" ? "bg-destructive/15 text-destructive" :
                        "bg-secondary/15 text-secondary"
                      }`}>
                        {line.status === "match" && "✅ Match"}
                        {line.status === "qty_diff" && "🔶 Qty diff"}
                        {line.status === "price_diff" && "🔶 Price diff"}
                        {line.status === "not_on_po" && "❌ Not on PO"}
                        {line.status === "missing" && "⚠ Missing"}
                      </span>
                    </div>
                    {line.status === "qty_diff" && (
                      <p className="text-xs text-muted-foreground">
                        PO: <span className="font-mono">{line.poQty}</span> · Invoice: <span className="font-mono font-semibold text-secondary">{line.invoiceQty}</span>
                      </p>
                    )}
                    {line.status === "price_diff" && (
                      <p className="text-xs text-muted-foreground">
                        PO: <span className="font-mono">${line.poCost.toFixed(2)}</span> · Invoice: <span className="font-mono font-semibold text-secondary">${line.invoiceCost.toFixed(2)}</span>
                      </p>
                    )}
                    {line.status === "match" && (
                      <p className="text-xs text-muted-foreground font-mono">{line.poQty} units · ${line.poCost.toFixed(2)}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="teal" className="flex-1 h-11" onClick={async () => {
                  await handleStatusChange(matchingPO.id, "received");
                  toast.success("PO marked as received");
                  setView("list");
                }}>
                  <Check className="w-4 h-4 mr-1" /> Accept all
                </Button>
                <Button variant="outline" className="flex-1 h-11" onClick={async () => {
                  await handleStatusChange(matchingPO.id, "discrepancy");
                  toast("Marked as disputed");
                  setView("list");
                }}>
                  <X className="w-4 h-4 mr-1" /> Dispute
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Link Invoice Dialog ───────────────────────────── */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Invoice to PO</DialogTitle>
            <DialogDescription>Select a processed invoice to link.</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto divide-y divide-border">
            {availableDocs.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No invoices found. Process an invoice first.</p>
            ) : (
              availableDocs.map(doc => (
                <button key={doc.id} className="w-full text-left px-3 py-2.5 hover:bg-muted text-sm" onClick={() => linkDocument(doc.id)}>
                  <p className="font-medium">{doc.document_number || "No number"}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.supplier_name || "Unknown"} · {doc.date || "No date"} · ${Number(doc.total).toFixed(2)}
                  </p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Receive Confirmation Dialog ───────────────────── */}
      <Dialog open={showReceiveConfirm} onOpenChange={setShowReceiveConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Receiving</DialogTitle>
            <DialogDescription>
              Receive {Object.values(receiveQtys).reduce((a, b) => a + b, 0)} units on {receivePO?.po_number}.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs space-y-1.5">
            <p className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success" /> Stock levels will be adjusted
            </p>
            {hasShopify && (
              <p className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-success" /> Shopify inventory will sync via SKU match
              </p>
            )}
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowReceiveConfirm(false)} className="flex-1">Cancel</Button>
            <Button variant="teal" onClick={handleReceive} disabled={receiving} className="flex-1">
              {receiving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowDownToLine className="w-4 h-4 mr-1" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchaseOrderPanel;
