import { useState, useEffect } from "react";
import { ChevronLeft, Plus, Trash2, Copy, Download, FileText, Eye, Check, X, ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStoreConfig, getIndustryConfig } from "@/lib/prompt-builder";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────
interface OrderLineItem {
  id: string;
  styleName: string;
  styleCode: string;
  colour: string;
  sizeQuantities: Record<string, number>;
  rrp: number;
}

type OrderStatus = "draft" | "sent" | "confirmed" | "delivered" | "cancelled";

interface SavedOrder {
  id: string;
  poRef: string;
  supplier: string;
  date: string;
  deliveryDate: string;
  season: string;
  paymentTerms: string;
  storeAddress: string;
  contactName: string;
  contactEmail: string;
  salesRep: string;
  notes: string;
  items: OrderLineItem[];
  status: OrderStatus;
  createdAt: string;
}

const STATUS_MAP: Record<OrderStatus, { emoji: string; label: string; color: string }> = {
  draft: { emoji: "📝", label: "Draft", color: "text-muted-foreground" },
  sent: { emoji: "📤", label: "Sent", color: "text-blue-500" },
  confirmed: { emoji: "✅", label: "Confirmed", color: "text-green-500" },
  delivered: { emoji: "📦", label: "Delivered", color: "text-primary" },
  cancelled: { emoji: "❌", label: "Cancelled", color: "text-destructive" },
};

const SEASONS = ["Summer 25", "Autumn 26", "Winter 26", "Spring 26", "Summer 26", "Autumn 27"];
const PAYMENT_TERMS = ["Prepaid", "COD", "Net 7", "Net 14", "Net 30", "Net 60", "Net 90"];
const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];

function loadOrders(): SavedOrder[] {
  try { return JSON.parse(localStorage.getItem("order_forms") || "[]"); } catch { return []; }
}
function saveOrders(orders: SavedOrder[]) {
  localStorage.setItem("order_forms", JSON.stringify(orders));
}
function generatePO(): string {
  const yr = new Date().getFullYear();
  const orders = loadOrders();
  const num = String(orders.length + 1).padStart(3, "0");
  return `PO-${yr}-${num}`;
}

// ── Main Component ─────────────────────────────────────────
export default function OrderFormFlow({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<"list" | "create" | "preview">("list");
  const [orders, setOrders] = useState<SavedOrder[]>(loadOrders);
  const [editingOrder, setEditingOrder] = useState<SavedOrder | null>(null);

  const cfg = getStoreConfig();
  const industryCfg = getIndustryConfig(cfg.industry);
  const currSym = cfg.currencySymbol || "$";

  const handleSave = (order: SavedOrder) => {
    const existing = orders.findIndex(o => o.id === order.id);
    const updated = existing >= 0
      ? orders.map(o => o.id === order.id ? order : o)
      : [order, ...orders];
    setOrders(updated);
    saveOrders(updated);
    setView("list");
    setEditingOrder(null);
  };

  const handleDelete = (id: string) => {
    const updated = orders.filter(o => o.id !== id);
    setOrders(updated);
    saveOrders(updated);
  };

  const handleDuplicate = (order: SavedOrder) => {
    const dup: SavedOrder = {
      ...order,
      id: crypto.randomUUID(),
      poRef: generatePO(),
      date: format(new Date(), "yyyy-MM-dd"),
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    const updated = [dup, ...orders];
    setOrders(updated);
    saveOrders(updated);
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    const updated = orders.map(o => o.id === id ? { ...o, status } : o);
    setOrders(updated);
    saveOrders(updated);
  };

  if (view === "create" || view === "preview") {
    return (
      <OrderEditor
        order={editingOrder}
        onSave={handleSave}
        onBack={() => { setView("list"); setEditingOrder(null); }}
        storeName={cfg.name}
        currencySymbol={currSym}
        industrySizes={industryCfg?.variantAttributes?.[0] === "Shade" ? [] : undefined}
      />
    );
  }

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-bold">📝 Order Forms</h2>
        <div className="flex-1" />
        <Button size="sm" onClick={() => { setEditingOrder(null); setView("create"); }}>
          <Plus className="w-4 h-4 mr-1" /> New order
        </Button>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No order forms yet</p>
          <p className="text-sm mt-1">Create your first wholesale order form to send to suppliers.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => {
            const s = STATUS_MAP[order.status];
            const totalUnits = order.items.reduce((sum, li) => sum + Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0), 0);
            return (
              <div key={order.id} className="bg-card border rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{order.poRef}</span>
                      <span className={`text-xs ${s.color}`}>{s.emoji} {s.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{order.supplier} · {order.items.length} styles · {totalUnits} units</p>
                    <p className="text-[11px] text-muted-foreground">{order.date} · {order.season}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                      className="h-7 text-[11px] rounded-md border border-border bg-input px-1.5 text-foreground"
                    >
                      {Object.entries(STATUS_MAP).map(([k, v]) => (
                        <option key={k} value={k}>{v.emoji} {v.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingOrder(order); setView("create"); }}>
                    <Eye className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleDuplicate(order)}>
                    <Copy className="w-3 h-3 mr-1" /> Duplicate
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleDelete(order.id)}>
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Order Editor ───────────────────────────────────────────
function OrderEditor({ order, onSave, onBack, storeName, currencySymbol, industrySizes }: {
  order: SavedOrder | null;
  onSave: (o: SavedOrder) => void;
  onBack: () => void;
  storeName: string;
  currencySymbol: string;
  industrySizes?: string[];
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sizes, setSizes] = useState<string[]>(industrySizes || order?.items?.[0] ? Object.keys(order?.items?.[0]?.sizeQuantities || {}) : [...DEFAULT_SIZES]);
  const [newSize, setNewSize] = useState("");

  // Header
  const [supplier, setSupplier] = useState(order?.supplier || "");
  const [poRef, setPoRef] = useState(order?.poRef || generatePO());
  const [orderDate, setOrderDate] = useState(order?.date || format(new Date(), "yyyy-MM-dd"));
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate || "");
  const [season, setSeason] = useState(order?.season || SEASONS[0]);
  const [paymentTerms, setPaymentTerms] = useState(order?.paymentTerms || "Net 30");
  const [storeAddress, setStoreAddress] = useState(order?.storeAddress || "");
  const [contactName, setContactName] = useState(order?.contactName || "");
  const [contactEmail, setContactEmail] = useState(order?.contactEmail || "");
  const [salesRep, setSalesRep] = useState(order?.salesRep || "");
  const [notes, setNotes] = useState(order?.notes || "");

  // Line items
  const [items, setItems] = useState<OrderLineItem[]>(order?.items || []);

  const addItem = () => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      styleName: "",
      styleCode: "",
      colour: "",
      sizeQuantities: Object.fromEntries(sizes.map(s => [s, 0])),
      rrp: 0,
    }]);
  };

  const updateItem = (id: string, patch: Partial<OrderLineItem>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.id !== id));

  const addSize = () => {
    if (!newSize.trim() || sizes.includes(newSize.trim())) return;
    const s = newSize.trim();
    setSizes(prev => [...prev, s]);
    setItems(prev => prev.map(it => ({ ...it, sizeQuantities: { ...it.sizeQuantities, [s]: 0 } })));
    setNewSize("");
  };

  const totalUnits = items.reduce((sum, li) => sum + Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0), 0);
  const totalRRP = items.reduce((sum, li) => {
    const qty = Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0);
    return sum + qty * li.rrp;
  }, 0);

  const handleSave = () => {
    const saved: SavedOrder = {
      id: order?.id || crypto.randomUUID(),
      poRef, supplier, date: orderDate, deliveryDate, season, paymentTerms,
      storeAddress, contactName, contactEmail, salesRep, notes, items,
      status: order?.status || "draft",
      createdAt: order?.createdAt || new Date().toISOString(),
    };
    onSave(saved);
  };

  const buildPlainText = () => {
    let txt = `${storeName.toUpperCase()} — PURCHASE ORDER\n`;
    txt += `${poRef}  ·  ${orderDate}\n\n`;
    txt += `To: ${supplier}\n`;
    if (salesRep) txt += `Sales rep: ${salesRep}\n`;
    if (deliveryDate) txt += `Delivery requested by: ${deliveryDate}\n`;
    txt += `Season: ${season}  ·  Payment: ${paymentTerms}\n`;
    if (notes) txt += `Notes: ${notes}\n`;
    txt += `\n${"─".repeat(50)}\n\n`;
    items.forEach(li => {
      const qty = Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0);
      txt += `${li.styleName}${li.styleCode ? ` (${li.styleCode})` : ""}\n`;
      if (li.colour) txt += `  Colour: ${li.colour}\n`;
      txt += `  Sizes: ${sizes.map(s => `${s}:${li.sizeQuantities[s] || 0}`).join("  ")}\n`;
      txt += `  Total: ${qty} units  ·  RRP: ${currencySymbol}${li.rrp.toFixed(2)}\n\n`;
    });
    txt += `${"─".repeat(50)}\n`;
    txt += `TOTAL: ${totalUnits} units  ·  RRP value: ${currencySymbol}${totalRRP.toFixed(2)}\n`;
    return txt;
  };

  const [copied, setCopied] = useState(false);
  const copyText = () => {
    navigator.clipboard.writeText(buildPlainText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadCSV = () => {
    const rows: string[][] = [["Style", "Code", "Colour", ...sizes, "Total Qty", "RRP"]];
    items.forEach(li => {
      const qty = Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0);
      rows.push([li.styleName, li.styleCode, li.colour, ...sizes.map(s => String(li.sizeQuantities[s] || 0)), String(qty), li.rrp.toFixed(2)]);
    });
    rows.push(["", "", "TOTAL", ...sizes.map(s => String(items.reduce((sum, li) => sum + (li.sizeQuantities[s] || 0), 0))), String(totalUnits), totalRRP.toFixed(2)]);
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${supplier.replace(/\s+/g, "_")}_${poRef}_order.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Step 1: Header ──
  if (step === 1) {
    return (
      <div className="px-4 pt-2 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-bold">Order details</h2>
        </div>
        <div className="text-xs text-muted-foreground mb-4">Step 1 of 3 — Order header</div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">PO reference</label>
              <Input value={poRef} onChange={e => setPoRef(e.target.value)} className="h-10 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Order date</label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="h-10 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Supplier name *</label>
            <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Jantzen" className="h-10 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Sales rep name</label>
            <Input value={salesRep} onChange={e => setSalesRep(e.target.value)} placeholder="Supplier contact" className="h-10 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Season</label>
              <select value={season} onChange={e => setSeason(e.target.value)} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Payment terms</label>
              <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Requested delivery date</label>
            <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="h-10 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Store address</label>
            <Input value={storeAddress} onChange={e => setStoreAddress(e.target.value)} placeholder="Your store address" className="h-10 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact name</label>
              <Input value={contactName} onChange={e => setContactName(e.target.value)} className="h-10 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact email</label>
              <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="h-10 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Additional notes for supplier…"
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        <Button className="w-full mt-6 h-12" onClick={() => setStep(2)} disabled={!supplier.trim()}>
          Next — Add line items →
        </Button>
      </div>
    );
  }

  // ── Step 2: Line Items ──
  if (step === 2) {
    return (
      <div className="px-4 pt-2 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setStep(1)} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-bold">Line items</h2>
        </div>
        <div className="text-xs text-muted-foreground mb-3">Step 2 of 3 — Add products to your order</div>

        {/* Size columns manager */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-muted-foreground">Sizes:</span>
          {sizes.map(s => (
            <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs">
              {s}
              <button onClick={() => {
                setSizes(prev => prev.filter(x => x !== s));
                setItems(prev => prev.map(it => {
                  const sq = { ...it.sizeQuantities };
                  delete sq[s];
                  return { ...it, sizeQuantities: sq };
                }));
              }} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <Input value={newSize} onChange={e => setNewSize(e.target.value)} placeholder="Size" className="h-7 w-16 text-xs"
              onKeyDown={e => e.key === "Enter" && addSize()} />
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={addSize}>+</Button>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={item.id} className="bg-card border rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                <button onClick={() => removeItem(item.id)} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <Input placeholder="Style name" value={item.styleName} onChange={e => updateItem(item.id, { styleName: e.target.value })} className="h-9 text-xs col-span-2" />
                <Input placeholder="Code" value={item.styleCode} onChange={e => updateItem(item.id, { styleCode: e.target.value })} className="h-9 text-xs" />
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <Input placeholder="Colour" value={item.colour} onChange={e => updateItem(item.id, { colour: e.target.value })} className="h-9 text-xs" />
                <div className="col-span-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground shrink-0">RRP:</span>
                    <Input type="number" value={item.rrp || ""} onChange={e => updateItem(item.id, { rrp: parseFloat(e.target.value) || 0 })} className="h-9 text-xs" placeholder="0.00" />
                  </div>
                </div>
              </div>
              {/* Size grid */}
              <div className="flex gap-1.5 flex-wrap">
                {sizes.map(s => (
                  <div key={s} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{s}</div>
                    <input
                      type="number"
                      min={0}
                      value={item.sizeQuantities[s] || ""}
                      onChange={e => updateItem(item.id, { sizeQuantities: { ...item.sizeQuantities, [s]: parseInt(e.target.value) || 0 } })}
                      className="w-10 h-8 text-center text-xs rounded-md border border-border bg-input"
                    />
                  </div>
                ))}
                <div className="text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Total</div>
                  <div className="w-10 h-8 flex items-center justify-center text-xs font-semibold bg-muted rounded-md">
                    {Object.values(item.sizeQuantities).reduce((a, b) => a + b, 0)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" className="w-full mt-3 h-10" onClick={addItem}>
          <Plus className="w-4 h-4 mr-1" /> Add line item
        </Button>

        {/* Totals */}
        {items.length > 0 && (
          <div className="mt-4 bg-muted/50 rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total units</span>
              <span className="font-semibold">{totalUnits}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total RRP value</span>
              <span className="font-semibold">{currencySymbol}{totalRRP.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-12" onClick={() => setStep(1)}>← Back</Button>
          <Button className="flex-1 h-12" onClick={() => setStep(3)} disabled={items.length === 0}>Preview & export →</Button>
        </div>
      </div>
    );
  }

  // ── Step 3: Preview & Export ──
  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setStep(2)} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-bold">Preview & export</h2>
      </div>
      <div className="text-xs text-muted-foreground mb-4">Step 3 of 3 — Review and download your order form</div>

      {/* Preview card */}
      <div className="bg-card border rounded-xl p-4 space-y-3 text-sm">
        <div className="text-center border-b pb-3">
          <h3 className="font-bold text-base uppercase">{storeName || "Your Store"} — Purchase Order</h3>
          <p className="text-xs text-muted-foreground">{poRef}  ·  {orderDate}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-muted-foreground">To:</span> {supplier}</div>
          {salesRep && <div><span className="text-muted-foreground">Sales rep:</span> {salesRep}</div>}
          {deliveryDate && <div><span className="text-muted-foreground">Delivery by:</span> {deliveryDate}</div>}
          <div><span className="text-muted-foreground">Season:</span> {season}</div>
          <div><span className="text-muted-foreground">Payment:</span> {paymentTerms}</div>
          {contactName && <div><span className="text-muted-foreground">Contact:</span> {contactName}</div>}
        </div>
        {notes && <p className="text-xs text-muted-foreground italic border-t pt-2">{notes}</p>}

        <div className="border-t pt-3 space-y-3">
          {items.map((li, idx) => {
            const lineQty = Object.values(li.sizeQuantities).reduce((a, b) => a + b, 0);
            return (
              <div key={li.id} className="bg-muted/30 rounded-lg p-2.5">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="font-medium text-xs">{li.styleName}{li.styleCode ? ` (${li.styleCode})` : ""}</span>
                  <span className="text-xs text-muted-foreground">RRP: {currencySymbol}{li.rrp.toFixed(2)}</span>
                </div>
                {li.colour && <div className="text-[11px] text-muted-foreground mb-1.5">Colour: {li.colour}</div>}
                <div className="overflow-x-auto">
                  <table className="text-[11px] w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {sizes.map(s => <th key={s} className="px-1.5 py-1 text-center font-medium text-muted-foreground">{s}</th>)}
                        <th className="px-1.5 py-1 text-center font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {sizes.map(s => <td key={s} className="px-1.5 py-1 text-center">{li.sizeQuantities[s] || 0}</td>)}
                        <td className="px-1.5 py-1 text-center font-semibold">{lineQty}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-3 flex justify-between font-semibold text-sm">
          <span>Total: {totalUnits} units</span>
          <span>RRP value: {currencySymbol}{totalRRP.toFixed(2)}</span>
        </div>
      </div>

      {/* Export buttons */}
      <div className="space-y-2 mt-4">
        <Button className="w-full h-11" onClick={downloadCSV}>
          <Download className="w-4 h-4 mr-2" /> Download as CSV
        </Button>
        <Button variant="outline" className="w-full h-11" onClick={copyText}>
          {copied ? <Check className="w-4 h-4 mr-2" /> : <ClipboardCopy className="w-4 h-4 mr-2" />}
          {copied ? "Copied!" : "Copy as email text"}
        </Button>
        <Button variant="secondary" className="w-full h-11" onClick={handleSave}>
          <FileText className="w-4 h-4 mr-2" /> Save as draft PO
        </Button>
      </div>

      <Button variant="ghost" className="w-full mt-2 h-10 text-sm" onClick={() => setStep(2)}>← Back to line items</Button>
    </div>
  );
}
