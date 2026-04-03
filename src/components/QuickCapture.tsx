import { useState, useRef } from "react";
import { Camera, Upload, ChevronLeft, ChevronRight, Check, X, Download, RotateCcw, FileText, Edit2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStoreConfig } from "@/lib/prompt-builder";
import { useStoreMode } from "@/hooks/use-store-mode";

type QCStep = "capture" | "processing" | "review" | "done";

interface QCProduct {
  name: string;
  brand: string;
  type: string;
  sizes: string;
  qty: number;
  cost: number;
  rrp: number;
  status: "ready" | "review";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const now = new Date();
const currentMonth = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

const QuickCapture = ({ onClose }: { onClose: () => void }) => {
  const config = getStoreConfig();
  const mode = useStoreMode();
  const sym = config.currencySymbol || "$";
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<QCStep>("capture");
  const [supplier, setSupplier] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [preview, setPreview] = useState<string | null>(null);
  const [products, setProducts] = useState<QCProduct[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const processInvoice = () => {
    setStep("processing");
    // Simulated processing
    setTimeout(() => {
      setProducts([
        { name: "Mood Bandeau Blouson Singlet", brand: supplier || "Jantzen", type: "Bikini Tops", sizes: "8,10,12,14", qty: 10, cost: 63.65, rrp: 149.95, status: "ready" },
        { name: "Sahara Kaftan", brand: supplier || "Jantzen", type: "Clothing", sizes: "S,M,L,XL", qty: 8, cost: 38.00, rrp: 89.95, status: "ready" },
        { name: "Retro Racerback One Piece", brand: supplier || "Jantzen", type: "One Piece", sizes: "8,10,12,14,16", qty: 12, cost: 65.00, rrp: 159.95, status: "review" },
        { name: "Classic Bikini Top", brand: supplier || "Jantzen", type: "Bikini Tops", sizes: "8,10,12", qty: 6, cost: 42.00, rrp: 99.95, status: "ready" },
      ]);
      setStep("review");
    }, 2500);
  };

  const totalProducts = products.reduce((s, p) => s + p.qty, 0);
  const readyCount = products.filter(p => p.status === "ready").length;

  const handleExport = () => {
    // Simulated CSV download
    const rows = [["Handle", "Title", "Vendor", "Type", "Variant Price", "Variant Compare At Price"]];
    products.forEach(p => {
      rows.push([p.name.toLowerCase().replace(/\s/g, "-"), p.name, p.brand, p.type, p.cost.toString(), p.rrp.toString()]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(supplier || "invoice").toLowerCase()}_${month.replace(" ", "_")}.csv`;
    a.click();
    setStep("done");
  };

  const removeProduct = (idx: number) => setProducts(products.filter((_, i) => i !== idx));

  // ── Processing screen ─────────────────────────────────
  if (step === "processing") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mb-6" />
        <h2 className="text-lg font-bold text-foreground mb-2">Processing invoice…</h2>
        <p className="text-sm text-muted-foreground text-center">AI is reading your {supplier || "supplier"} invoice</p>
      </div>
    );
  }

  // ── Done screen ───────────────────────────────────────
  if (step === "done") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mb-6">
          <Check className="w-8 h-8 text-success" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Done!</h2>
        <p className="text-sm text-muted-foreground mb-1">{products.length} products exported</p>
        <p className="text-xs text-muted-foreground mb-8">
          {mode.isLightspeed ? "Import into Lightspeed POS" : "Import into Shopify"}
        </p>
        <div className="w-full max-w-xs space-y-3">
          <Button className="w-full h-12 text-base" onClick={handleExport}>
            <Download className="w-5 h-5 mr-2" /> Download CSV
          </Button>
          <Button variant="outline" className="w-full h-12 text-base" onClick={() => { setStep("capture"); setPreview(null); setProducts([]); }}>
            <RotateCcw className="w-5 h-5 mr-2" /> Process another
          </Button>
          <Button variant="ghost" className="w-full h-12" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  // ── Review screen ─────────────────────────────────────
  if (step === "review") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
          <button onClick={() => setStep("capture")}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm text-foreground">{supplier || "Invoice"} — {month}</h2>
            <p className="text-xs text-muted-foreground">{products.length} products · {totalProducts} units</p>
          </div>
          <span className="text-xs text-success font-medium">{readyCount}/{products.length} ready</span>
        </div>

        {/* Product cards */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {products.map((p, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="w-full text-left px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.brand} · {p.type}</p>
                    <p className="text-xs text-muted-foreground">Sizes: {p.sizes} · Qty: {p.qty}</p>
                    <p className="text-xs text-foreground mt-0.5">Cost: {sym}{p.cost.toFixed(2)} · RRP: {sym}{p.rrp.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${p.status === "ready" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {p.status === "ready" ? "✓ Ready" : "⚠ Review"}
                    </span>
                  </div>
                </div>
              </button>
              {expandedIdx === i && (
                <div className="px-4 pb-4 pt-2 border-t border-border space-y-3">
                  <input value={p.name} onChange={e => { const u = [...products]; u[i] = { ...u[i], name: e.target.value }; setProducts(u); }}
                    className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  <input value={p.brand} onChange={e => { const u = [...products]; u[i] = { ...u[i], brand: e.target.value }; setProducts(u); }}
                    className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Brand" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Cost</label>
                      <input type="number" value={p.cost} onChange={e => { const u = [...products]; u[i] = { ...u[i], cost: parseFloat(e.target.value) || 0 }; setProducts(u); }}
                        className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">RRP</label>
                      <input type="number" value={p.rrp} onChange={e => { const u = [...products]; u[i] = { ...u[i], rrp: parseFloat(e.target.value) || 0 }; setProducts(u); }}
                        className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-10 flex-1" onClick={() => { const u = [...products]; u[i] = { ...u[i], status: "ready" }; setProducts(u); setExpandedIdx(null); }}>
                      <Check className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button variant="ghost" size="sm" className="h-10 text-destructive" onClick={() => removeProduct(i)}>
                      <X className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom action */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
          <Button className="w-full h-12 text-base font-semibold" onClick={handleExport}>
            📤 Export — {products.length} products ready
          </Button>
        </div>
      </div>
    );
  }

  // ── Capture screen (default) ──────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onClose}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
        <h2 className="font-semibold text-foreground">📱 Quick Capture</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-sm text-muted-foreground">Take a photo of your invoice or packing slip</p>

        {/* Camera/upload zone */}
        <div className="relative rounded-2xl border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center min-h-[280px] overflow-hidden"
          onClick={() => fileRef.current?.click()}>
          {preview ? (
            <img src={preview} alt="Invoice preview" className="w-full h-full object-contain max-h-[320px]" />
          ) : (
            <>
              <Camera className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">Tap to capture</p>
              <p className="text-xs text-muted-foreground mt-1">or choose from gallery</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.xlsx,.xls,.csv" capture="environment"
            onChange={handleCapture} className="hidden" />
        </div>

        {preview && (
          <Button variant="ghost" size="sm" onClick={() => { setPreview(null); }} className="w-full">
            <RotateCcw className="w-4 h-4 mr-1" /> Retake photo
          </Button>
        )}

        {/* Supplier */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Supplier</label>
          <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Jantzen, Seafolly"
            className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground" />
        </div>

        {/* Month */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground">
            {MONTHS.map((m, i) => {
              const yr = i <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
              return <option key={m} value={`${m} ${yr}`}>{m} {yr}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Bottom action */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background safe-bottom">
        <Button className="w-full h-12 text-base font-semibold" onClick={processInvoice} disabled={!preview && !supplier}>
          Process invoice <ChevronRight className="w-5 h-5 ml-1" />
        </Button>
      </div>
    </div>
  );
};

export default QuickCapture;
