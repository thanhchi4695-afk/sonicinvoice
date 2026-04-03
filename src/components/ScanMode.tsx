import { useState, useRef, useCallback } from "react";
import { Camera, Type, ChevronLeft, ChevronRight, Plus, Trash2, Copy, Edit2, Check, Download, Zap, Package, ScanBarcode, RotateCcw, Eye, AlertTriangle, Search, Tag, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { useStoreMode } from "@/hooks/use-store-mode";
import { toast } from "sonner";
import { lookupCatalog } from "@/lib/catalog-memory";
import { matchProduct, lookupBarcode, saveBarcodeToCatalog, validateGTIN, extractColourFromTitle, extractSizeFromTitle } from "@/lib/barcode-catalog";
import { generateShopifyCSV, type ScannedProductForExport } from "@/lib/shopify-csv-schema";
import ScanExportReview from "@/components/ScanExportReview";
import BatchReviewScreen from "@/components/BatchReviewScreen";

interface ScannedProduct {
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
  confidenceReason: string;
  matchSource: string;
  imageUrl: string | null;
}

type InputMode = "camera" | "text" | "barcode" | "sku";

const MATCH_SOURCE_LABELS: Record<string, string> = {
  catalog_memory: "Catalog Match",
  barcode_catalog: "Barcode Library",
  existing_session: "Session Match",
  ai_generated: "AI Generated",
  manual_only: "Manual Entry",
};

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

const MatchSourceBadge = ({ source }: { source: string }) => {
  if (!source || source === "manual_only") return null;
  const colors: Record<string, string> = {
    catalog_memory: "bg-primary/15 text-primary",
    barcode_catalog: "bg-accent text-accent-foreground",
    existing_session: "bg-secondary text-secondary-foreground",
    ai_generated: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[source] || "bg-muted text-muted-foreground"}`}>
      <Tag className="w-2.5 h-2.5" /> {MATCH_SOURCE_LABELS[source] || source}
    </span>
  );
};

const PROGRESS_MESSAGES = [
  "Analyzing item…",
  "Identifying product…",
  "Generating draft…",
];

interface DraftState {
  title: string;
  type: string;
  vendor: string;
  description: string;
  tags: string[];
  colour: string;
  pattern: string;
  sku: string;
  barcode: string;
  confidence: number;
  confidenceReason: string;
  matchSource: string;
}

const ScanMode = ({ onBack }: { onBack: () => void }) => {
  const config = getStoreConfig();
  const mode = useStoreMode();
  const sym = config.currencySymbol || "$";
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeFileRef = useRef<HTMLInputElement>(null);

  const [inputMode, setInputMode] = useState<InputMode>("barcode");
  const [textInput, setTextInput] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [products, setProducts] = useState<ScannedProduct[]>([]);
  const [showList, setShowList] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showExportReview, setShowExportReview] = useState(false);
  const [showBatchReview, setShowBatchReview] = useState(false);

  const resetInput = useCallback(() => {
    setTextInput("");
    setPrice("");
    setQuantity("1");
    setPreview(null);
    setDraft(null);
    setProgressIdx(0);
    if (fileRef.current) fileRef.current.value = "";
    if (barcodeFileRef.current) barcodeFileRef.current.value = "";
  }, []);

  const animateProgress = () => {
    let idx = 0;
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, PROGRESS_MESSAGES.length - 1);
      setProgressIdx(idx);
    }, 1200);
    return () => clearInterval(interval);
  };

  // ── Lookup pipeline: session → barcode catalog → catalog memory → AI ──
  const lookupBarcodeSku = (input: string): DraftState | null => {
    const cleanInput = input.trim();
    if (!cleanInput) return null;

    const isNumeric = /^\d+$/.test(cleanInput);
    const queryBarcode = isNumeric ? cleanInput : undefined;
    const querySku = !isNumeric ? cleanInput : undefined;

    // 1. Check existing session
    const sessionMatch = products.find(
      p => (queryBarcode && p.barcode === queryBarcode) || (querySku && p.sku.toLowerCase() === cleanInput.toLowerCase())
    );
    if (sessionMatch) {
      return {
        title: sessionMatch.title,
        type: sessionMatch.type,
        vendor: sessionMatch.vendor,
        description: sessionMatch.description,
        tags: sessionMatch.tags ? sessionMatch.tags.split(", ") : [],
        colour: sessionMatch.colour,
        pattern: "",
        sku: sessionMatch.sku,
        barcode: sessionMatch.barcode,
        confidence: 95,
        confidenceReason: "Matched existing item in current session",
        matchSource: "existing_session",
      };
    }

    // 2. Check barcode catalog (personal library)
    const barcodeMatch = matchProduct(queryBarcode, querySku, undefined);
    if (barcodeMatch.source !== "none" && barcodeMatch.entry) {
      const e = barcodeMatch.entry;
      return {
        title: e.title,
        type: e.type,
        vendor: e.vendor,
        description: "",
        tags: [e.type].filter(Boolean),
        colour: extractColourFromTitle(e.title),
        pattern: "",
        sku: e.sku,
        barcode: barcodeMatch.barcode || queryBarcode || "",
        confidence: 95,
        confidenceReason: `Matched via ${barcodeMatch.source} in barcode library`,
        matchSource: "barcode_catalog",
      };
    }

    // 3. Check catalog memory (uploaded supplier catalogs)
    const catalogMatch = lookupCatalog({ barcode: queryBarcode, sku: querySku });
    if (catalogMatch.matched) {
      const p = catalogMatch.product;
      return {
        title: p.title,
        type: p.type,
        vendor: catalogMatch.supplier,
        description: "",
        tags: [p.type, p.colour].filter(Boolean),
        colour: p.colour,
        pattern: "",
        sku: p.sku,
        barcode: p.barcode || queryBarcode || "",
        confidence: 92,
        confidenceReason: `Matched via ${catalogMatch.matchType} in ${catalogMatch.supplier} catalog`,
        matchSource: "catalog_memory",
      };
    }

    return null; // No local match — fall through to AI
  };

  const handleBarcodeSkuSubmit = async () => {
    const input = textInput.trim();
    if (!input) return;

    // Try local lookup first
    const localMatch = lookupBarcodeSku(input);
    if (localMatch) {
      setDraft(localMatch);
      toast.success("Product found!", { duration: 1500 });
      return;
    }

    // Validate GTIN if numeric
    const isNumeric = /^\d+$/.test(input);
    const validBarcode = isNumeric ? validateGTIN(input) : "";

    // Fall back to AI
    setGenerating(true);
    setProgressIdx(0);
    const stopAnim = animateProgress();
    try {
      const prompt = isNumeric
        ? `I scanned a barcode: ${input}. Generate a best-effort product draft. If you cannot identify the product, use "Unidentified Product" as the title.`
        : `I have a product SKU: ${input}. Generate a best-effort product draft. If you cannot identify the product from the SKU, use "Unidentified Product" as the title.`;

      const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
        body: { input: prompt, mode: "text", storeName: config.name, storeCity: config.city },
      });
      if (error) throw error;

      const title = data.product_title || "Unidentified Product";
      setDraft({
        title,
        type: data.product_type || "General",
        vendor: "",
        description: data.short_description || "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        colour: data.colour || "",
        pattern: data.pattern || "",
        sku: isNumeric ? "" : input,
        barcode: validBarcode || (isNumeric ? input : ""),
        confidence: Math.min(data.confidence_score ?? 50, 65), // Cap at 65 for unmatched barcode/SKU
        confidenceReason: data.confidence_reason || "No catalog match — AI best effort",
        matchSource: "ai_generated",
      });
    } catch (e: any) {
      console.error("AI error:", e);
      toast.error(e?.message || "AI generation failed");
      setDraft({
        title: "Unidentified Product",
        type: "General",
        vendor: "",
        description: "",
        tags: [],
        colour: "",
        pattern: "",
        sku: isNumeric ? "" : input,
        barcode: isNumeric ? input : "",
        confidence: 20,
        confidenceReason: "No match found and AI call failed — manual entry required",
        matchSource: "manual_only",
      });
    } finally {
      stopAnim();
      setGenerating(false);
    }
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
        vendor: "",
        description: data.short_description || "",
        tags: Array.isArray(data.tags) ? data.tags : [],
        colour: data.colour || "",
        pattern: data.pattern || "",
        sku: "",
        barcode: "",
        confidence: data.confidence_score ?? 50,
        confidenceReason: data.confidence_reason || "",
        matchSource: "ai_generated",
      });
    } catch (e: any) {
      console.error("AI error:", e);
      toast.error(e?.message || "AI generation failed");
      setDraft({
        title: textInput || "Product",
        type: "General",
        vendor: "",
        description: "",
        tags: [],
        colour: "",
        pattern: "",
        sku: "",
        barcode: "",
        confidence: 20,
        confidenceReason: "AI call failed — manual entry required",
        matchSource: "manual_only",
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

  const handleSkuLabelCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    const base64 = await fileToBase64(file);

    // Use AI with special OCR prompt for SKU labels
    setGenerating(true);
    setProgressIdx(0);
    const stopAnim = animateProgress();
    try {
      const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
        body: {
          input: base64,
          mode: "image",
          storeName: config.name,
          storeCity: config.city,
          ocrMode: true,
        },
      });
      if (error) throw error;

      // Try to look up any detected barcode/SKU
      const detectedBarcode = data.barcode || "";
      const detectedSku = data.sku || "";
      let localMatch: DraftState | null = null;

      if (detectedBarcode || detectedSku) {
        localMatch = lookupBarcodeSku(detectedBarcode || detectedSku);
      }

      if (localMatch) {
        setDraft({ ...localMatch, barcode: localMatch.barcode || detectedBarcode, sku: localMatch.sku || detectedSku });
        toast.success("Product found from label!", { duration: 1500 });
      } else {
        setDraft({
          title: data.product_title || "Unidentified Product",
          type: data.product_type || "General",
          vendor: "",
          description: data.short_description || "",
          tags: Array.isArray(data.tags) ? data.tags : [],
          colour: data.colour || "",
          pattern: data.pattern || "",
          sku: detectedSku,
          barcode: detectedBarcode,
          confidence: data.confidence_score ?? 50,
          confidenceReason: data.confidence_reason || "",
          matchSource: "ai_generated",
        });
      }
    } catch (e: any) {
      console.error("AI error:", e);
      toast.error(e?.message || "Label scan failed");
    } finally {
      stopAnim();
      setGenerating(false);
    }
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
      vendor: draft.vendor,
      description: draft.description,
      tags: draft.tags.join(", "),
      colour: draft.colour,
      sku: draft.sku,
      barcode: draft.barcode,
      price: parseFloat(price) || 0,
      quantity: parseInt(quantity) || 1,
      confidence: draft.confidence,
      confidenceReason: draft.confidenceReason,
      matchSource: draft.matchSource,
      imageUrl: preview,
    };

    // Auto-save to barcode catalog for future lookups
    if (item.barcode && item.title !== "Unidentified Product") {
      saveBarcodeToCatalog(item.barcode, {
        title: item.title,
        vendor: item.vendor,
        sku: item.sku,
        type: item.type,
        addedDate: new Date().toISOString().slice(0, 10),
      });
    }

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
    toast.success(`Exported ${products.length} products`);
  };

  // ── Batch review screen ──
  if (showBatchReview) {
    return (
      <BatchReviewScreen
        products={products}
        onBack={() => setShowBatchReview(false)}
        onSetProducts={setProducts}
      />
    );
  }

  // ── Export review screen ──
  if (showExportReview) {
    return (
      <ScanExportReview
        products={products}
        onBack={() => setShowExportReview(false)}
        onUpdateProduct={(idx, field, value) => updateProduct(idx, field as keyof ScannedProduct, value)}
        onRemoveProduct={removeProduct}
      />
    );
  }

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
                    <input value={p.sku} onChange={e => updateProduct(i, "sku", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground font-mono" placeholder="SKU" />
                    <input value={p.barcode} onChange={e => updateProduct(i, "barcode", e.target.value)}
                      className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground font-mono" placeholder="Barcode" />
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-foreground truncate">{p.title}</p>
                      <ConfidenceBadgeInline score={p.confidence} />
                      <MatchSourceBadge source={p.matchSource} />
                    </div>
                    <p className="text-xs text-muted-foreground">{p.type}{p.colour ? ` · ${p.colour}` : ""}</p>
                    {(p.sku || p.barcode) && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {p.sku && `SKU: ${p.sku}`}{p.sku && p.barcode ? " · " : ""}{p.barcode && `BC: ${p.barcode}`}
                      </p>
                    )}
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
          <Button className="w-full h-12 text-base font-semibold" onClick={() => setShowBatchReview(true)} disabled={products.length === 0}>
            <Layers className="w-5 h-5 mr-2" /> Batch Review & Edit
          </Button>
          <Button variant="outline" className="w-full h-10" onClick={() => setShowExportReview(true)} disabled={products.length === 0}>
            <FileCheck className="w-4 h-4 mr-1" /> Review & Export CSV
          </Button>
          <Button variant="ghost" className="w-full h-10 text-xs" onClick={exportCSV} disabled={products.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" /> Quick Export
          </Button>
          <Button variant="ghost" className="w-full h-10" onClick={() => setShowList(false)}>
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
            <Eye className="w-4 h-4 text-primary" /> Scan Mode (AI)
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
        <div className="grid grid-cols-4 gap-1.5">
          {([
            { m: "barcode" as InputMode, icon: ScanBarcode, label: "Barcode" },
            { m: "sku" as InputMode, icon: Search, label: "SKU Label" },
            { m: "camera" as InputMode, icon: Camera, label: "Photo" },
            { m: "text" as InputMode, icon: Type, label: "Text" },
          ]).map(t => (
            <button key={t.m} onClick={() => { setInputMode(t.m); resetInput(); }}
              className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-medium transition-colors ${inputMode === t.m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Barcode / manual entry */}
        {inputMode === "barcode" && !draft && !generating && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground">Scan or enter barcode / SKU</label>
            <div className="flex gap-2">
              <input value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleBarcodeSkuSubmit()}
                placeholder="e.g. 9312345678901 or JA81520"
                className="flex-1 h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground font-mono" autoFocus />
              <Button className="h-12 px-4" onClick={handleBarcodeSkuSubmit} disabled={!textInput.trim()}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Checks: session → barcode library → supplier catalogs → AI fallback
            </p>
          </div>
        )}

        {/* SKU label scan (camera OCR) */}
        {inputMode === "sku" && !draft && !generating && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground">Scan product label or swing tag</label>
            <div className="rounded-2xl border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center min-h-[200px] cursor-pointer"
              onClick={() => barcodeFileRef.current?.click()}>
              {preview ? (
                <img src={preview} alt="Label" className="w-full h-full object-contain max-h-[240px] rounded-xl" />
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <ScanBarcode className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Scan SKU / barcode label</p>
                  <p className="text-xs text-muted-foreground mt-1">AI will read the label and identify the product</p>
                </>
              )}
              <input ref={barcodeFileRef} type="file" accept="image/*" capture="environment" onChange={handleSkuLabelCapture} className="hidden" />
            </div>
          </div>
        )}

        {/* Camera input (product photo) */}
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  {inputMode === "sku" ? "Reading label via OCR…" : "AI is processing your input"}
                </p>
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
            {/* Image thumbnail + confidence + match source */}
            <div className="flex gap-3">
              {preview && (
                <img src={preview} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0 border border-border" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <ConfidenceBadgeInline score={draft.confidence} />
                  <MatchSourceBadge source={draft.matchSource} />
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
                  <label className="text-[10px] text-muted-foreground">Vendor</label>
                  <input value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">SKU</label>
                  <input value={draft.sku} onChange={e => setDraft({ ...draft, sku: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground font-mono" placeholder="e.g. JA81520" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Barcode</label>
                  <input value={draft.barcode} onChange={e => setDraft({ ...draft, barcode: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground font-mono" placeholder="e.g. 9312345678901" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Colour</label>
                  <input value={draft.colour} onChange={e => setDraft({ ...draft, colour: e.target.value })}
                    className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm text-foreground" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Tags</label>
                  <input value={draft.tags.join(", ")} onChange={e => setDraft({ ...draft, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })}
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
            {inputMode === "barcode" ? "Enter a barcode or SKU to look up" :
             inputMode === "sku" ? "Scan a product label to get started" :
             inputMode === "camera" ? "Take a photo to get started" :
             "Enter product info to generate"}
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
