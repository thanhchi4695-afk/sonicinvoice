import { useState, useCallback } from "react";
import {
  ChevronLeft, Upload, Check, AlertTriangle, FileText, Users,
  Package, DollarSign, Loader2, Download, Plus, Trash2, X,
  ArrowRight, CheckCircle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import Papa from "papaparse";

/* ─── Types ─── */

interface StockyPO {
  poNumber: string;
  supplier: string;
  status: string;
  orderedAt: string;
  receivedAt: string;
  lines: StockyPOLine[];
}

interface StockyPOLine {
  product: string;
  sku: string;
  variant: string;
  quantityOrdered: number;
  quantityReceived: number;
  costPrice: number;
  totalCost: number;
}

interface MigratedSupplier {
  id: string;
  name: string;
  poCount: number;
  totalSpend: number;
  avgLeadTime: number;
  productCount: number;
  lastOrderDate: string;
}

interface MigrationSummary {
  purchaseOrders: number;
  suppliers: number;
  products: number;
  totalSpend: number;
  costRecords: number;
}

type Step = "upload" | "review" | "suppliers" | "complete";

/* ─── Helpers ─── */

function parseStockyCSV(rows: string[][]): StockyPO[] {
  // Stocky exports POs in various formats — detect column indices
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const colMap: Record<string, number> = {};
  const aliases: Record<string, string[]> = {
    poNumber: ["po number", "po #", "po_number", "purchase order", "order number", "po"],
    supplier: ["supplier", "vendor", "supplier name", "vendor name"],
    status: ["status", "po status", "order status"],
    orderedAt: ["ordered", "date ordered", "order date", "created", "created at", "date"],
    receivedAt: ["received", "date received", "received at", "received date"],
    product: ["product", "product title", "product name", "item", "title"],
    sku: ["sku", "variant sku", "item sku"],
    variant: ["variant", "variant title", "option", "size"],
    qtyOrdered: ["qty ordered", "quantity ordered", "ordered qty", "quantity", "qty"],
    qtyReceived: ["qty received", "quantity received", "received qty"],
    cost: ["cost", "unit cost", "cost price", "wholesale", "price"],
    total: ["total", "line total", "total cost", "subtotal"],
  };

  for (const [field, keys] of Object.entries(aliases)) {
    const idx = header.findIndex((h) => keys.some((k) => h.includes(k)));
    if (idx >= 0) colMap[field] = idx;
  }

  // Group rows by PO number
  const poMap = new Map<string, StockyPO>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    const poNum = row[colMap.poNumber] || `IMPORT-${i}`;
    const supplier = row[colMap.supplier] || "Unknown Supplier";

    if (!poMap.has(poNum)) {
      poMap.set(poNum, {
        poNumber: poNum.trim(),
        supplier: supplier.trim(),
        status: (row[colMap.status] || "received").trim().toLowerCase(),
        orderedAt: row[colMap.orderedAt] || "",
        receivedAt: row[colMap.receivedAt] || "",
        lines: [],
      });
    }

    const po = poMap.get(poNum)!;
    const qtyOrdered = parseFloat(row[colMap.qtyOrdered] || "0") || 0;
    const qtyReceived = parseFloat(row[colMap.qtyReceived] || String(qtyOrdered)) || 0;
    const cost = parseFloat((row[colMap.cost] || "0").replace(/[$,]/g, "")) || 0;
    const total = parseFloat((row[colMap.total] || "0").replace(/[$,]/g, "")) || cost * qtyOrdered;

    if (row[colMap.product] || row[colMap.sku]) {
      po.lines.push({
        product: (row[colMap.product] || "").trim(),
        sku: (row[colMap.sku] || "").trim(),
        variant: (row[colMap.variant] || "").trim(),
        quantityOrdered: qtyOrdered,
        quantityReceived: qtyReceived,
        costPrice: cost,
        totalCost: total,
      });
    }
  }

  return Array.from(poMap.values());
}

function buildSuppliers(pos: StockyPO[]): MigratedSupplier[] {
  const map = new Map<string, MigratedSupplier>();

  pos.forEach((po) => {
    const name = po.supplier;
    if (!map.has(name)) {
      map.set(name, {
        id: crypto.randomUUID(),
        name,
        poCount: 0,
        totalSpend: 0,
        avgLeadTime: 14,
        productCount: 0,
        lastOrderDate: "",
      });
    }
    const s = map.get(name)!;
    s.poCount++;
    s.totalSpend += po.lines.reduce((sum, l) => sum + l.totalCost, 0);
    s.productCount += new Set(po.lines.map((l) => l.sku || l.product)).size;
    if (po.orderedAt > s.lastOrderDate) s.lastOrderDate = po.orderedAt;

    // Calculate lead time if both dates available
    if (po.orderedAt && po.receivedAt) {
      const ordered = new Date(po.orderedAt).getTime();
      const received = new Date(po.receivedAt).getTime();
      if (received > ordered) {
        const days = Math.round((received - ordered) / 86400000);
        s.avgLeadTime = Math.round((s.avgLeadTime + days) / 2);
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend);
}

function saveMigrationData(pos: StockyPO[], suppliers: MigratedSupplier[]) {
  // Save suppliers to inventory_suppliers format
  const existingSuppliers: any[] = JSON.parse(localStorage.getItem("inventory_suppliers") || "[]");
  const newSuppliers = suppliers
    .filter((s) => !existingSuppliers.some((es: any) => es.name.toLowerCase() === s.name.toLowerCase()))
    .map((s) => ({
      id: s.id,
      name: s.name,
      contactName: "",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: `Imported from Stocky — ${s.poCount} POs, $${s.totalSpend.toFixed(0)} total spend`,
      leadTimeDays: s.avgLeadTime,
      createdAt: new Date().toISOString(),
    }));
  localStorage.setItem("inventory_suppliers", JSON.stringify([...existingSuppliers, ...newSuppliers]));

  // Save POs to inventory_pos format
  const existingPOs: any[] = JSON.parse(localStorage.getItem("inventory_pos") || "[]");
  const newPOs = pos
    .filter((po) => !existingPOs.some((ep: any) => ep.poNumber === po.poNumber))
    .map((po) => {
      const supplier = suppliers.find((s) => s.name === po.supplier);
      return {
        id: crypto.randomUUID(),
        poNumber: po.poNumber,
        supplierId: supplier?.id || "",
        supplierName: po.supplier,
        locationName: "Main Store",
        status: po.status === "received" ? "received" : po.status === "partial" ? "partial" : "sent",
        currency: "AUD",
        notes: "Imported from Stocky",
        expectedAt: po.receivedAt || po.orderedAt || "",
        sentAt: po.orderedAt || "",
        receivedAt: po.receivedAt || "",
        subtotal: po.lines.reduce((s, l) => s + l.totalCost, 0),
        total: po.lines.reduce((s, l) => s + l.totalCost, 0),
        lineItems: po.lines.map((l) => ({
          id: crypto.randomUUID(),
          productTitle: l.product,
          variantTitle: l.variant,
          variantSku: l.sku,
          imageUrl: "",
          quantityOrdered: l.quantityOrdered,
          quantityReceived: l.quantityReceived,
          costPrice: l.costPrice,
          totalCost: l.totalCost,
          currentStock: 0,
          velocity: 0,
        })),
        createdAt: po.orderedAt || new Date().toISOString(),
      };
    });
  localStorage.setItem("inventory_pos", JSON.stringify([...existingPOs, ...newPOs]));

  // Save cost history
  const costHistory: Record<string, any[]> = JSON.parse(localStorage.getItem("cost_history") || "{}");
  pos.forEach((po) => {
    po.lines.forEach((l) => {
      const key = l.sku || l.product;
      if (!key || l.costPrice <= 0) return;
      if (!costHistory[key]) costHistory[key] = [];
      costHistory[key].push({
        date: po.orderedAt || new Date().toISOString(),
        cost: l.costPrice,
        supplier: po.supplier,
        invoice: po.poNumber,
      });
    });
  });
  localStorage.setItem("cost_history", JSON.stringify(costHistory));
}

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─── Component ─── */

interface StockyMigrationProps {
  onBack: () => void;
  onComplete?: () => void;
}

export default function StockyMigration({ onBack, onComplete }: StockyMigrationProps) {
  const [step, setStep] = useState<Step>("upload");
  const [importing, setImporting] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<StockyPO[]>([]);
  const [suppliers, setSuppliers] = useState<MigratedSupplier[]>([]);
  const [editingSupplier, setEditingSupplier] = useState<string | null>(null);
  const [manualSupplierName, setManualSupplierName] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  const summary: MigrationSummary = {
    purchaseOrders: purchaseOrders.length,
    suppliers: suppliers.length,
    products: new Set(purchaseOrders.flatMap((po) => po.lines.map((l) => l.sku || l.product))).size,
    totalSpend: purchaseOrders.reduce((s, po) => s + po.lines.reduce((ls, l) => ls + l.totalCost, 0), 0),
    costRecords: purchaseOrders.reduce((s, po) => s + po.lines.filter((l) => l.costPrice > 0).length, 0),
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        const pos = parseStockyCSV(rows);
        if (pos.length === 0) {
          toast.error("No purchase orders found in file. Check the CSV format.");
          setImporting(false);
          return;
        }
        setPurchaseOrders(pos);
        setSuppliers(buildSuppliers(pos));
        setStep("review");
        setImporting(false);
        toast.success(`Found ${pos.length} purchase orders from ${buildSuppliers(pos).length} suppliers`);
      },
      error: () => {
        toast.error("Failed to parse CSV file");
        setImporting(false);
      },
    });
    e.target.value = "";
  }, []);

  const addManualSupplier = () => {
    if (!manualSupplierName.trim()) return;
    const newSupplier: MigratedSupplier = {
      id: crypto.randomUUID(),
      name: manualSupplierName.trim(),
      poCount: 0,
      totalSpend: 0,
      avgLeadTime: 14,
      productCount: 0,
      lastOrderDate: "",
    };
    setSuppliers((prev) => [...prev, newSupplier]);
    setManualSupplierName("");
    setAddingManual(false);
    toast.success(`Added ${newSupplier.name}`);
  };

  const removeSupplier = (id: string) => {
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSupplierLeadTime = (id: string, days: number) => {
    setSuppliers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, avgLeadTime: days } : s))
    );
  };

  const handleImport = () => {
    saveMigrationData(purchaseOrders, suppliers);
    setStep("complete");
    toast.success("Migration complete! Your data is ready.");
  };

  /* ─── Upload Step ─── */
  if (step === "upload") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display">Stocky Migration</h2>
            <p className="text-xs text-muted-foreground">Import your Stocky data into Sonic Invoice</p>
          </div>
        </div>

        <Card className="p-6 space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Import from Stocky</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Stocky is being sunset on August 31, 2026. Import your purchase orders,
              supplier history, and cost data to continue without interruption.
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> How to export from Stocky
            </h4>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>Open Stocky in your Shopify Admin</li>
              <li>Go to <strong>Purchase Orders</strong></li>
              <li>Click <strong>Export</strong> → CSV</li>
              <li>Upload the CSV file below</li>
            </ol>
          </div>

          <div className="space-y-3">
            <label className="block">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
                disabled={importing}
              />
              <Button className="w-full h-14 text-base" variant="default" asChild disabled={importing}>
                <span>
                  {importing ? (
                    <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Processing…</>
                  ) : (
                    <><Upload className="w-5 h-5 mr-2" /> Upload Stocky CSV Export</>
                  )}
                </span>
              </Button>
            </label>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
            </div>

            <Button variant="outline" className="w-full" onClick={() => { setStep("suppliers"); }}>
              <Users className="w-4 h-4 mr-2" /> Start fresh — add suppliers manually
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
            <div className="text-center">
              <FileText className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">Purchase Orders</p>
              <p className="text-[10px] text-muted-foreground">Full PO history imported</p>
            </div>
            <div className="text-center">
              <Users className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">Suppliers</p>
              <p className="text-[10px] text-muted-foreground">Auto-detected from POs</p>
            </div>
            <div className="text-center">
              <DollarSign className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">Cost Data</p>
              <p className="text-[10px] text-muted-foreground">Mapped to products</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  /* ─── Review Step ─── */
  if (step === "review") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setStep("upload")} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display">Review Import</h2>
            <p className="text-xs text-muted-foreground">Check your data before importing</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Card className="p-4 text-center">
            <FileText className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold font-mono-data">{summary.purchaseOrders}</p>
            <p className="text-xs text-muted-foreground">Purchase Orders</p>
          </Card>
          <Card className="p-4 text-center">
            <Users className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold font-mono-data">{summary.suppliers}</p>
            <p className="text-xs text-muted-foreground">Suppliers</p>
          </Card>
          <Card className="p-4 text-center">
            <Package className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold font-mono-data">{summary.products}</p>
            <p className="text-xs text-muted-foreground">Unique Products</p>
          </Card>
          <Card className="p-4 text-center">
            <DollarSign className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold font-mono-data">{fmt(summary.totalSpend)}</p>
            <p className="text-xs text-muted-foreground">Total Spend</p>
          </Card>
        </div>

        {/* PO list */}
        <Card className="p-4 mb-4">
          <h3 className="text-sm font-semibold mb-3">Purchase Orders ({purchaseOrders.length})</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {purchaseOrders.slice(0, 20).map((po) => (
              <div key={po.poNumber} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-md text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono-data font-semibold text-xs">{po.poNumber}</span>
                  <span className="text-muted-foreground">{po.supplier}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{po.lines.length} items</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    po.status === "received" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : po.status === "partial" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {po.status}
                  </span>
                  <span className="font-mono-data text-xs">{fmt(po.lines.reduce((s, l) => s + l.totalCost, 0))}</span>
                </div>
              </div>
            ))}
            {purchaseOrders.length > 20 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                + {purchaseOrders.length - 20} more purchase orders
              </p>
            )}
          </div>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setStep("suppliers")}>
            <Users className="w-4 h-4 mr-2" /> Review Suppliers
          </Button>
          <Button className="flex-1" onClick={handleImport}>
            <Check className="w-4 h-4 mr-2" /> Import All Data
          </Button>
        </div>
      </div>
    );
  }

  /* ─── Suppliers Step ─── */
  if (step === "suppliers") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => purchaseOrders.length > 0 ? setStep("review") : setStep("upload")} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold font-display">Suppliers</h2>
            <p className="text-xs text-muted-foreground">
              {purchaseOrders.length > 0
                ? "Review auto-detected suppliers or add missing ones"
                : "Add your suppliers manually — Stocky doesn't export supplier data separately"}
            </p>
          </div>
        </div>

        <Card className="p-4 mb-4">
          {suppliers.length > 0 ? (
            <div className="space-y-3">
              {suppliers.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-2 px-3 bg-muted/30 rounded-md">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.poCount} POs • {fmt(s.totalSpend)} spend • {s.avgLeadTime}d lead time
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="180"
                      value={s.avgLeadTime}
                      onChange={(e) => updateSupplierLeadTime(s.id, parseInt(e.target.value) || 14)}
                      className="w-16 h-7 text-xs text-center"
                      title="Lead time (days)"
                    />
                    <span className="text-[10px] text-muted-foreground">days</span>
                    <button onClick={() => removeSupplier(s.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No suppliers yet. Add your first supplier below.
            </p>
          )}
        </Card>

        {/* Add manual supplier */}
        {addingManual ? (
          <Card className="p-4 mb-4">
            <div className="flex gap-2">
              <Input
                placeholder="Supplier name, e.g. 'Seafolly'"
                value={manualSupplierName}
                onChange={(e) => setManualSupplierName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManualSupplier()}
                className="h-9"
                autoFocus
              />
              <Button onClick={addManualSupplier} size="sm" className="h-9"><Check className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setAddingManual(false); setManualSupplierName(""); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="outline" className="w-full mb-4" onClick={() => setAddingManual(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add supplier manually
          </Button>
        )}

        <Button className="w-full" onClick={handleImport} disabled={suppliers.length === 0}>
          <Check className="w-4 h-4 mr-2" /> {purchaseOrders.length > 0 ? "Import All Data" : "Save Suppliers"}
        </Button>
      </div>
    );
  }

  /* ─── Complete Step ─── */
  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Migration Complete</h2>
      </div>

      <Card className="p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-lg font-semibold">Everything imported!</h3>
        <p className="text-sm text-muted-foreground">
          Your Stocky data has been migrated to Sonic Invoice. All features are ready to use.
        </p>

        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-2xl font-bold font-mono-data text-primary">{summary.purchaseOrders}</p>
            <p className="text-xs text-muted-foreground">Purchase Orders</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-2xl font-bold font-mono-data text-primary">{summary.suppliers}</p>
            <p className="text-xs text-muted-foreground">Suppliers</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-2xl font-bold font-mono-data text-primary">{summary.products}</p>
            <p className="text-xs text-muted-foreground">Products with Cost</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-2xl font-bold font-mono-data text-primary">{fmt(summary.totalSpend)}</p>
            <p className="text-xs text-muted-foreground">Total Spend</p>
          </div>
        </div>

        <div className="space-y-2 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What's next?</p>
          <div className="grid grid-cols-1 gap-2 text-left">
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-green-500 shrink-0" />
              <span>Purchase orders imported with full line items</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-green-500 shrink-0" />
              <span>Supplier profiles created with lead times</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-green-500 shrink-0" />
              <span>Cost history mapped to SKUs for margin tracking</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <span>Connect Shopify store for live inventory syncing</span>
            </div>
          </div>
        </div>

        <Button className="w-full" onClick={() => { if (onComplete) onComplete(); else onBack(); }}>
          Go to Inventory Dashboard <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </Card>
    </div>
  );
}
