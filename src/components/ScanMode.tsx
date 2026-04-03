import { useState, useRef, useCallback } from "react";
import { Camera, Type, ChevronLeft, ChevronRight, Plus, Trash2, Copy, Edit2, Check, X, Download, Zap, Package, ScanBarcode } from "lucide-react";
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
  price: number;
  quantity: number;
  editing: boolean;
}

type InputMode = "text" | "camera" | "barcode";

const ScanMode = ({ onBack }: { onBack: () => void }) => {
  const config = getStoreConfig();
  const mode = useStoreMode();
  const sym = config.currencySymbol || "$";
  const fileRef = useRef<HTMLInputElement>(null);

  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [textInput, setTextInput] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [generatedType, setGeneratedType] = useState("");
  const [generatedVendor, setGeneratedVendor] = useState("");
  const [generatedDesc, setGeneratedDesc] = useState("");
  const [generatedTags, setGeneratedTags] = useState("");
  const [products, setProducts] = useState<ScannedProduct[]>([]);
  const [showList, setShowList] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const resetInput = useCallback(() => {
    setTextInput("");
    setPrice("");
    setQuantity("1");
    setPreview(null);
    setGeneratedTitle("");
    setGeneratedType("");
    setGeneratedVendor("");
    setGeneratedDesc("");
    setGeneratedTags("");
  }, []);

  const generateFromText = async (input: string) => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
        body: { input, mode: "text", storeName: config.storeName, storeCity: config.storeCity },
      });
      if (error) throw error;
      setGeneratedTitle(data.title || input);
      setGeneratedType(data.type || "General");
      setGeneratedVendor(data.vendor || "");
      setGeneratedDesc(data.description || "");
      setGeneratedTags(data.tags || "");
    } catch (e) {
      console.error("AI generation error:", e);
      // Fallback: clean up input as title
      const words = input.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      setGeneratedTitle(words.join(" "));
      setGeneratedType("General");
    } finally {
      setGenerating(false);
    }
  };

  const generateFromImage = async (file: File) => {
    setGenerating(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
        body: { input: base64, mode: "image", storeName: config.storeName, storeCity: config.storeCity },
      });
      if (error) throw error;
      setGeneratedTitle(data.title || "Product");
      setGeneratedType(data.type || "General");
      setGeneratedVendor(data.vendor || "");
      setGeneratedDesc(data.description || "");
      setGeneratedTags(data.tags || "");
    } catch (e) {
      console.error("AI image error:", e);
      setGeneratedTitle("Product");
      setGeneratedType("General");
    } finally {
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

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    generateFromImage(file);
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    generateFromText(textInput.trim());
  };

  const saveAndNext = () => {
    if (!generatedTitle || !price) {
      toast.error("Title and price are required");
      return;
    }
    const item: ScannedProduct = {
      id: crypto.randomUUID(),
      title: generatedTitle,
      type: generatedType,
      vendor: generatedVendor,
      description: generatedDesc,
      tags: generatedTags,
      price: parseFloat(price) || 0,
      quantity: parseInt(quantity) || 1,
      editing: false,
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
      p.title,
      p.description,
      p.vendor,
      p.type,
      p.tags,
      "TRUE",
      "Title",
      "Default Title",
      "",
      p.price.toFixed(2),
      p.quantity.toString(),
      "active",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scan-mode-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success(`Exported ${products.length} products`);
  };

  // ── Session list view ──
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
            <div key={p.id} className="rounded-xl border border-border bg-card p-3">
              {editIdx === i ? (
                <div className="space-y-2">
                  <input value={p.title} onChange={e => updateProduct(i, "title", e.target.value)}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Title" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={p.vendor} onChange={e => updateProduct(i, "vendor", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Vendor" />
                    <input value={p.type} onChange={e => updateProduct(i, "type", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Type" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={p.price} onChange={e => updateProduct(i, "price", parseFloat(e.target.value) || 0)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Price" />
                    <input type="number" value={p.quantity} onChange={e => updateProduct(i, "quantity", parseInt(e.target.value) || 1)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" placeholder="Qty" />
                  </div>
                  <Button size="sm" className="w-full" onClick={() => setEditIdx(null)}>
                    <Check className="w-4 h-4 mr-1" /> Done
                  </Button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.vendor ? `${p.vendor} · ` : ""}{p.type}</p>
                    <p className="text-xs text-foreground mt-0.5">{sym}{p.price.toFixed(2)} · Qty: {p.quantity}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
            <Zap className="w-4 h-4 text-primary" /> Scan Mode
          </h2>
        </div>
        {products.length > 0 && (
          <button onClick={() => setShowList(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-medium">
            <Package className="w-3.5 h-3.5" /> {products.length} items
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Input mode tabs */}
        <div className="flex gap-2">
          {[
            { mode: "text" as InputMode, icon: Type, label: "Text" },
            { mode: "camera" as InputMode, icon: Camera, label: "Photo" },
            { mode: "barcode" as InputMode, icon: ScanBarcode, label: "Barcode" },
          ].map(t => (
            <button key={t.mode} onClick={() => { setInputMode(t.mode); resetInput(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${inputMode === t.mode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Text input */}
        {inputMode === "text" && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Describe the product</label>
            <div className="flex gap-2">
              <input value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                placeholder="e.g. blue floral midi dress"
                className="flex-1 h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground" />
              <Button className="h-12 px-4" onClick={handleTextSubmit} disabled={!textInput.trim() || generating}>
                <Zap className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Camera input */}
        {inputMode === "camera" && (
          <div className="space-y-2">
            <div className="relative rounded-2xl border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center min-h-[200px] overflow-hidden cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              {preview ? (
                <img src={preview} alt="Product" className="w-full h-full object-contain max-h-[240px]" />
              ) : (
                <>
                  <Camera className="w-10 h-10 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium text-foreground">Tap to capture product</p>
                  <p className="text-xs text-muted-foreground mt-0.5">AI will identify it</p>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />
            </div>
          </div>
        )}

        {/* Barcode input */}
        {inputMode === "barcode" && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Enter barcode / SKU</label>
            <div className="flex gap-2">
              <input value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                placeholder="e.g. 9312345678901"
                className="flex-1 h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground font-mono" />
              <Button className="h-12 px-4" onClick={handleTextSubmit} disabled={!textInput.trim() || generating}>
                <Zap className="w-4 h-4" />
              </Button>
            </div>
            <button onClick={() => fileRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted text-xs text-muted-foreground font-medium">
              <ScanBarcode className="w-4 h-4" /> Scan with camera instead
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" />
          </div>
        )}

        {/* Processing indicator */}
        {generating && (
          <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-primary/5 border border-primary/10">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary animate-pulse" fill="currentColor" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Generating product details…</p>
              <p className="text-xs text-muted-foreground">AI is identifying your product</p>
            </div>
          </div>
        )}

        {/* Generated product card */}
        {generatedTitle && !generating && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/15 text-primary">AI Generated</span>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Product title</label>
              <input value={generatedTitle} onChange={e => setGeneratedTitle(e.target.value)}
                className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm font-medium text-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Type</label>
                <input value={generatedType} onChange={e => setGeneratedType(e.target.value)}
                  className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Vendor</label>
                <input value={generatedVendor} onChange={e => setGeneratedVendor(e.target.value)}
                  className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
              </div>
            </div>
            {generatedDesc && (
              <div>
                <label className="text-[10px] text-muted-foreground">Description</label>
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">{generatedDesc}</p>
              </div>
            )}

            {/* Price & Quantity — required */}
            <div className="grid grid-cols-2 gap-2">
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
        )}
      </div>

      {/* Bottom action */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
        {generatedTitle && !generating ? (
          <Button className="w-full h-12 text-base font-semibold" onClick={saveAndNext} disabled={!price}>
            <Check className="w-5 h-5 mr-2" /> Save & Next
          </Button>
        ) : (
          <div className="text-center text-xs text-muted-foreground py-2">
            {generating ? "Generating…" : "Enter a product to get started"}
          </div>
        )}
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
