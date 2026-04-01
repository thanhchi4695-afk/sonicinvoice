import { useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, FileText, Package, BarChart3, Clock, Star, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCostHistory } from "@/components/InvoiceFlow";

interface SupplierPanelProps {
  onBack: () => void;
  onStartInvoice: () => void;
}

interface SupplierSummary {
  name: string;
  invoiceCount: number;
  productCount: number;
  lastInvoiceDate: string;
  matchRate: number;
  trend: "up" | "down" | "stable";
  products: { name: string; timesOrdered: number; totalUnits: number; lastOrdered: string }[];
  invoices: { date: string; lines: number; matched: number; manual: number; notFound: number }[];
}

// Build supplier data from localStorage history + cost history
function buildSupplierData(): SupplierSummary[] {
  const processingHistory: { supplier: string; lines: number; processingTime: number; matchRate: number; date: string }[] = (() => {
    try { return JSON.parse(localStorage.getItem("processing_history") || "[]"); } catch { return []; }
  })();

  const costHistory = getCostHistory();

  // Seed demo data if history is sparse
  const suppliers: Record<string, SupplierSummary> = {};

  // From processing history
  for (const entry of processingHistory) {
    const name = entry.supplier || "Unknown";
    if (!suppliers[name]) {
      suppliers[name] = { name, invoiceCount: 0, productCount: 0, lastInvoiceDate: "", matchRate: 0, trend: "stable", products: [], invoices: [] };
    }
    suppliers[name].invoiceCount++;
    suppliers[name].productCount += entry.lines || 0;
    if (!suppliers[name].lastInvoiceDate || entry.date > suppliers[name].lastInvoiceDate) {
      suppliers[name].lastInvoiceDate = entry.date;
    }
    suppliers[name].matchRate = entry.matchRate || 94;
    const matched = Math.round((entry.matchRate || 94) / 100 * (entry.lines || 4));
    suppliers[name].invoices.push({
      date: entry.date,
      lines: entry.lines || 4,
      matched,
      manual: Math.max(0, (entry.lines || 4) - matched - 1),
      notFound: 1,
    });
  }

  // From cost history — extract supplier names
  for (const [sku, entries] of Object.entries(costHistory)) {
    for (const e of entries) {
      const name = e.supplier;
      if (!suppliers[name]) {
        suppliers[name] = { name, invoiceCount: 0, productCount: 0, lastInvoiceDate: "", matchRate: 0, trend: "stable", products: [], invoices: [] };
      }
    }
  }

  // Always show demo suppliers if nothing built
  const demos: SupplierSummary[] = [
    {
      name: "Jantzen", invoiceCount: 12, productCount: 247, lastInvoiceDate: "2026-03-28", matchRate: 94, trend: "up",
      products: [
        { name: "Mood Bandeau Blouson Singlet", timesOrdered: 8, totalUnits: 96, lastOrdered: "2026-03-28" },
        { name: "Retro Racerback One Piece", timesOrdered: 6, totalUnits: 72, lastOrdered: "2026-03-28" },
        { name: "Sahara Kaftan", timesOrdered: 5, totalUnits: 40, lastOrdered: "2026-02-10" },
        { name: "Seashells Sarong", timesOrdered: 4, totalUnits: 48, lastOrdered: "2026-01-15" },
        { name: "Classic Bikini Bottom", timesOrdered: 3, totalUnits: 36, lastOrdered: "2026-03-28" },
      ],
      invoices: [
        { date: "2026-03-28", lines: 18, matched: 17, manual: 1, notFound: 0 },
        { date: "2026-02-10", lines: 14, matched: 13, manual: 1, notFound: 0 },
        { date: "2026-01-15", lines: 22, matched: 20, manual: 1, notFound: 1 },
        { date: "2025-12-01", lines: 16, matched: 15, manual: 1, notFound: 0 },
      ],
    },
    {
      name: "Seafolly", invoiceCount: 8, productCount: 186, lastInvoiceDate: "2026-02-15", matchRate: 91, trend: "stable",
      products: [
        { name: "Collective Bikini Top", timesOrdered: 6, totalUnits: 72, lastOrdered: "2026-02-15" },
        { name: "Classic One Piece", timesOrdered: 5, totalUnits: 60, lastOrdered: "2026-02-15" },
        { name: "Beach Basics Sarong", timesOrdered: 4, totalUnits: 32, lastOrdered: "2025-11-20" },
      ],
      invoices: [
        { date: "2026-02-15", lines: 24, matched: 22, manual: 1, notFound: 1 },
        { date: "2025-11-20", lines: 18, matched: 16, manual: 1, notFound: 1 },
      ],
    },
    {
      name: "Bond Eye", invoiceCount: 5, productCount: 62, lastInvoiceDate: "2026-01-15", matchRate: 96, trend: "up",
      products: [
        { name: "Mara One Piece", timesOrdered: 4, totalUnits: 48, lastOrdered: "2026-01-15" },
        { name: "Lissio Bikini Top", timesOrdered: 3, totalUnits: 24, lastOrdered: "2026-01-15" },
      ],
      invoices: [
        { date: "2026-01-15", lines: 12, matched: 12, manual: 0, notFound: 0 },
        { date: "2025-10-05", lines: 10, matched: 9, manual: 1, notFound: 0 },
      ],
    },
    {
      name: "Baku", invoiceCount: 6, productCount: 94, lastInvoiceDate: "2026-03-28", matchRate: 88, trend: "down",
      products: [
        { name: "Riviera High Waist Pant", timesOrdered: 4, totalUnits: 32, lastOrdered: "2026-03-28" },
        { name: "Paradise Bandeau", timesOrdered: 3, totalUnits: 24, lastOrdered: "2026-01-20" },
      ],
      invoices: [
        { date: "2026-03-28", lines: 14, matched: 12, manual: 1, notFound: 1 },
        { date: "2026-01-20", lines: 10, matched: 9, manual: 1, notFound: 0 },
      ],
    },
  ];

  // Merge demos with real data
  for (const demo of demos) {
    if (!suppliers[demo.name]) {
      suppliers[demo.name] = demo;
    } else {
      const s = suppliers[demo.name];
      if (s.invoiceCount < demo.invoiceCount) s.invoiceCount = demo.invoiceCount;
      if (s.productCount < demo.productCount) s.productCount = demo.productCount;
      if (s.products.length === 0) s.products = demo.products;
      if (s.invoices.length < demo.invoices.length) s.invoices = demo.invoices;
      if (!s.lastInvoiceDate) s.lastInvoiceDate = demo.lastInvoiceDate;
      s.matchRate = s.matchRate || demo.matchRate;
      s.trend = demo.trend;
    }
  }

  return Object.values(suppliers).sort((a, b) => b.invoiceCount - a.invoiceCount);
}

const SupplierPanel = ({ onBack, onStartInvoice }: SupplierPanelProps) => {
  const [suppliers] = useState<SupplierSummary[]>(buildSupplierData);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("supplier_notes") || "{}"); } catch { return {}; }
  });

  const saveNote = (supplier: string, text: string) => {
    const updated = { ...notes, [supplier]: text };
    setNotes(updated);
    localStorage.setItem("supplier_notes", JSON.stringify(updated));
  };

  const detail = suppliers.find(s => s.name === selectedSupplier);
  const costHistory = getCostHistory();

  // Get price history for a supplier's products
  const getPriceHistory = (supplierName: string) => {
    const results: { product: string; history: { date: string; cost: number; invoice: string }[] }[] = [];
    for (const [sku, entries] of Object.entries(costHistory)) {
      const supplierEntries = entries.filter(e => e.supplier === supplierName);
      if (supplierEntries.length > 0) {
        results.push({ product: sku, history: supplierEntries.map(e => ({ date: e.date, cost: e.cost, invoice: e.invoice })) });
      }
    }
    return results;
  };

  if (detail) {
    const priceHistory = getPriceHistory(detail.name);
    return (
      <div className="min-h-screen pb-24 animate-fade-in">
        <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedSupplier(null)} className="text-muted-foreground">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold font-display">{detail.name}</h2>
          </div>
        </div>

        <div className="px-4 pt-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Total invoices", value: detail.invoiceCount, icon: FileText },
              { label: "Products imported", value: detail.productCount, icon: Package },
              { label: "Avg match rate", value: `${detail.matchRate}%`, icon: BarChart3 },
              { label: "Last delivery", value: new Date(detail.lastInvoiceDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }), icon: Clock },
            ].map((s, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{s.label}</span>
                </div>
                <p className="text-lg font-bold font-display">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Invoice history */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Invoice history</h3>
            <div className="space-y-1.5">
              {detail.invoices.map((inv, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-2">
                  <span className="font-medium">{new Date(inv.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" })}</span>
                  <span className="text-muted-foreground">{inv.lines} lines</span>
                  <span className="text-success">{inv.matched} matched</span>
                  <span className="text-warning">{inv.manual} manual</span>
                  <span className="text-destructive">{inv.notFound} missing</span>
                </div>
              ))}
            </div>
          </div>

          {/* Most ordered products */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Most ordered products</h3>
            <div className="space-y-1.5">
              {detail.products.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-2">
                  <span className="font-medium flex-1 truncate mr-2">{p.name}</span>
                  <span className="text-muted-foreground shrink-0">{p.timesOrdered}× · {p.totalUnits} units</span>
                </div>
              ))}
            </div>
          </div>

          {/* Price history */}
          {priceHistory.length > 0 && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold mb-3">Cost history</h3>
              <div className="space-y-2">
                {priceHistory.map((ph, i) => (
                  <div key={i} className="text-xs">
                    <p className="font-medium mb-1">{ph.product}</p>
                    <div className="flex flex-wrap gap-2">
                      {ph.history.map((h, j) => {
                        const prev = j > 0 ? ph.history[j - 1].cost : null;
                        const change = prev ? ((h.cost - prev) / prev * 100) : null;
                        return (
                          <span key={j} className="px-2 py-1 rounded bg-muted/50 font-mono-data">
                            {new Date(h.date).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })}: ${h.cost.toFixed(2)}
                            {change !== null && (
                              <span className={`ml-1 ${change > 0 ? "text-warning" : change < 0 ? "text-success" : ""}`}>
                                ({change > 0 ? "+" : ""}{change.toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-2">Notes</h3>
            <textarea
              value={notes[detail.name] || ""}
              onChange={e => saveNote(detail.name, e.target.value)}
              placeholder={`Notes about ${detail.name}...`}
              rows={3}
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold font-display">📊 Suppliers</h2>
        </div>
      </div>

      <div className="px-4 pt-4">
        {suppliers.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">No supplier data yet.</p>
            <p className="text-xs text-muted-foreground mb-4">Process your first invoice and supplier stats will appear here automatically.</p>
            <Button onClick={onStartInvoice}>→ Upload first invoice</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {suppliers.map(s => (
              <button
                key={s.name}
                onClick={() => setSelectedSupplier(s.name)}
                className="w-full bg-card rounded-lg border border-border p-4 text-left active:bg-muted transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">{s.name}</p>
                      {s.trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-success" />}
                      {s.trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
                      {s.trend === "stable" && <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                      <span>{s.invoiceCount} invoices</span>
                      <span>{s.productCount} products</span>
                      <span>{s.matchRate}% matched</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Last: {new Date(s.lastInvoiceDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" })}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierPanel;
