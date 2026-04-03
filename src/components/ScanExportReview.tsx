import { useState } from "react";
import { ChevronLeft, Download, Edit2, Trash2, Check, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getStoreConfig } from "@/lib/prompt-builder";
import { validateForExport, generateShopifyCSV, inferCategory, type ScannedProductForExport } from "@/lib/shopify-csv-schema";

interface ExportProduct {
  id: string;
  title: string;
  type: string;
  vendor: string;
  description: string;
  tags: string;
  colour: string;
  sku: string;
  barcode: string;
  price: number;
  quantity: number;
  confidence: number;
  matchSource: string;
}

interface ScanExportReviewProps {
  products: ExportProduct[];
  onBack: () => void;
  onUpdateProduct: (idx: number, field: string, value: string | number) => void;
  onRemoveProduct: (idx: number) => void;
}

const ScanExportReview = ({ products, onBack, onUpdateProduct, onRemoveProduct }: ScanExportReviewProps) => {
  const config = getStoreConfig();
  const sym = config.currencySymbol || "$";
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const validations = products.map(p => validateForExport(p));
  const readyCount = validations.filter(v => v.valid).length;
  const needsFixCount = validations.filter(v => !v.valid).length;
  const allReady = needsFixCount === 0 && products.length > 0;

  const handleExport = () => {
    if (!allReady) {
      toast.error(`${needsFixCount} item${needsFixCount > 1 ? "s" : ""} need fixing before export`);
      return;
    }
    const exportData: ScannedProductForExport[] = products.map(p => ({
      title: p.title, type: p.type, vendor: p.vendor, description: p.description,
      tags: p.tags, colour: p.colour, sku: p.sku, barcode: p.barcode,
      price: p.price, quantity: p.quantity,
    }));
    const csv = generateShopifyCSV(exportData);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scan-mode-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${products.length} products to Shopify CSV`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground text-sm">Export Review</h2>
          <p className="text-xs text-muted-foreground">Check products before Shopify CSV export</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="flex gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex-1 rounded-lg bg-success/10 p-2.5 text-center">
          <p className="text-lg font-bold text-success">{readyCount}</p>
          <p className="text-[10px] text-success font-medium">Ready</p>
        </div>
        <div className="flex-1 rounded-lg bg-destructive/10 p-2.5 text-center">
          <p className="text-lg font-bold text-destructive">{needsFixCount}</p>
          <p className="text-[10px] text-destructive font-medium">Needs Fixing</p>
        </div>
        <div className="flex-1 rounded-lg bg-muted p-2.5 text-center">
          <p className="text-lg font-bold text-foreground">{products.length}</p>
          <p className="text-[10px] text-muted-foreground font-medium">Total</p>
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {products.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No products to export</div>
        )}
        {products.map((p, i) => {
          const v = validations[i];
          const category = inferCategory(p.type);

          if (editIdx === i) {
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Title *</label>
                  <input value={p.title} onChange={e => onUpdateProduct(i, "title", e.target.value)}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Type *</label>
                    <input value={p.type} onChange={e => onUpdateProduct(i, "type", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Vendor</label>
                    <input value={p.vendor} onChange={e => onUpdateProduct(i, "vendor", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">SKU</label>
                    <input value={p.sku} onChange={e => onUpdateProduct(i, "sku", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm font-mono text-foreground" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Barcode</label>
                    <input value={p.barcode} onChange={e => onUpdateProduct(i, "barcode", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm font-mono text-foreground" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Price ({sym}) *</label>
                    <input type="number" value={p.price} onChange={e => onUpdateProduct(i, "price", parseFloat(e.target.value) || 0)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Quantity *</label>
                    <input type="number" value={p.quantity} onChange={e => onUpdateProduct(i, "quantity", parseInt(e.target.value) || 0)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  </div>
                </div>
                <Button size="sm" className="w-full" onClick={() => setEditIdx(null)}>
                  <Check className="w-4 h-4 mr-1" /> Done
                </Button>
              </div>
            );
          }

          return (
            <div key={p.id} className={`rounded-xl border bg-card overflow-hidden ${v.valid ? "border-border" : "border-destructive/40"}`}>
              <div className="flex items-start gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground truncate">{p.title}</p>
                    {v.valid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/15 text-success">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/15 text-destructive">
                        <AlertTriangle className="w-2.5 h-2.5" /> Fix
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.type}{category ? ` · ${category}` : ""}{p.vendor ? ` · ${p.vendor}` : ""}
                  </p>
                  {(p.sku || p.barcode) && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {p.sku && `SKU: ${p.sku}`}{p.sku && p.barcode ? " · " : ""}{p.barcode && `BC: ${p.barcode}`}
                    </p>
                  )}
                  <p className="text-xs text-foreground mt-0.5">{sym}{p.price.toFixed(2)} · Qty: {p.quantity}</p>
                  {!v.valid && (
                    <div className="mt-1.5 space-y-0.5">
                      {v.issues.map((issue, j) => (
                        <p key={j} className="text-[10px] text-destructive">⚠ {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => setEditIdx(i)} className="p-1.5 rounded-md hover:bg-muted">
                    <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={() => onRemoveProduct(i)} className="p-1.5 rounded-md hover:bg-muted">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
        <Button className="w-full h-12 text-base font-semibold" onClick={handleExport} disabled={!allReady || products.length === 0}>
          <Download className="w-5 h-5 mr-2" />
          Export Shopify CSV ({readyCount} product{readyCount !== 1 ? "s" : ""})
        </Button>
        {!allReady && products.length > 0 && (
          <p className="text-center text-[10px] text-destructive">
            Fix {needsFixCount} item{needsFixCount > 1 ? "s" : ""} before exporting
          </p>
        )}
      </div>
    </div>
  );
};

export default ScanExportReview;
