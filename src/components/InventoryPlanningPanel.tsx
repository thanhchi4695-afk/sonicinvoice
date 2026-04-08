import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { ArrowLeft, Plus, Package, ClipboardList, BarChart3, Users, Settings, Truck, Search, Download, AlertTriangle, TrendingUp, DollarSign, RefreshCw, Check, X, Edit, Trash2, FileText, Send, ChevronRight } from "lucide-react";

// ── Types ──
interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  notes?: string;
  leadTimeDays: number;
  createdAt: string;
}

interface PurchaseOrderItem {
  id: string;
  productTitle: string;
  variantTitle: string;
  variantSku?: string;
  imageUrl?: string;
  quantityOrdered: number;
  quantityReceived: number;
  costPrice?: number;
  totalCost?: number;
  currentStock?: number;
  velocity?: number;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  locationName: string;
  status: "draft" | "sent" | "partial" | "received" | "cancelled";
  currency: string;
  notes?: string;
  expectedAt?: string;
  sentAt?: string;
  receivedAt?: string;
  subtotal: number;
  total: number;
  lineItems: PurchaseOrderItem[];
  createdAt: string;
}

interface StocktakeItem {
  id: string;
  productTitle: string;
  variantTitle: string;
  variantSku?: string;
  barcode?: string;
  expectedQty: number;
  countedQty: number | null;
  variance: number | null;
  adjusted: boolean;
}

interface Stocktake {
  id: string;
  locationName: string;
  status: "in_progress" | "completed" | "cancelled";
  notes?: string;
  employeeName?: string;
  startedAt: string;
  completedAt?: string;
  items: StocktakeItem[];
}

interface StockAdjustment {
  id: string;
  locationName: string;
  productTitle: string;
  variantTitle: string;
  variantSku?: string;
  adjustment: number;
  reason: string;
  employeeName?: string;
  reference?: string;
  createdAt: string;
}

interface ReorderRule {
  id: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  locationId: string;
  minStock?: number;
  maxStock?: number;
  reorderPoint?: number;
  reorderQty?: number;
  leadTimeDays?: number;
}

interface InventoryProduct {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  variantSku?: string;
  vendor: string;
  currentStock: number;
  velocity: number; // units/day
  rop: number;
  daysOfStock: number;
  lostRevenuePerDay: number;
  price: number;
  costPrice?: number;
  abcClass?: "A" | "B" | "C";
  imageUrl?: string;
}

// ── Helpers ──
function generateId() { return crypto.randomUUID(); }
function generatePONumber(): string {
  const year = new Date().getFullYear();
  const existing: PurchaseOrder[] = JSON.parse(localStorage.getItem("inventory_pos") || "[]");
  const thisYear = existing.filter(p => p.poNumber.includes(`PO-${year}`));
  const num = (thisYear.length + 1).toString().padStart(3, "0");
  return `PO-${year}-${num}`;
}

function loadSuppliers(): Supplier[] {
  return JSON.parse(localStorage.getItem("inventory_suppliers") || "[]");
}
function saveSuppliers(s: Supplier[]) {
  localStorage.setItem("inventory_suppliers", JSON.stringify(s));
}
function loadPOs(): PurchaseOrder[] {
  return JSON.parse(localStorage.getItem("inventory_pos") || "[]");
}
function savePOs(p: PurchaseOrder[]) {
  localStorage.setItem("inventory_pos", JSON.stringify(p));
}
function loadStocktakes(): Stocktake[] {
  return JSON.parse(localStorage.getItem("inventory_stocktakes") || "[]");
}
function saveStocktakes(s: Stocktake[]) {
  localStorage.setItem("inventory_stocktakes", JSON.stringify(s));
}
function loadAdjustments(): StockAdjustment[] {
  return JSON.parse(localStorage.getItem("inventory_adjustments") || "[]");
}
function saveAdjustments(a: StockAdjustment[]) {
  localStorage.setItem("inventory_adjustments", JSON.stringify(a.slice(-500)));
}
function loadReorderRules(): ReorderRule[] {
  return JSON.parse(localStorage.getItem("inventory_reorder_rules") || "[]");
}
function saveReorderRules(r: ReorderRule[]) {
  localStorage.setItem("inventory_reorder_rules", JSON.stringify(r));
}

// Simulated product data for demo purposes
function getDemoProducts(): InventoryProduct[] {
  const stored = localStorage.getItem("inventory_demo_products");
  if (stored) return JSON.parse(stored);
  
  const products: InventoryProduct[] = [
    { productId: "p1", productTitle: "Seafolly Classic One Piece", variantId: "v1a", variantTitle: "Size 8", variantSku: "SF-COP-8", vendor: "Seafolly", currentStock: 2, velocity: 0.5, rop: 7, daysOfStock: 4, lostRevenuePerDay: 0, price: 189.95, costPrice: 95, imageUrl: "" },
    { productId: "p1", productTitle: "Seafolly Classic One Piece", variantId: "v1b", variantTitle: "Size 10", variantSku: "SF-COP-10", vendor: "Seafolly", currentStock: 0, velocity: 0.8, rop: 11, daysOfStock: 0, lostRevenuePerDay: 151.96, price: 189.95, costPrice: 95, imageUrl: "" },
    { productId: "p1", productTitle: "Seafolly Classic One Piece", variantId: "v1c", variantTitle: "Size 12", variantSku: "SF-COP-12", vendor: "Seafolly", currentStock: 5, velocity: 0.6, rop: 8, daysOfStock: 8, lostRevenuePerDay: 0, price: 189.95, costPrice: 95, imageUrl: "" },
    { productId: "p2", productTitle: "Funkita Diamond Back One Piece - Kulin Colour", variantId: "v2a", variantTitle: "Size 8", variantSku: "FK-DB-KC-8", vendor: "Funkita", currentStock: 1, velocity: 0.3, rop: 4, daysOfStock: 3, lostRevenuePerDay: 0, price: 109.95, costPrice: 55, imageUrl: "" },
    { productId: "p2", productTitle: "Funkita Diamond Back One Piece - Kulin Colour", variantId: "v2b", variantTitle: "Size 10", variantSku: "FK-DB-KC-10", vendor: "Funkita", currentStock: 0, velocity: 0.4, rop: 6, daysOfStock: 0, lostRevenuePerDay: 43.98, price: 109.95, costPrice: 55, imageUrl: "" },
    { productId: "p3", productTitle: "Speedo Endurance+ Medalist", variantId: "v3a", variantTitle: "Size 10", variantSku: "SP-EM-10", vendor: "Speedo", currentStock: 12, velocity: 1.2, rop: 17, daysOfStock: 10, lostRevenuePerDay: 0, price: 79.95, costPrice: 40, imageUrl: "" },
    { productId: "p3", productTitle: "Speedo Endurance+ Medalist", variantId: "v3b", variantTitle: "Size 12", variantSku: "SP-EM-12", vendor: "Speedo", currentStock: 3, velocity: 1.0, rop: 14, daysOfStock: 3, lostRevenuePerDay: 0, price: 79.95, costPrice: 40, imageUrl: "" },
    { productId: "p4", productTitle: "Tigerlily Caya Tara Triangle Top", variantId: "v4a", variantTitle: "Size 8", variantSku: "TL-CTT-8", vendor: "Tigerlily", currentStock: 0, velocity: 0.2, rop: 3, daysOfStock: 0, lostRevenuePerDay: 23.99, price: 119.95, costPrice: 60, imageUrl: "" },
    { productId: "p5", productTitle: "Jets Jetset D/DD Twist Top", variantId: "v5a", variantTitle: "Size 10", variantSku: "JT-DD-10", vendor: "Jets", currentStock: 4, velocity: 0.3, rop: 4, daysOfStock: 13, lostRevenuePerDay: 0, price: 139.95, costPrice: 70, imageUrl: "" },
    { productId: "p6", productTitle: "Alemais Floral Midi Dress", variantId: "v6a", variantTitle: "Size 10", variantSku: "AL-FMD-10", vendor: "Alemais", currentStock: 1, velocity: 0.1, rop: 1, daysOfStock: 10, lostRevenuePerDay: 0, price: 450, costPrice: 225, imageUrl: "" },
  ];
  localStorage.setItem("inventory_demo_products", JSON.stringify(products));
  return products;
}

function classifyABC(products: InventoryProduct[]): InventoryProduct[] {
  const withRevenue = products.map(p => ({ ...p, revenue: p.velocity * 30 * p.price }));
  const sorted = [...withRevenue].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sorted.reduce((s, p) => s + p.revenue, 0);
  let cumulative = 0;
  return sorted.map(p => {
    cumulative += p.revenue;
    const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1;
    return { ...p, abcClass: pct <= 0.8 ? "A" as const : pct <= 0.95 ? "B" as const : "C" as const };
  });
}

// ── Sub-Components ──

function DashboardView({ products, pos, adjustments, onCreatePO }: { products: InventoryProduct[]; pos: PurchaseOrder[]; adjustments: StockAdjustment[]; onCreatePO: () => void }) {
  const outOfStock = products.filter(p => p.currentStock === 0);
  const belowROP = products.filter(p => p.currentStock > 0 && p.currentStock <= p.rop);
  const openPOs = pos.filter(p => ["draft", "sent", "partial"].includes(p.status));
  const dailyLost = products.reduce((s, p) => s + p.lostRevenuePerDay, 0);
  const urgentReorder = [...products].filter(p => p.lostRevenuePerDay > 0 || p.currentStock <= p.rop).sort((a, b) => b.lostRevenuePerDay - a.lostRevenuePerDay).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-destructive">{outOfStock.length}</div><p className="text-xs text-muted-foreground mt-1">Out of stock</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-orange-500">{belowROP.length}</div><p className="text-xs text-muted-foreground mt-1">Below reorder point</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-primary">{openPOs.length}</div><p className="text-xs text-muted-foreground mt-1">Open POs</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-destructive">${dailyLost.toFixed(0)}</div><p className="text-xs text-muted-foreground mt-1">Lost revenue/day</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" /> Urgent reorders</CardTitle></CardHeader>
        <CardContent>
          {urgentReorder.length === 0 ? <p className="text-sm text-muted-foreground">All stock levels are healthy ✓</p> : (
            <div className="space-y-2">
              {urgentReorder.map(p => (
                <div key={p.variantId} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.productTitle}</p>
                    <p className="text-xs text-muted-foreground">{p.variantTitle} · {p.variantSku}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <Badge variant={p.currentStock === 0 ? "destructive" : "secondary"}>{p.currentStock} units</Badge>
                    <span className="text-muted-foreground">{p.velocity.toFixed(1)}/day</span>
                    <span className="text-muted-foreground">{p.daysOfStock}d left</span>
                    {p.lostRevenuePerDay > 0 && <span className="text-destructive font-medium">-${p.lostRevenuePerDay.toFixed(0)}/day</span>}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={onCreatePO}><Plus className="w-3 h-3 mr-1" /> Create PO from low stock</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Open purchase orders</CardTitle></CardHeader>
          <CardContent>
            {openPOs.length === 0 ? <p className="text-sm text-muted-foreground">No open POs</p> : openPOs.slice(0, 5).map(po => (
              <div key={po.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{po.poNumber}</p>
                  <p className="text-xs text-muted-foreground">{po.supplierName} · {po.lineItems.length} items</p>
                </div>
                <Badge variant={po.status === "draft" ? "secondary" : po.status === "sent" ? "default" : "outline"}>{po.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent adjustments</CardTitle></CardHeader>
          <CardContent>
            {adjustments.length === 0 ? <p className="text-sm text-muted-foreground">No recent adjustments</p> : adjustments.slice(-5).reverse().map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium truncate">{a.productTitle}</p>
                  <p className="text-xs text-muted-foreground">{a.variantTitle} · {a.reason}</p>
                </div>
                <Badge variant={a.adjustment > 0 ? "default" : "destructive"}>{a.adjustment > 0 ? "+" : ""}{a.adjustment}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PurchaseOrdersView({ pos, suppliers, onSave }: { pos: PurchaseOrder[]; suppliers: Supplier[]; onSave: (pos: PurchaseOrder[]) => void }) {
  const [filter, setFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [form, setForm] = useState({ supplierId: "", locationName: "Main Store", notes: "", expectedDays: 14, currency: "AUD" });
  const [lineItems, setLineItems] = useState<PurchaseOrderItem[]>([]);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const filteredPOs = filter === "all" ? pos : pos.filter(p => p.status === filter);
  const viewPO = viewing ? pos.find(p => p.id === viewing) : null;

  const products = getDemoProducts();

  const addLineItem = (p: InventoryProduct) => {
    if (lineItems.find(l => l.id === p.variantId)) return;
    const suggestedQty = Math.max(1, Math.ceil(p.velocity * 30) - p.currentStock);
    setLineItems(prev => [...prev, {
      id: p.variantId, productTitle: p.productTitle, variantTitle: p.variantTitle,
      variantSku: p.variantSku, quantityOrdered: suggestedQty, quantityReceived: 0,
      costPrice: p.costPrice, totalCost: (p.costPrice || 0) * suggestedQty, currentStock: p.currentStock, velocity: p.velocity
    }]);
  };

  const createPO = () => {
    if (!form.supplierId || lineItems.length === 0) { toast.error("Select a supplier and add items"); return; }
    const supplier = suppliers.find(s => s.id === form.supplierId);
    const subtotal = lineItems.reduce((s, l) => s + (l.totalCost || 0), 0);
    const expected = new Date(); expected.setDate(expected.getDate() + form.expectedDays);
    const po: PurchaseOrder = {
      id: generateId(), poNumber: generatePONumber(), supplierId: form.supplierId,
      supplierName: supplier?.name || "Unknown", locationName: form.locationName,
      status: "draft", currency: form.currency, notes: form.notes,
      expectedAt: expected.toISOString(), subtotal, total: subtotal,
      lineItems, createdAt: new Date().toISOString()
    };
    onSave([...pos, po]);
    toast.success(`PO ${po.poNumber} created`);
    addAuditEntry("Purchase Order", `Created ${po.poNumber} for ${supplier?.name}`);
    setCreating(false); setLineItems([]); setForm({ supplierId: "", locationName: "Main Store", notes: "", expectedDays: 14, currency: "AUD" });
  };

  const updateStatus = (poId: string, status: PurchaseOrder["status"]) => {
    const updated = pos.map(p => p.id === poId ? { ...p, status, ...(status === "sent" ? { sentAt: new Date().toISOString() } : {}), ...(status === "received" ? { receivedAt: new Date().toISOString() } : {}) } : p);
    onSave(updated);
    toast.success(`PO status updated to ${status}`);
  };

  const receiveItems = (poId: string) => {
    const updated = pos.map(po => {
      if (po.id !== poId) return po;
      const newItems = po.lineItems.map(li => {
        const qty = receiveQtys[li.id] || 0;
        return { ...li, quantityReceived: li.quantityReceived + qty };
      });
      const allDone = newItems.every(li => li.quantityReceived >= li.quantityOrdered);
      const anyDone = newItems.some(li => li.quantityReceived > 0);
      return { ...po, lineItems: newItems, status: (allDone ? "received" : anyDone ? "partial" : po.status) as PurchaseOrder["status"], receivedAt: allDone ? new Date().toISOString() : po.receivedAt };
    });
    onSave(updated);
    // Record adjustments
    const po = pos.find(p => p.id === poId);
    if (po) {
      const adjs = loadAdjustments();
      po.lineItems.forEach(li => {
        const qty = receiveQtys[li.id] || 0;
        if (qty > 0) {
          adjs.push({ id: generateId(), locationName: po.locationName, productTitle: li.productTitle, variantTitle: li.variantTitle, variantSku: li.variantSku, adjustment: qty, reason: "received", reference: po.poNumber, createdAt: new Date().toISOString() });
        }
      });
      saveAdjustments(adjs);
    }
    toast.success("Items received and stock adjusted");
    setReceiving(null); setReceiveQtys({});
  };

  if (receiving && viewPO) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setReceiving(null)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">Receive stock — {viewPO.poNumber}</h3></div>
        <div className="space-y-2">
          {viewPO.lineItems.map(li => (
            <div key={li.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div><p className="text-sm font-medium">{li.productTitle}</p><p className="text-xs text-muted-foreground">{li.variantTitle} · Ordered: {li.quantityOrdered} · Previously received: {li.quantityReceived}</p></div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Qty:</Label>
                <Input type="number" className="w-20 h-8" min={0} max={li.quantityOrdered - li.quantityReceived} value={receiveQtys[li.id] || 0} onChange={e => setReceiveQtys(prev => ({ ...prev, [li.id]: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { const q: Record<string, number> = {}; viewPO.lineItems.forEach(li => { q[li.id] = li.quantityOrdered - li.quantityReceived; }); setReceiveQtys(q); }}>Mark all received</Button>
          <Button onClick={() => receiveItems(viewPO.id)}>Save received quantities</Button>
        </div>
      </div>
    );
  }

  if (viewing && viewPO) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setViewing(null)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">{viewPO.poNumber}</h3><Badge>{viewPO.status}</Badge></div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><Label className="text-xs text-muted-foreground">Supplier</Label><p>{viewPO.supplierName}</p></div>
          <div><Label className="text-xs text-muted-foreground">Location</Label><p>{viewPO.locationName}</p></div>
          <div><Label className="text-xs text-muted-foreground">Expected</Label><p>{viewPO.expectedAt ? new Date(viewPO.expectedAt).toLocaleDateString() : "—"}</p></div>
          <div><Label className="text-xs text-muted-foreground">Total</Label><p className="font-semibold">${viewPO.total.toFixed(2)}</p></div>
        </div>
        {viewPO.notes && <p className="text-sm text-muted-foreground">Notes: {viewPO.notes}</p>}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Line items ({viewPO.lineItems.length})</h4>
          {viewPO.lineItems.map(li => (
            <div key={li.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div><p className="text-sm font-medium">{li.productTitle}</p><p className="text-xs text-muted-foreground">{li.variantTitle} · {li.variantSku}</p></div>
              <div className="text-right text-sm">
                <p>Ordered: {li.quantityOrdered}</p>
                <p className="text-muted-foreground">Received: {li.quantityReceived}</p>
                {li.costPrice && <p className="text-muted-foreground">${li.costPrice} ea · ${li.totalCost?.toFixed(2)}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {viewPO.status === "draft" && <Button size="sm" onClick={() => updateStatus(viewPO.id, "sent")}><Send className="w-3 h-3 mr-1" /> Mark as sent</Button>}
          {["sent", "partial"].includes(viewPO.status) && <Button size="sm" onClick={() => { setReceiving(viewPO.id); }}><Package className="w-3 h-3 mr-1" /> Receive stock</Button>}
          {viewPO.status === "draft" && <Button size="sm" variant="destructive" onClick={() => { updateStatus(viewPO.id, "cancelled"); setViewing(null); }}><X className="w-3 h-3 mr-1" /> Cancel</Button>}
        </div>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setCreating(false)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">Create purchase order</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Supplier</Label>
            <Select value={form.supplierId} onValueChange={v => { setForm(prev => ({ ...prev, supplierId: v })); const s = suppliers.find(s => s.id === v); if (s) setForm(prev => ({ ...prev, expectedDays: s.leadTimeDays })); }}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.leadTimeDays}d lead)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Location</Label><Input value={form.locationName} onChange={e => setForm(prev => ({ ...prev, locationName: e.target.value }))} /></div>
          <div><Label>Expected in (days)</Label><Input type="number" value={form.expectedDays} onChange={e => setForm(prev => ({ ...prev, expectedDays: parseInt(e.target.value) || 14 }))} /></div>
          <div><Label>Currency</Label><Input value={form.currency} onChange={e => setForm(prev => ({ ...prev, currency: e.target.value }))} /></div>
        </div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} /></div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add products</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {products.filter(p => !lineItems.find(l => l.id === p.variantId)).map(p => (
                <div key={p.variantId} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <div><p className="text-sm">{p.productTitle} — {p.variantTitle}</p><p className="text-xs text-muted-foreground">Stock: {p.currentStock} · Velocity: {p.velocity.toFixed(1)}/day</p></div>
                  <Button size="sm" variant="outline" onClick={() => addLineItem(p)}><Plus className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {lineItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Order items ({lineItems.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={li.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{li.productTitle}</p><p className="text-xs text-muted-foreground">{li.variantTitle} · Stock: {li.currentStock}</p></div>
                  <div className="flex items-center gap-2">
                    <div><Label className="text-xs">Qty</Label><Input type="number" className="w-16 h-8" min={1} value={li.quantityOrdered} onChange={e => { const qty = parseInt(e.target.value) || 1; setLineItems(prev => prev.map((l, j) => j === i ? { ...l, quantityOrdered: qty, totalCost: (l.costPrice || 0) * qty } : l)); }} /></div>
                    <div><Label className="text-xs">Cost</Label><Input type="number" className="w-20 h-8" step="0.01" value={li.costPrice || ""} onChange={e => { const cost = parseFloat(e.target.value) || 0; setLineItems(prev => prev.map((l, j) => j === i ? { ...l, costPrice: cost, totalCost: cost * l.quantityOrdered } : l)); }} /></div>
                    <Button size="sm" variant="ghost" onClick={() => setLineItems(prev => prev.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
              <div className="text-right text-sm font-semibold pt-2">Total: ${lineItems.reduce((s, l) => s + (l.totalCost || 0), 0).toFixed(2)}</div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          <Button onClick={createPO}>Create PO</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {["all", "draft", "sent", "partial", "received", "cancelled"].map(s => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)} className="capitalize text-xs">{s} {s !== "all" && `(${pos.filter(p => p.status === s).length})`}</Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-3 h-3 mr-1" /> Create PO</Button>
      </div>
      {filteredPOs.length === 0 ? (
        <Card><CardContent className="p-8 text-center"><Package className="w-8 h-8 mx-auto text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">No purchase orders</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setCreating(true)}>Create your first PO</Button></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filteredPOs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(po => (
            <div key={po.id} className="flex items-center justify-between p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewing(po.id)}>
              <div>
                <div className="flex items-center gap-2"><p className="text-sm font-semibold">{po.poNumber}</p><Badge variant={po.status === "received" ? "default" : po.status === "cancelled" ? "destructive" : "secondary"}>{po.status}</Badge></div>
                <p className="text-xs text-muted-foreground mt-0.5">{po.supplierName} · {po.lineItems.length} items · {po.locationName}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-medium">${po.total.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{new Date(po.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StocktakeView({ stocktakes, onSave }: { stocktakes: Stocktake[]; onSave: (s: Stocktake[]) => void }) {
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [form, setForm] = useState({ locationName: "Main Store", employeeName: "", notes: "", scope: "full" });

  const active = activeId ? stocktakes.find(s => s.id === activeId) : null;
  const products = getDemoProducts();

  const createStocktake = () => {
    const items: StocktakeItem[] = products.map(p => ({
      id: generateId(), productTitle: p.productTitle, variantTitle: p.variantTitle,
      variantSku: p.variantSku, barcode: p.variantSku, expectedQty: p.currentStock,
      countedQty: null, variance: null, adjusted: false
    }));
    const st: Stocktake = {
      id: generateId(), locationName: form.locationName, status: "in_progress",
      notes: form.notes, employeeName: form.employeeName,
      startedAt: new Date().toISOString(), items
    };
    onSave([...stocktakes, st]);
    setActiveId(st.id);
    setCreating(false);
    toast.success("Stocktake started");
    addAuditEntry("Stocktake", `Started stocktake at ${form.locationName}`);
  };

  const updateCount = (itemId: string, qty: number | null) => {
    const updated = stocktakes.map(st => st.id !== activeId ? st : {
      ...st, items: st.items.map(i => i.id !== itemId ? i : { ...i, countedQty: qty, variance: qty !== null ? qty - i.expectedQty : null })
    });
    onSave(updated);
  };

  const handleScan = () => {
    if (!scanInput.trim() || !active) return;
    const item = active.items.find(i => i.variantSku?.toLowerCase() === scanInput.trim().toLowerCase() || i.barcode?.toLowerCase() === scanInput.trim().toLowerCase());
    if (item) {
      updateCount(item.id, (item.countedQty || 0) + 1);
      toast.success(`${item.productTitle} — ${item.variantTitle}: ${(item.countedQty || 0) + 1}`);
    } else {
      toast.error("Item not found");
    }
    setScanInput("");
  };

  const completeStocktake = () => {
    const updated = stocktakes.map(st => st.id !== activeId ? st : {
      ...st, status: "completed" as const, completedAt: new Date().toISOString(),
      items: st.items.map(i => i.countedQty !== null ? { ...i, adjusted: true } : i)
    });
    onSave(updated);
    // Record adjustments
    const st = stocktakes.find(s => s.id === activeId);
    if (st) {
      const adjs = loadAdjustments();
      st.items.forEach(i => {
        if (i.countedQty !== null && i.variance !== 0) {
          adjs.push({
            id: generateId(), locationName: st.locationName, productTitle: i.productTitle,
            variantTitle: i.variantTitle, variantSku: i.variantSku,
            adjustment: i.variance || 0, reason: "correction",
            employeeName: st.employeeName, reference: `Stocktake ${st.id.slice(0, 8)}`,
            createdAt: new Date().toISOString()
          });
        }
      });
      saveAdjustments(adjs);
    }
    toast.success("Stocktake completed and adjustments applied");
    setActiveId(null);
  };

  if (active) {
    const counted = active.items.filter(i => i.countedQty !== null).length;
    const total = active.items.length;
    const positiveVar = active.items.filter(i => i.variance !== null && i.variance > 0);
    const negativeVar = active.items.filter(i => i.variance !== null && i.variance < 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setActiveId(null)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">Stocktake — {active.locationName}</h3><Badge>{active.status}</Badge></div>
        
        <div className="w-full bg-muted rounded-full h-2"><div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${(counted / total) * 100}%` }} /></div>
        <p className="text-xs text-muted-foreground text-center">Counted {counted} of {total} variants ({Math.round((counted / total) * 100)}%)</p>

        {active.status === "in_progress" && (
          <div className="flex gap-2">
            <Input placeholder="Scan barcode or type SKU..." value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleScan()} className="flex-1" autoFocus />
            <Button onClick={handleScan}>Scan</Button>
          </div>
        )}

        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {active.items.map(item => (
            <div key={item.id} className={`flex items-center justify-between p-2.5 rounded-lg border ${item.countedQty === null ? "border-border" : item.variance === 0 ? "border-green-300 bg-green-50 dark:bg-green-950/20" : Math.abs(item.variance || 0) <= 5 ? "border-orange-300 bg-orange-50 dark:bg-orange-950/20" : "border-red-300 bg-red-50 dark:bg-red-950/20"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.productTitle}</p>
                <p className="text-xs text-muted-foreground">{item.variantTitle} · {item.variantSku}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Exp: {item.expectedQty}</span>
                {active.status === "in_progress" ? (
                  <Input type="number" className="w-16 h-8" min={0} value={item.countedQty ?? ""} placeholder="—" onChange={e => updateCount(item.id, e.target.value === "" ? null : parseInt(e.target.value))} />
                ) : (
                  <span>{item.countedQty ?? "—"}</span>
                )}
                {item.variance !== null && <Badge variant={item.variance === 0 ? "default" : "destructive"}>{item.variance > 0 ? "+" : ""}{item.variance}</Badge>}
              </div>
            </div>
          ))}
        </div>

        {active.status === "in_progress" && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {positiveVar.length > 0 && <p>↑ {positiveVar.length} items with positive variance (+{positiveVar.reduce((s, i) => s + (i.variance || 0), 0)} units)</p>}
              {negativeVar.length > 0 && <p>↓ {negativeVar.length} items with negative variance ({negativeVar.reduce((s, i) => s + (i.variance || 0), 0)} units)</p>}
            </div>
            <Button onClick={completeStocktake} className="w-full"><Check className="w-4 h-4 mr-1" /> Complete count & apply adjustments</Button>
          </div>
        )}
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setCreating(false)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">New stocktake</h3></div>
        <div><Label>Location</Label><Input value={form.locationName} onChange={e => setForm(prev => ({ ...prev, locationName: e.target.value }))} /></div>
        <div><Label>Employee name (optional)</Label><Input value={form.employeeName} onChange={e => setForm(prev => ({ ...prev, employeeName: e.target.value }))} /></div>
        <div><Label>Notes (optional)</Label><Textarea value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} /></div>
        <Button onClick={createStocktake} className="w-full">Begin count</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Stocktakes</h3><Button size="sm" onClick={() => setCreating(true)}><Plus className="w-3 h-3 mr-1" /> New stocktake</Button></div>
      {stocktakes.length === 0 ? (
        <Card><CardContent className="p-8 text-center"><ClipboardList className="w-8 h-8 mx-auto text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">No stocktakes yet</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setCreating(true)}>Start your first stocktake</Button></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {stocktakes.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map(st => {
            const counted = st.items.filter(i => i.countedQty !== null).length;
            return (
              <div key={st.id} className="flex items-center justify-between p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setActiveId(st.id)}>
                <div><p className="text-sm font-medium">{st.locationName}</p><p className="text-xs text-muted-foreground">{new Date(st.startedAt).toLocaleDateString()} · {counted}/{st.items.length} counted{st.employeeName ? ` · ${st.employeeName}` : ""}</p></div>
                <Badge variant={st.status === "completed" ? "default" : st.status === "cancelled" ? "destructive" : "secondary"}>{st.status.replace("_", " ")}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportsView({ products }: { products: InventoryProduct[] }) {
  const [reportTab, setReportTab] = useState("low_stock");
  const [forecastPeriod, setForecastPeriod] = useState("30");
  const adjustments = loadAdjustments();
  const classified = classifyABC(products);

  const lowStockProducts = [...products].filter(p => p.currentStock <= p.rop).sort((a, b) => b.lostRevenuePerDay - a.lostRevenuePerDay);
  const bestSellers = [...products].sort((a, b) => b.velocity - a.velocity).slice(0, 20);
  const totalStockValue = products.reduce((s, p) => s + p.currentStock * (p.costPrice || 0), 0);

  const abcA = classified.filter(p => p.abcClass === "A");
  const abcB = classified.filter(p => p.abcClass === "B");
  const abcC = classified.filter(p => p.abcClass === "C");

  const suppliers = loadSuppliers();
  const reorderBySupplier = suppliers.map(sup => {
    const items = lowStockProducts.filter(p => {
      // simple match by vendor
      return true; // In real app, match via SupplierProduct link
    });
    return { supplier: sup, items };
  }).filter(g => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {[{ key: "low_stock", label: "Low stock" }, { key: "abc", label: "ABC analysis" }, { key: "best_sellers", label: "Best sellers" }, { key: "stock_on_hand", label: "Stock on hand" }, { key: "adjustments", label: "Adjustments" }, { key: "reorder", label: "Reorder suggestions" }].map(t => (
          <Button key={t.key} size="sm" variant={reportTab === t.key ? "default" : "outline"} onClick={() => setReportTab(t.key)} className="text-xs">{t.label}</Button>
        ))}
      </div>

      {reportTab === "low_stock" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{lowStockProducts.length} items at or below reorder point</p>
            <Select value={forecastPeriod} onValueChange={setForecastPeriod}><SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">Last 30d</SelectItem><SelectItem value="60">Last 60d</SelectItem><SelectItem value="90">Last 90d</SelectItem></SelectContent></Select>
          </div>
          {lowStockProducts.map(p => (
            <div key={p.variantId} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.productTitle}</p>
                <p className="text-xs text-muted-foreground">{p.variantTitle} · {p.variantSku} · {p.vendor}</p>
              </div>
              <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
                <Badge variant={p.currentStock === 0 ? "destructive" : "secondary"}>{p.currentStock} units</Badge>
                <span className="text-muted-foreground">{p.velocity.toFixed(1)}/d</span>
                <span className="text-muted-foreground">{p.daysOfStock}d left</span>
                <span className="text-muted-foreground">ROP: {p.rop}</span>
                {p.lostRevenuePerDay > 0 && <span className="text-destructive">-${p.lostRevenuePerDay.toFixed(0)}/d</span>}
              </div>
            </div>
          ))}
          {lowStockProducts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">All products above reorder point ✓</p>}
        </div>
      )}

      {reportTab === "abc" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-3 text-center"><Badge className="bg-green-500 text-white">A</Badge><p className="text-lg font-bold mt-1">{abcA.length}</p><p className="text-xs text-muted-foreground">80% of revenue</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><Badge className="bg-orange-400 text-white">B</Badge><p className="text-lg font-bold mt-1">{abcB.length}</p><p className="text-xs text-muted-foreground">15% of revenue</p></CardContent></Card>
            <Card><CardContent className="p-3 text-center"><Badge variant="secondary">C</Badge><p className="text-lg font-bold mt-1">{abcC.length}</p><p className="text-xs text-muted-foreground">5% of revenue</p></CardContent></Card>
          </div>
          {classified.map(p => (
            <div key={p.variantId} className={`flex items-center justify-between p-3 rounded-lg border ${p.abcClass === "A" ? "border-green-300 bg-green-50 dark:bg-green-950/20" : p.abcClass === "B" ? "border-orange-300 bg-orange-50 dark:bg-orange-950/20" : "border-border"}`}>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.productTitle}</p><p className="text-xs text-muted-foreground">{p.variantTitle} · {p.vendor}</p></div>
              <div className="flex items-center gap-2 text-xs"><span>${(p.velocity * 30 * p.price).toFixed(0)}/mo</span><Badge variant={p.abcClass === "A" ? "default" : "secondary"}>{p.abcClass}</Badge></div>
            </div>
          ))}
        </div>
      )}

      {reportTab === "best_sellers" && (
        <div className="space-y-2">
          {bestSellers.map((p, i) => (
            <div key={p.variantId} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3"><span className="text-lg font-bold text-muted-foreground w-6 text-right">#{i + 1}</span><div><p className="text-sm font-medium truncate">{p.productTitle}</p><p className="text-xs text-muted-foreground">{p.variantTitle} · {p.vendor}</p></div></div>
              <div className="text-right text-xs"><p className="font-medium">{(p.velocity * 30).toFixed(0)} units/mo</p><p className="text-muted-foreground">${(p.velocity * 30 * p.price).toFixed(0)} revenue</p><p className="text-muted-foreground">{p.currentStock} in stock</p></div>
            </div>
          ))}
        </div>
      )}

      {reportTab === "stock_on_hand" && (
        <div className="space-y-3">
          <Card><CardContent className="p-4"><div className="grid grid-cols-2 gap-4 text-center"><div><p className="text-2xl font-bold">{products.reduce((s, p) => s + p.currentStock, 0)}</p><p className="text-xs text-muted-foreground">Total units</p></div><div><p className="text-2xl font-bold">${totalStockValue.toFixed(0)}</p><p className="text-xs text-muted-foreground">Total cost value</p></div></div></CardContent></Card>
          {products.map(p => (
            <div key={p.variantId} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.productTitle}</p><p className="text-xs text-muted-foreground">{p.variantTitle} · {p.variantSku}</p></div>
              <div className="text-right text-xs"><p className="font-medium">{p.currentStock} units</p><p className="text-muted-foreground">${((p.costPrice || 0) * p.currentStock).toFixed(2)}</p></div>
            </div>
          ))}
        </div>
      )}

      {reportTab === "adjustments" && (
        <div className="space-y-2">
          {adjustments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No adjustments recorded</p> : adjustments.slice().reverse().map(a => (
            <div key={a.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{a.productTitle}</p><p className="text-xs text-muted-foreground">{a.variantTitle} · {a.reason}{a.reference ? ` · ${a.reference}` : ""}{a.employeeName ? ` · ${a.employeeName}` : ""}</p></div>
              <div className="text-right"><Badge variant={a.adjustment > 0 ? "default" : "destructive"}>{a.adjustment > 0 ? "+" : ""}{a.adjustment}</Badge><p className="text-xs text-muted-foreground mt-1">{new Date(a.createdAt).toLocaleDateString()}</p></div>
            </div>
          ))}
        </div>
      )}

      {reportTab === "reorder" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Products grouped by suggested supplier reorder</p>
          {lowStockProducts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No reorders needed ✓</p> : (
            <div className="space-y-2">
              {lowStockProducts.map(p => {
                const suggestedQty = Math.max(1, Math.ceil(p.velocity * 30) - p.currentStock);
                return (
                  <div key={p.variantId} className="flex items-center justify-between p-3 border border-border rounded-lg">
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.productTitle}</p><p className="text-xs text-muted-foreground">{p.variantTitle} · Stock: {p.currentStock} · ROP: {p.rop}</p></div>
                    <div className="text-right text-xs"><p className="font-medium">Suggest: {suggestedQty} units</p><p className="text-muted-foreground">${((p.costPrice || 0) * suggestedQty).toFixed(2)}</p></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuppliersView({ suppliers, onSave }: { suppliers: Supplier[]; onSave: (s: Supplier[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>({});

  const startCreate = () => { setForm({ name: "", leadTimeDays: 14 }); setEditing("new"); };
  const startEdit = (s: Supplier) => { setForm(s); setEditing(s.id); };

  const save = () => {
    if (!form.name?.trim()) { toast.error("Supplier name required"); return; }
    if (editing === "new") {
      const s: Supplier = { id: generateId(), name: form.name!, contactName: form.contactName, email: form.email, phone: form.phone, website: form.website, address: form.address, notes: form.notes, leadTimeDays: form.leadTimeDays || 14, createdAt: new Date().toISOString() };
      onSave([...suppliers, s]);
      toast.success(`Supplier "${s.name}" added`);
      addAuditEntry("Supplier", `Added supplier: ${s.name}`);
    } else {
      onSave(suppliers.map(s => s.id === editing ? { ...s, ...form } as Supplier : s));
      toast.success("Supplier updated");
    }
    setEditing(null); setForm({});
  };

  const remove = (id: string) => {
    onSave(suppliers.filter(s => s.id !== id));
    toast.success("Supplier removed");
  };

  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setEditing(null)}><ArrowLeft className="w-4 h-4" /></Button><h3 className="font-semibold">{editing === "new" ? "Add supplier" : "Edit supplier"}</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Name *</Label><Input value={form.name || ""} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} /></div>
          <div><Label>Lead time (days)</Label><Input type="number" value={form.leadTimeDays || 14} onChange={e => setForm(prev => ({ ...prev, leadTimeDays: parseInt(e.target.value) || 14 }))} /></div>
          <div><Label>Contact name</Label><Input value={form.contactName || ""} onChange={e => setForm(prev => ({ ...prev, contactName: e.target.value }))} /></div>
          <div><Label>Email</Label><Input value={form.email || ""} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone || ""} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} /></div>
          <div><Label>Website</Label><Input value={form.website || ""} onChange={e => setForm(prev => ({ ...prev, website: e.target.value }))} /></div>
        </div>
        <div><Label>Address</Label><Input value={form.address || ""} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} /></div>
        <div><Label>Notes</Label><Textarea value={form.notes || ""} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={2} /></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Suppliers</h3><Button size="sm" onClick={startCreate}><Plus className="w-3 h-3 mr-1" /> Add supplier</Button></div>
      {suppliers.length === 0 ? (
        <Card><CardContent className="p-8 text-center"><Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">No suppliers added yet</p><Button variant="outline" size="sm" className="mt-3" onClick={startCreate}>Add your first supplier</Button></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {suppliers.map(s => (
            <div key={s.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
              <div><p className="text-sm font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">{s.email || "No email"} · Lead time: {s.leadTimeDays}d{s.contactName ? ` · ${s.contactName}` : ""}</p></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => startEdit(s)}><Edit className="w-3 h-3" /></Button><Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="w-3 h-3" /></Button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──
interface Props { onBack: () => void; }

const InventoryPlanningPanel = ({ onBack }: Props) => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [suppliers, setSuppliers] = useState<Supplier[]>(loadSuppliers);
  const [pos, setPOs] = useState<PurchaseOrder[]>(loadPOs);
  const [stocktakes, setStocktakes] = useState<Stocktake[]>(loadStocktakes);
  const products = getDemoProducts();
  const adjustments = loadAdjustments();

  const handleSaveSuppliers = (s: Supplier[]) => { setSuppliers(s); saveSuppliers(s); };
  const handleSavePOs = (p: PurchaseOrder[]) => { setPOs(p); savePOs(p); };
  const handleSaveStocktakes = (s: Stocktake[]) => { setStocktakes(s); saveStocktakes(s); };

  const outOfStock = products.filter(p => p.currentStock === 0).length;
  const belowROP = products.filter(p => p.currentStock > 0 && p.currentStock <= p.rop).length;
  const openPOCount = pos.filter(p => ["draft", "sent", "partial"].includes(p.status)).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-xl font-bold font-display">Inventory planning</h1>
          <p className="text-sm text-muted-foreground">Purchase orders, forecasting, stocktakes & reports</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 flex-wrap">
        {[
          { key: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { key: "purchase_orders", label: `POs${openPOCount > 0 ? ` (${openPOCount})` : ""}`, icon: <Truck className="w-3.5 h-3.5" /> },
          { key: "stocktake", label: "Stocktake", icon: <ClipboardList className="w-3.5 h-3.5" /> },
          { key: "reports", label: "Reports", icon: <TrendingUp className="w-3.5 h-3.5" /> },
          { key: "suppliers", label: `Suppliers (${suppliers.length})`, icon: <Users className="w-3.5 h-3.5" /> },
        ].map(t => (
          <Button key={t.key} size="sm" variant={activeTab === t.key ? "default" : "outline"} onClick={() => setActiveTab(t.key)} className="text-xs gap-1">{t.icon}{t.label}</Button>
        ))}
      </div>

      {activeTab === "dashboard" && <DashboardView products={products} pos={pos} adjustments={adjustments} onCreatePO={() => setActiveTab("purchase_orders")} />}
      {activeTab === "purchase_orders" && <PurchaseOrdersView pos={pos} suppliers={suppliers} onSave={handleSavePOs} />}
      {activeTab === "stocktake" && <StocktakeView stocktakes={stocktakes} onSave={handleSaveStocktakes} />}
      {activeTab === "reports" && <ReportsView products={products} />}
      {activeTab === "suppliers" && <SuppliersView suppliers={suppliers} onSave={handleSaveSuppliers} />}
    </div>
  );
};

export default InventoryPlanningPanel;
