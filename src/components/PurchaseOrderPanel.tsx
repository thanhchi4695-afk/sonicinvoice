import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft, Plus, Trash2, Check, X, AlertTriangle,
  FileText, Upload, Loader2, Search, ClipboardList, Edit2,
} from "lucide-react";
import { addAuditEntry } from "@/lib/audit-log";

// ── Types ──────────────────────────────────────────────────
interface POLine {
  id: string;
  product: string;
  sku: string;
  expectedQty: number;
  expectedCost: number;
  notes: string;
}

export type POStatus = "draft" | "sent" | "awaiting" | "partial" | "received" | "discrepancy";

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: string;
  expectedDate: string;
  notes: string;
  lines: POLine[];
  status: POStatus;
  createdAt: string;
  matchResult?: MatchResult;
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

// ── localStorage helpers ───────────────────────────────────
const PO_KEY = "purchase_orders";

export function getPurchaseOrders(): PurchaseOrder[] {
  try { return JSON.parse(localStorage.getItem(PO_KEY) || "[]"); } catch { return []; }
}

function savePurchaseOrders(pos: PurchaseOrder[]) {
  localStorage.setItem(PO_KEY, JSON.stringify(pos));
}

function generatePONumber(): string {
  const pos = getPurchaseOrders();
  const year = new Date().getFullYear();
  const next = pos.length + 1;
  return `PO-${year}-${String(next).padStart(3, "0")}`;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

const STATUS_BADGES: Record<POStatus, { emoji: string; label: string; cls: string }> = {
  draft: { emoji: "📝", label: "Draft", cls: "bg-muted text-muted-foreground" },
  sent: { emoji: "📤", label: "Sent", cls: "bg-primary/15 text-primary" },
  awaiting: { emoji: "⏳", label: "Awaiting", cls: "bg-secondary/15 text-secondary" },
  partial: { emoji: "🔶", label: "Partial", cls: "bg-secondary/15 text-secondary" },
  received: { emoji: "✅", label: "Received", cls: "bg-success/15 text-success" },
  discrepancy: { emoji: "⚠", label: "Discrepancy", cls: "bg-destructive/15 text-destructive" },
};

// ── Past suppliers helper ──────────────────────────────────
function getPastSuppliers(): string[] {
  try {
    const history: { supplier?: string }[] = JSON.parse(localStorage.getItem("processing_history") || "[]");
    const set = new Set(history.map(h => h.supplier).filter(Boolean) as string[]);
    return Array.from(set);
  } catch { return []; }
}

// ── Component ──────────────────────────────────────────────
interface Props { onBack: () => void; }

type View = "list" | "create" | "edit" | "match" | "report";

const PurchaseOrderPanel = ({ onBack }: Props) => {
  const [view, setView] = useState<View>("list");
  const [orders, setOrders] = useState<PurchaseOrder[]>(getPurchaseOrders);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create/Edit form state
  const [poNumber, setPoNumber] = useState(generatePONumber);
  const [supplier, setSupplier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [lines, setLines] = useState<POLine[]>([
    { id: uid(), product: "", sku: "", expectedQty: 0, expectedCost: 0, notes: "" },
  ]);

  // Match state
  const [matchingPO, setMatchingPO] = useState<PurchaseOrder | null>(null);
  const [matchStep, setMatchStep] = useState<"upload" | "matching" | "result">("upload");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // Supplier autocomplete
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pastSuppliers = useMemo(() => getPastSuppliers(), []);
  const filteredSuppliers = supplier.trim()
    ? pastSuppliers.filter(s => s.toLowerCase().includes(supplier.toLowerCase()))
    : pastSuppliers;

  const poTotal = lines.reduce((s, l) => s + l.expectedQty * l.expectedCost, 0);

  const resetForm = () => {
    setPoNumber(generatePONumber());
    setSupplier("");
    setExpectedDate("");
    setPoNotes("");
    setLines([{ id: uid(), product: "", sku: "", expectedQty: 0, expectedCost: 0, notes: "" }]);
    setEditingId(null);
  };

  const handleSave = (asDraft: boolean) => {
    const po: PurchaseOrder = {
      id: editingId || uid(),
      poNumber,
      supplier,
      expectedDate,
      notes: poNotes,
      lines: lines.filter(l => l.product.trim()),
      status: asDraft ? "draft" : "sent",
      createdAt: new Date().toISOString(),
    };
    let updated: PurchaseOrder[];
    if (editingId) {
      updated = orders.map(o => o.id === editingId ? po : o);
    } else {
      updated = [po, ...orders];
    }
    setOrders(updated);
    savePurchaseOrders(updated);
    addAuditEntry("PO", `PO created: ${po.poNumber} — supplier: ${supplier} — ${po.lines.length} lines`);
    resetForm();
    setView("list");
  };

  const handleEdit = (po: PurchaseOrder) => {
    setEditingId(po.id);
    setPoNumber(po.poNumber);
    setSupplier(po.supplier);
    setExpectedDate(po.expectedDate);
    setPoNotes(po.notes);
    setLines(po.lines.length > 0 ? po.lines : [{ id: uid(), product: "", sku: "", expectedQty: 0, expectedCost: 0, notes: "" }]);
    setView("edit");
  };

  const handleDelete = (id: string) => {
    const updated = orders.filter(o => o.id !== id);
    setOrders(updated);
    savePurchaseOrders(updated);
  };

  const handleStatusChange = (id: string, status: POStatus) => {
    const updated = orders.map(o => o.id === id ? { ...o, status } : o);
    setOrders(updated);
    savePurchaseOrders(updated);
  };

  // ── Match invoice simulation ─────────────────────────────
  const startMatch = (po: PurchaseOrder) => {
    setMatchingPO(po);
    setMatchStep("upload");
    setMatchResult(null);
    setView("match");
  };

  const runMatch = () => {
    if (!matchingPO) return;
    setMatchStep("matching");

    setTimeout(() => {
      const matchLines: MatchLine[] = matchingPO.lines.map((line, i) => {
        if (i === 0) return { product: line.product, sku: line.sku, poQty: line.expectedQty, invoiceQty: line.expectedQty, poCost: line.expectedCost, invoiceCost: line.expectedCost, status: "match" as const };
        if (i === 1) return { product: line.product, sku: line.sku, poQty: line.expectedQty, invoiceQty: Math.max(1, line.expectedQty - 3), poCost: line.expectedCost, invoiceCost: line.expectedCost, status: "qty_diff" as const };
        if (i === 2) return { product: line.product, sku: line.sku, poQty: line.expectedQty, invoiceQty: line.expectedQty, poCost: line.expectedCost, invoiceCost: +(line.expectedCost * 1.04).toFixed(2), status: "price_diff" as const };
        return { product: line.product, sku: line.sku, poQty: line.expectedQty, invoiceQty: line.expectedQty, poCost: line.expectedCost, invoiceCost: line.expectedCost, status: "match" as const };
      });
      // Add a "not on PO" line
      if (matchLines.length > 0) {
        matchLines.push({ product: "Surprise Freebie Sample", sku: "SAMPLE-001", poQty: 0, invoiceQty: 1, poCost: 0, invoiceCost: 0, status: "not_on_po" });
      }

      const summary = {
        matched: matchLines.filter(l => l.status === "match").length,
        qtyDiff: matchLines.filter(l => l.status === "qty_diff").length,
        priceDiff: matchLines.filter(l => l.status === "price_diff").length,
        notOnPo: matchLines.filter(l => l.status === "not_on_po").length,
        missing: matchLines.filter(l => l.status === "missing").length,
      };

      const result: MatchResult = {
        matchedAt: new Date().toISOString(),
        invoiceName: `${matchingPO.supplier}_invoice.pdf`,
        lines: matchLines,
        summary,
      };
      setMatchResult(result);
      setMatchStep("result");

      // Update PO
      const hasIssues = summary.qtyDiff + summary.priceDiff + summary.notOnPo + summary.missing > 0;
      const newStatus: POStatus = hasIssues ? "discrepancy" : "received";
      const updated = orders.map(o => o.id === matchingPO.id ? { ...o, status: newStatus, matchResult: result } : o);
      setOrders(updated);
      savePurchaseOrders(updated);

      addAuditEntry("PO", `PO matched against invoice: ${summary.matched} matches, ${summary.qtyDiff + summary.priceDiff + summary.notOnPo + summary.missing} discrepancies`);
    }, 2000);
  };

  const handleAcceptAll = () => {
    if (!matchingPO) return;
    handleStatusChange(matchingPO.id, "received");
    addAuditEntry("PO", `PO ${matchingPO.poNumber} marked as Received`);
    setView("list");
  };

  const handleReject = () => {
    if (!matchingPO) return;
    handleStatusChange(matchingPO.id, "discrepancy");
    addAuditEntry("PO", `PO ${matchingPO.poNumber} marked as Disputed`);
    setView("list");
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button onClick={view === "list" ? onBack : () => { resetForm(); setView("list"); }}
        className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ChevronLeft className="w-4 h-4" /> {view === "list" ? "Back" : "All purchase orders"}
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

          {orders.length === 0 ? (
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
              {orders.map(po => {
                const badge = STATUS_BADGES[po.status];
                return (
                  <div key={po.id} className="bg-card rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold font-mono-data">{po.poNumber}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.emoji} {badge.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono-data">
                        {po.expectedDate || "No date"}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{po.supplier || "No supplier"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {po.lines.length} line{po.lines.length !== 1 ? "s" : ""} · ${po.lines.reduce((s, l) => s + l.expectedQty * l.expectedCost, 0).toFixed(2)} total
                    </p>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {(po.status === "sent" || po.status === "awaiting" || po.status === "draft") && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => startMatch(po)}>
                          <Search className="w-3 h-3 mr-1" /> Match invoice
                        </Button>
                      )}
                      {po.matchResult && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setMatchingPO(po); setMatchResult(po.matchResult!); setMatchStep("result"); setView("match"); }}>
                          <FileText className="w-3 h-3 mr-1" /> View report
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleEdit(po)}>
                        <Edit2 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(po.id)}>
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                      {po.status === "draft" && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(po.id, "sent")}>
                          📤 Mark sent
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── CREATE / EDIT VIEW ────────────────────────────── */}
      {(view === "create" || view === "edit") && (
        <>
          <h1 className="text-2xl font-bold font-display mb-4">
            {view === "edit" ? "Edit Purchase Order" : "New Purchase Order"}
          </h1>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">PO Number</label>
              <Input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="font-mono-data" />
            </div>

            <div className="relative">
              <label className="text-xs text-muted-foreground mb-1 block">Supplier</label>
              <Input
                value={supplier}
                onChange={e => { setSupplier(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. Jantzen, Seafolly..."
              />
              {showSuggestions && filteredSuppliers.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-32 overflow-y-auto">
                  {filteredSuppliers.map(s => (
                    <button key={s} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted" onMouseDown={() => { setSupplier(s); setShowSuggestions(false); }}>
                      {s}
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
                        value={line.product}
                        onChange={e => { const u = [...lines]; u[i] = { ...u[i], product: e.target.value }; setLines(u); }}
                        className="text-xs h-9"
                      />
                      <Input
                        placeholder="SKU"
                        value={line.sku}
                        onChange={e => { const u = [...lines]; u[i] = { ...u[i], sku: e.target.value }; setLines(u); }}
                        className="text-xs h-9 font-mono-data"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Qty</label>
                        <Input
                          type="number"
                          value={line.expectedQty || ""}
                          onChange={e => { const u = [...lines]; u[i] = { ...u[i], expectedQty: +e.target.value }; setLines(u); }}
                          className="text-xs h-9 font-mono-data"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Cost ($)</label>
                        <Input
                          type="number"
                          step="0.01"
                          value={line.expectedCost || ""}
                          onChange={e => { const u = [...lines]; u[i] = { ...u[i], expectedCost: +e.target.value }; setLines(u); }}
                          className="text-xs h-9 font-mono-data"
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
              <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setLines([...lines, { id: uid(), product: "", sku: "", expectedQty: 0, expectedCost: 0, notes: "" }])}>
                <Plus className="w-3 h-3 mr-1" /> Add line
              </Button>
            </div>

            {/* PO Total */}
            <div className="bg-card rounded-lg border border-border p-3 flex items-center justify-between">
              <span className="text-sm font-medium">PO Total</span>
              <span className="text-lg font-bold font-mono-data">${poTotal.toFixed(2)}</span>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="teal" className="flex-1 h-11" onClick={() => handleSave(false)}>
                <Check className="w-4 h-4 mr-1" /> Save PO
              </Button>
              <Button variant="outline" className="flex-1 h-11" onClick={() => handleSave(true)}>
                Save as draft
              </Button>
            </div>
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
                Upload the invoice to match against <span className="font-semibold">{matchingPO.poNumber}</span>
              </p>

              {/* PO summary */}
              <div className="bg-card rounded-lg border border-border p-4 mb-4">
                <h3 className="text-sm font-semibold mb-2">{matchingPO.poNumber} — {matchingPO.supplier}</h3>
                <div className="space-y-1">
                  {matchingPO.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1">{l.product}</span>
                      <span className="font-mono-data text-muted-foreground ml-2">{l.expectedQty} × ${l.expectedCost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upload area */}
              <button onClick={runMatch} className="w-full h-36 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-2 active:bg-muted transition-colors">
                <Upload className="w-8 h-8 text-primary" />
                <p className="text-sm font-medium">Upload invoice to match</p>
                <p className="text-xs text-muted-foreground">PDF · Excel · CSV · Photo</p>
              </button>
            </>
          )}

          {matchStep === "matching" && (
            <div className="flex flex-col items-center justify-center pt-20">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-semibold font-display mb-1">Matching invoice...</h3>
              <p className="text-sm text-muted-foreground">Comparing {matchingPO.lines.length} PO lines against invoice</p>
            </div>
          )}

          {matchStep === "result" && matchResult && (
            <>
              <h1 className="text-xl font-bold font-display mb-1">Discrepancy Report</h1>
              <p className="text-xs text-muted-foreground mb-4">
                {matchingPO.poNumber} vs {matchResult.invoiceName} · Matched {new Date(matchResult.matchedAt).toLocaleDateString()}
              </p>

              {/* Summary */}
              <div className="bg-card rounded-lg border border-border p-3 mb-4">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-success">✅ {matchResult.summary.matched} matched</span>
                  {matchResult.summary.qtyDiff > 0 && <span className="text-secondary">🔶 {matchResult.summary.qtyDiff} qty diff</span>}
                  {matchResult.summary.priceDiff > 0 && <span className="text-secondary">🔶 {matchResult.summary.priceDiff} price diff</span>}
                  {matchResult.summary.notOnPo > 0 && <span className="text-destructive">❌ {matchResult.summary.notOnPo} not on PO</span>}
                  {matchResult.summary.missing > 0 && <span className="text-destructive">⚠ {matchResult.summary.missing} missing</span>}
                </div>
              </div>

              {/* Detailed lines */}
              <div className="space-y-2 mb-6">
                {matchResult.lines.map((line, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${
                    line.status === "match" ? "border-success/30 bg-success/5" :
                    line.status === "not_on_po" ? "border-destructive/30 bg-destructive/5" :
                    "border-secondary/30 bg-secondary/5"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{line.product}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        line.status === "match" ? "bg-success/15 text-success" :
                        line.status === "not_on_po" ? "bg-destructive/15 text-destructive" :
                        line.status === "missing" ? "bg-destructive/15 text-destructive" :
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
                        PO: <span className="font-mono-data">{line.poQty} units</span> · Invoice: <span className="font-mono-data font-semibold text-secondary">{line.invoiceQty} units</span>
                      </p>
                    )}
                    {line.status === "price_diff" && (
                      <p className="text-xs text-muted-foreground">
                        PO: <span className="font-mono-data">${line.poCost.toFixed(2)}</span> · Invoice: <span className="font-mono-data font-semibold text-secondary">${line.invoiceCost.toFixed(2)}</span>
                      </p>
                    )}
                    {line.status === "not_on_po" && (
                      <p className="text-xs text-muted-foreground">
                        Invoice has <span className="font-mono-data">{line.invoiceQty}</span> units — not in original PO
                      </p>
                    )}
                    {line.status === "match" && (
                      <p className="text-xs text-muted-foreground font-mono-data">
                        {line.poQty} units · ${line.poCost.toFixed(2)}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="teal" className="flex-1 h-11" onClick={handleAcceptAll}>
                  <Check className="w-4 h-4 mr-1" /> Accept all
                </Button>
                <Button variant="outline" className="flex-1 h-11" onClick={handleAcceptAll}>
                  Accept with notes
                </Button>
              </div>
              <Button variant="ghost" className="w-full mt-2 text-destructive hover:text-destructive h-10" onClick={handleReject}>
                <X className="w-4 h-4 mr-1" /> Reject invoice
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default PurchaseOrderPanel;
