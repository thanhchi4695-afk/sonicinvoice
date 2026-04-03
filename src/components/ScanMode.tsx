import { useState, useRef, useCallback } from "react";
import { Camera, Type, ChevronLeft, ChevronRight, Plus, Trash2, Copy, Edit2, Check, Download, Zap, Package, ScanBarcode, RotateCcw, Eye, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { useStoreMode } from "@/hooks/use-store-mode";
import { toast } from "sonner";

interface ScannedProduct {
  id: string;
  title: string;
  type: string;
  vendor: string;
  description: string;
  tags: string;
  colour: string;
  price: number;
  quantity: number;
  confidence: number;
  confidenceReason: string;
  imageUrl: string | null;
}

type InputMode = "camera" | "text" | "barcode";

const ConfidenceBadgeInline = ({ score }: { score: number }) => {
  const level = score >= 90 ? "high" : score >= 70 ? "medium" : "low";
  const colors = {
    high: "bg-success/15 text-success",
    medium: "bg-warning/15 text-warning",
    low: "bg-destructive/15 text-destructive",
  };
  const labels = { high: "High", medium: "Review", low: "Low" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[level]}`}>
      {score}% · {labels[level]}
    </span>
  );
};

const PROGRESS_MESSAGES = [
  "Analyzing item…",
  "Identifying product…",
  "Generating draft…",
];

const ScanMode = ({ onBack }: { onBack: () => void }) => {
  const config = getStoreConfig();
  const mode = useStoreMode();
  const sym = config.currencySymbol || "$";
  const fileRef = useRef<HTMLInputElement>(null);

  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [textInput, setTextInput] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [draft, setDraft] = useState<{
    title: string; type: string; description: string; tags: string[];
    colour: string; pattern: string; confidence: number; confidenceReason: string;
  } | null>(null);
  const [products, setProducts] = useState<ScannedProduct[]>([]);
  const [showList, setShowList] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const resetInput = useCallback(() => {
    setTextInput("");
    setPrice("");
    setQuantity("1");
    setPreview(null);
    setDraft(null);
    setProgressIdx(0);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const animateProgress = () => {
    let idx = 0;
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, PROGRESS_MESSAGES.length - 1);
      setProgressIdx(idx);
    }, 1200);
    return () => clearInterval(interval);
  };

  const callAI = async (input: string, aiMode: "text" | "image") => {
    setGenerating(true);
    setProgressIdx(0);
    const stopAnim = animateProgress();
    try {
      const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
        body: { input, mode: aiMode, storeName: config.name, storeCity: config.city },
      });
      if (error) throw error;
      setDraft({
        title: data.product_title || "Product",
        type: data.product_type || "General",
        description: data.short_description || "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        colour: data.colour || "",
        pattern: data.pattern || "",
        confidence: data.confidence_score ?? 50,
        confidenceReason: data.confidence_reason || "",
      });
    } catch (e: any) {
      console.error("AI error:", e);
      toast.error(e?.message || "AI generation failed");
      setDraft({
        title: textInput || "Product",
        type: "General",
        description: "",
        tags: [],
        colour: "",
        pattern: "",
        confidence: 20,
        confidenceReason: "AI call failed — manual entry required",
      });
    } finally {
      stopAnim();
      setGenerating(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    const base64 = await fileToBase64(file);
    callAI(base64, "image");
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    callAI(textInput.trim(), "text");
  };

  const saveAndNext = () => {
    if (!draft || !price) {
      toast.error("Price is required");
      return;
    }
    const item: ScannedProduct = {
      id: crypto.randomUUID(),
      title: draft.title,
      type: draft.type,
      vendor: "",
      description: draft.description,
      tags: draft.tags.join(", "),
      colour: draft.colour,
      price: parseFloat(price) || 0,
      quantity: parseInt(quantity) || 1,
      confidence: draft.confidence,
      confidenceReason: draft.confidenceReason,
      imageUrl: preview,
    };
    setProducts(prev => [...prev, item]);
    resetInput();
    toast.success(`Added "${item.title}"`, { duration: 1500 });
  };

  const removeProduct = (idx: number) => setProducts(p => p.filter((_, i) => i !== idx));
  const duplicateProduct = (idx: number) => {
    const p = { ...products[idx], id: crypto.randomUUID() };
    setProducts(prev => [...prev.slice(0, idx + 1), p, ...prev.slice(idx + 1)]);
  };
  const updateProduct = (idx: number, field: keyof ScannedProduct, value: string | number) => {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const exportCSV = () => {
    const headers = ["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Variant SKU", "Variant Price", "Variant Inventory Qty", "Status"];
    const rows = products.map(p => [
      p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
      p.title, p.description, p.vendor, p.type, p.tags, "TRUE",
      "Title", "Default Title", "", p.price.toFixed(2), p.quantity.toString(), "active",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scan-mode-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`Exported ${products.length} products`);
  };

  // ── Session list ──
  if (showList) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <button onClick={() => setShowList(false)}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground text-sm">Scanned Products</h2>
            <p className="text-xs text-muted-foreground">{products.length} items · {products.reduce((s, p) => s + p.quantity, 0)} units</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {products.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No products yet. Start scanning!</div>
          )}
          {products.map((p, i) => (
            <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
              {editIdx === i ? (
                <div className="p-3 space-y-2">
                  <input value={p.title} onChange={e => updateProduct(i, "title", e.target.value)}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={p.type} onChange={e => updateProduct(i, "type", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Type" />
                    <input value={p.vendor} onChange={e => updateProduct(i, "vendor", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Vendor" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={p.price} onChange={e => updateProduct(i, "price", parseFloat(e.target.value) || 0)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                    <input type="number" value={p.quantity} onChange={e => updateProduct(i, "quantity", parseInt(e.target.value) || 1)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                  </div>
                  <Button size="sm" className="w-full" onClick={() => setEditIdx(null)}>
                    <Check className="w-4 h-4 mr-1" /> Done
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3">
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-foreground truncate">{p.title}</p>
                      <ConfidenceBadgeInline score={p.confidence} />
                    </div>
                    <p className="text-xs text-muted-foreground">{p.type}{p.colour ? ` · ${p.colour}` : ""}</p>
                    <p className="text-xs text-foreground mt-0.5">{sym}{p.price.toFixed(2)} · Qty: {p.quantity}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => setEditIdx(i)} className="p-1.5 rounded-md hover:bg-muted"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    <button onClick={() => duplicateProduct(i)} className="p-1.5 rounded-md hover:bg-muted"><Copy className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    <button onClick={() => removeProduct(i)} className="p-1.5 rounded-md hover:bg-muted"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
          <Button className="w-full h-12 text-base font-semibold" onClick={exportCSV} disabled={products.length === 0}>
            <Download className="w-5 h-5 mr-2" /> Export {mode.isLightspeed ? "Lightspeed" : "Shopify"} CSV
          </Button>
          <Button variant="outline" className="w-full h-10" onClick={() => setShowList(false)}>
            <Plus className="w-4 h-4 mr-1" /> Add more items
          </Button>
        </div>
      </div>
    );
  }

  // ── Main scan screen ──
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-primary" /> Scan Mode (AI Vision)
          </h2>
        </div>
        {products.length > 0 && (
          <button onClick={() => setShowList(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-medium">
            <Package className="w-3.5 h-3.5" /> {products.length}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Input mode tabs */}
        <div className="flex gap-2">
          {([
            { m: "camera" as InputMode, icon: Camera, label: "Photo" },
            { m: "text" as InputMode, icon: Type, label: "Text" },
            { m: "barcode" as InputMode, icon: ScanBarcode, label: "Barcode" },
          ]).map(t => (
            <button key={t.m} onClick={() => { setInputMode(t.m); resetInput(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${inputMode === t.m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Camera input — default */}
        {inputMode === "camera" && !draft && !generating && (
          <div className="rounded-2xl border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center min-h-[240px] cursor-pointer"
            onClick={() => fileRef.current?.click()}>
            {preview ? (
              <img src={preview} alt="Product" className="w-full h-full object-contain max-h-[280px] rounded-xl" />
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Camera className="w-8 h-8 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">Take a product photo</p>
                <p className="text-xs text-muted-foreground mt-1">AI will identify it instantly</p>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />
          </div>
        )}

        {/* Text input */}
        {inputMode === "text" && !draft && !generating && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Describe the product</label>
            <div className="flex gap-2">
              <input value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                placeholder="e.g. blue floral midi dress"
                className="flex-1 h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground" autoFocus />
              <Button className="h-12 px-4" onClick={handleTextSubmit} disabled={!textInput.trim() || generating}>
                <Zap className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Barcode input */}
        {inputMode === "barcode" && !draft && !generating && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Enter barcode / SKU</label>
            <div className="flex gap-2">
              <input value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                placeholder="e.g. 9312345678901"
                className="flex-1 h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground font-mono" autoFocus />
              <Button className="h-12 px-4" onClick={handleTextSubmit} disabled={!textInput.trim()}>
                <Zap className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Processing animation */}
        {generating && (
          <div className="rounded-xl bg-primary/5 border border-primary/10 p-5">
            {preview && (
              <img src={preview} alt="" className="w-full max-h-[180px] object-contain rounded-lg mb-4 opacity-80" />
            )}
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 shrink-0">
                <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-primary/15">
                  <Zap className="w-5 h-5 text-primary animate-pulse" fill="currentColor" />
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{PROGRESS_MESSAGES[progressIdx]}</p>
                <p className="text-xs text-muted-foreground mt-0.5">AI Vision is processing your image</p>
              </div>
            </div>
            <div className="mt-3 w-full h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/40 animate-loading-bar" />
            </div>
          </div>
        )}

        {/* Generated draft card */}
        {draft && !generating && (
          <div className="space-y-3">
            {/* Image thumbnail + confidence */}
            <div className="flex gap-3">
              {preview && (
                <img src={preview} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0 border border-border" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <ConfidenceBadgeInline score={draft.confidence} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{draft.confidenceReason}</p>
                {draft.confidence < 70 && (
                  <div className="flex items-center gap-1 mt-1.5 text-destructive">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="text-[10px] font-medium">Low confidence — please review</span>
                  </div>
                )}
              </div>
            </div>

            {/* Editable fields */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground">Product title</label>
                <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
                  className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm font-medium text-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Product type</label>
                  <input value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Colour</label>
                  <input value={draft.colour} onChange={e => setDraft({ ...draft, colour: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                </div>
              </div>
              {draft.description && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Description</label>
                  <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
                    className="w-full rounded-lg bg-input border border-border px-3 py-2 text-xs text-foreground min-h-[56px] resize-none" />
                </div>
              )}
              {draft.tags.length > 0 && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Tags</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {draft.tags.map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Price & Quantity */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                <div>
                  <label className="text-[10px] text-muted-foreground">Price ({sym}) *</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00"
                    className="w-full h-11 rounded-lg bg-background border border-border px-3 text-base font-semibold text-foreground" autoFocus />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Quantity *</label>
                  <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1"
                    className="w-full h-11 rounded-lg bg-background border border-border px-3 text-base font-semibold text-foreground" />
                </div>
              </div>
            </div>

            {/* Retake */}
            <Button variant="ghost" size="sm" className="w-full" onClick={resetInput}>
              <RotateCcw className="w-4 h-4 mr-1" /> Retake / Start over
            </Button>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
        {draft && !generating ? (
          <Button className="w-full h-12 text-base font-semibold" onClick={saveAndNext} disabled={!price}>
            <Check className="w-5 h-5 mr-2" /> Save & Next
          </Button>
        ) : !generating ? (
          <div className="text-center text-xs text-muted-foreground py-2">
            {inputMode === "camera" ? "Take a photo to get started" : "Enter product info to generate"}
          </div>
        ) : null}
        {products.length > 0 && (
          <Button variant="outline" className="w-full h-10 text-sm" onClick={() => setShowList(true)}>
            View {products.length} item{products.length > 1 ? "s" : ""} <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default ScanMode;
