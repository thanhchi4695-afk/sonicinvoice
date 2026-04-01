import { useState, useMemo, useCallback, useRef } from "react";
import {
  ChevronLeft, Upload, Download, ChevronDown, ChevronUp,
  Tag, Factory, Layers, Search, Check, AlertTriangle, Copy, Eye, X, Save, Trash2
} from "lucide-react";
import ShopifyPushFlow from "@/components/ShopifyPushFlow";
import type { PushProduct } from "@/lib/shopify-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  parseShopifyFile, ParsedFile, ShopifyProduct,
  Direction, DiscountType, RoundingRule,
  calculateNewPrice, generateOutputCSV, generateFilename, PriceResult,
} from "@/lib/shopify-csv";

interface BulkSaleFlowProps {
  onBack: () => void;
  onNavigateToGoogleFeed?: () => void;
}

interface SaleTemplate {
  name: string;
  direction: Direction;
  discountType: DiscountType;
  discountValue: number;
  rounding: RoundingRule;
  selectedTags: string[];
  selectedVendors: string[];
  selectedTypes: string[];
  tagOpts: TagOpts;
}

interface TagOpts {
  removeFullPrice: boolean;
  addSaleTag: boolean;
  saleTagName: string;
  customTag: string;
}

const ROUNDING_OPTIONS: { value: RoundingRule; label: string; desc: string }[] = [
  { value: "nearest_01", label: "Nearest $0.01", desc: "Keep exact (e.g. $101.47)" },
  { value: "nearest_05", label: "Nearest $0.05", desc: "e.g. $76.95" },
  { value: "nearest_1", label: "Nearest $1.00", desc: "e.g. $77.00" },
  { value: "floor_95", label: "Floor to .95", desc: "e.g. $76.95" },
];

// Tag categorization helpers
const MONTH_PATTERN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\d{2}$/i;
const STATUS_TAGS = new Set(["full_price", "sale"]);
const SPECIAL_TAGS = new Set(["underwire", "plus size", "tummy control", "d-g", "chlorine resistant", "sun protection", "mastectomy", "new", "new arrivals", "new swim", "gifting"]);
const DEPT_TAGS = new Set(["swimwear", "womens", "mens", "kids", "accessories", "clothing", "womens swim", "mens swim", "womens clothing"]);

function categorizeTag(tag: string): string {
  const lower = tag.toLowerCase();
  if (STATUS_TAGS.has(lower)) return "Status";
  if (MONTH_PATTERN.test(tag)) return "Arrival Month";
  if (SPECIAL_TAGS.has(lower)) return "Special Properties";
  if (DEPT_TAGS.has(lower)) return "Department";
  return "Product / Collection";
}

function groupTags(tags: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  tags.forEach((t) => {
    const cat = categorizeTag(t);
    (groups[cat] ||= []).push(t);
  });
  return groups;
}

// Load templates from localStorage
function loadTemplates(): SaleTemplate[] {
  try {
    return JSON.parse(localStorage.getItem("sale_templates") || "[]");
  } catch { return []; }
}
function saveTemplates(t: SaleTemplate[]) {
  localStorage.setItem("sale_templates", JSON.stringify(t));
}

const BulkSaleFlow = ({ onBack }: BulkSaleFlowProps) => {
  // File state
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Selection state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [manualSelection, setManualSelection] = useState<Set<string>>(new Set());
  const [selectionTab, setSelectionTab] = useState("tags");
  const [searchQuery, setSearchQuery] = useState("");

  // Discount state
  const [direction, setDirection] = useState<Direction>("apply");
  const [discountType, setDiscountType] = useState<DiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState(30);
  const [rounding, setRounding] = useState<RoundingRule>("nearest_01");
  const [priceFloor, setPriceFloor] = useState<string>("");

  // Tag management
  const [tagOpts, setTagOpts] = useState<TagOpts>({
    removeFullPrice: true,
    addSaleTag: true,
    saleTagName: "sale",
    customTag: "",
  });

  // UI state
  const [showHowTo, setShowHowTo] = useState(false);
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<SaleTemplate[]>(loadTemplates);
  const [templateName, setTemplateName] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  // File upload handler
  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const result = await parseShopifyFile(file);
      setParsed(result);
      setFileName(file.name);
      setManualSelection(new Set(result.products.map((p) => p.handle)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setLoading(false);
    }
  }, []);

  // Filtered products based on selection
  const filteredProducts = useMemo(() => {
    if (!parsed) return [];
    let products = parsed.products;

    if (selectionTab === "tags" && selectedTags.length > 0) {
      products = products.filter((p) => p.tags.some((t) => selectedTags.includes(t)));
    } else if (selectionTab === "brands" && selectedVendors.length > 0) {
      products = products.filter((p) => selectedVendors.includes(p.vendor));
    } else if (selectionTab === "types" && selectedTypes.length > 0) {
      products = products.filter((p) => selectedTypes.includes(p.type));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      products = products.filter((p) => p.title.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q));
    }

    return products;
  }, [parsed, selectedTags, selectedVendors, selectedTypes, selectionTab, searchQuery]);

  // Selected products (manual checkboxes applied)
  const selectedProducts = useMemo(
    () => filteredProducts.filter((p) => manualSelection.has(p.handle)),
    [filteredProducts, manualSelection]
  );

  // Price previews
  const previews = useMemo(() => {
    return selectedProducts.map((p) => ({
      product: p,
      result: calculateNewPrice(
        p.currentPrice,
        p.compareAtPrice,
        direction,
        discountType,
        discountValue,
        rounding,
        priceFloor ? parseFloat(priceFloor) : undefined
      ),
    }));
  }, [selectedProducts, direction, discountType, discountValue, rounding, priceFloor]);

  const affectedVariants = useMemo(
    () => selectedProducts.reduce((sum, p) => sum + p.variantRows.length, 0),
    [selectedProducts]
  );

  const avgDiscount = useMemo(() => {
    const vals = previews.filter((p) => p.result.status === "sale" && p.result.newCompare);
    if (!vals.length) return 0;
    return vals.reduce((s, p) => s + (p.result.newCompare! > 0 ? (1 - p.result.newPrice / p.result.newCompare!) * 100 : 0), 0) / vals.length;
  }, [previews]);

  // Download handler
  const handleDownload = useCallback(() => {
    if (!parsed) return;
    const selectedHandles = new Set(selectedProducts.map((p) => p.handle));
    const csv = generateOutputCSV(
      parsed.headers, parsed.rows, selectedHandles,
      direction, discountType, discountValue, rounding,
      priceFloor ? parseFloat(priceFloor) : undefined,
      tagOpts
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const vendor = selectedProducts[0]?.vendor || "";
    const tag = selectedTags[0] || "";
    a.href = url;
    a.download = generateFilename(vendor, tag, direction, discountValue);
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }, [parsed, selectedProducts, direction, discountType, discountValue, rounding, priceFloor, tagOpts, selectedTags]);

  // Copy CSV
  const handleCopy = useCallback(() => {
    if (!parsed) return;
    const selectedHandles = new Set(selectedProducts.map((p) => p.handle));
    const csv = generateOutputCSV(
      parsed.headers, parsed.rows, selectedHandles,
      direction, discountType, discountValue, rounding,
      priceFloor ? parseFloat(priceFloor) : undefined,
      tagOpts
    );
    navigator.clipboard.writeText(csv);
  }, [parsed, selectedProducts, direction, discountType, discountValue, rounding, priceFloor, tagOpts]);

  // Template save/load
  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    const t: SaleTemplate = {
      name: templateName.trim(),
      direction, discountType, discountValue, rounding,
      selectedTags, selectedVendors, selectedTypes, tagOpts,
    };
    const updated = [...templates, t];
    setTemplates(updated);
    saveTemplates(updated);
    setTemplateName("");
    setShowTemplateSave(false);
  };

  const handleLoadTemplate = (t: SaleTemplate) => {
    setDirection(t.direction);
    setDiscountType(t.discountType);
    setDiscountValue(t.discountValue);
    setRounding(t.rounding);
    setSelectedTags(t.selectedTags);
    setSelectedVendors(t.selectedVendors);
    setSelectedTypes(t.selectedTypes);
    setTagOpts(t.tagOpts);
  };

  const handleDeleteTemplate = (idx: number) => {
    const updated = templates.filter((_, i) => i !== idx);
    setTemplates(updated);
    saveTemplates(updated);
  };

  const toggleTag = (tag: string) => setSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]);
  const toggleVendor = (v: string) => setSelectedVendors((p) => p.includes(v) ? p.filter((t) => t !== v) : [...p, v]);
  const toggleType = (t: string) => setSelectedTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);
  const toggleProduct = (handle: string) => setManualSelection((prev) => {
    const next = new Set(prev);
    next.has(handle) ? next.delete(handle) : next.add(handle);
    return next;
  });
  const selectAllFiltered = () => setManualSelection((prev) => {
    const next = new Set(prev);
    filteredProducts.forEach((p) => next.add(p.handle));
    return next;
  });
  const deselectAllFiltered = () => setManualSelection((prev) => {
    const next = new Set(prev);
    filteredProducts.forEach((p) => next.delete(p.handle));
    return next;
  });

  const statusColor = (r: PriceResult) => {
    switch (r.status) {
      case "sale": return "text-success";
      case "restored": return "text-primary";
      case "floor_applied": return "text-secondary";
      case "skipped": return "text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">💲 Bulk Sale Pricing</h2>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6 max-w-3xl mx-auto">

        {/* ═══ STEP 1 — FILE UPLOAD ═══ */}
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Step 1 — Upload your Shopify product export
          </h3>

          {!parsed ? (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full h-44 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 active:bg-muted transition-colors"
              >
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Drop your Shopify products CSV here</p>
                  <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx</p>
                </div>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />

              <button onClick={() => setShowHowTo(!showHowTo)} className="flex items-center gap-1 text-xs text-muted-foreground mt-3">
                {showHowTo ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                How to get this file from Shopify
              </button>
              {showHowTo && (
                <ol className="text-xs text-muted-foreground mt-2 space-y-1 pl-4 list-decimal">
                  <li>Shopify Admin → Products</li>
                  <li>Click Export (top right)</li>
                  <li>Select: All products (or filter first)</li>
                  <li>Select: CSV for Excel, Numbers, or other spreadsheet</li>
                  <li>Upload the downloaded file here</li>
                </ol>
              )}

              {loading && <p className="text-sm text-primary mt-3 animate-pulse">Reading file...</p>}
              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
            </>
          ) : (
            /* Scan summary card */
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  <span className="text-sm font-medium">File loaded: {fileName}</span>
                </div>
                <button onClick={() => { setParsed(null); setFileName(""); setDownloaded(false); }} className="text-xs text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">{parsed.products.length} products · {parsed.totalVariants} variant rows</span>
                <span className="text-muted-foreground">{parsed.onSaleCount} on sale · {parsed.fullPriceCount} full price</span>
                <span className="text-muted-foreground">{parsed.allVendors.length} brand{parsed.allVendors.length !== 1 ? "s" : ""}: {parsed.allVendors.join(", ")}</span>
              </div>
            </div>
          )}
        </section>

        {parsed && (
          <>
            {/* ═══ TEMPLATES ═══ */}
            {templates.length > 0 && (
              <section>
                <p className="text-xs text-muted-foreground mb-2">📋 Saved templates:</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t, i) => (
                    <div key={i} className="flex items-center gap-1 bg-card border border-border rounded-full pl-3 pr-1 py-1">
                      <button onClick={() => handleLoadTemplate(t)} className="text-xs font-medium">{t.name}</button>
                      <button onClick={() => handleDeleteTemplate(i)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ═══ STEP 2 — PRODUCT SELECTION ═══ */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Step 2 — Select products
              </h3>

              <Tabs value={selectionTab} onValueChange={setSelectionTab}>
                <TabsList className="w-full grid grid-cols-4 mb-4">
                  <TabsTrigger value="tags" className="text-xs gap-1"><Tag className="w-3 h-3" /> Tags</TabsTrigger>
                  <TabsTrigger value="brands" className="text-xs gap-1"><Factory className="w-3 h-3" /> Brand</TabsTrigger>
                  <TabsTrigger value="types" className="text-xs gap-1"><Layers className="w-3 h-3" /> Type</TabsTrigger>
                  <TabsTrigger value="search" className="text-xs gap-1"><Search className="w-3 h-3" /> Search</TabsTrigger>
                </TabsList>

                <TabsContent value="tags">
                  {Object.entries(groupTags(parsed.allTags)).map(([cat, tags]) => (
                    <div key={cat} className="mb-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase">{cat}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <button key={tag} onClick={() => toggleTag(tag)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                              selectedTags.includes(tag) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="brands">
                  <div className="space-y-2">
                    {parsed.allVendors.map((v) => {
                      const count = parsed.products.filter((p) => p.vendor === v).length;
                      return (
                        <label key={v} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                          <Checkbox checked={selectedVendors.includes(v)} onCheckedChange={() => toggleVendor(v)} />
                          <span className="text-sm">{v}</span>
                          <span className="text-xs text-muted-foreground ml-auto">({count})</span>
                        </label>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="types">
                  <div className="space-y-2">
                    {parsed.allTypes.map((t) => {
                      const count = parsed.products.filter((p) => p.type === t).length;
                      return (
                        <label key={t} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                          <Checkbox checked={selectedTypes.includes(t)} onCheckedChange={() => toggleType(t)} />
                          <span className="text-sm">{t}</span>
                          <span className="text-xs text-muted-foreground ml-auto">({count})</span>
                        </label>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="search">
                  <Input
                    placeholder="Search product names..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-3"
                  />
                </TabsContent>
              </Tabs>

              {/* Match count */}
              <p className="text-sm font-medium text-primary mt-3">
                📦 {selectedProducts.length} products selected ({affectedVariants} variant rows)
              </p>

              {/* Product list */}
              {filteredProducts.length > 0 && (
                <div className="mt-3 bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{filteredProducts.length} matching</span>
                    <div className="flex gap-2">
                      <button onClick={selectAllFiltered} className="text-xs text-primary">Select all</button>
                      <button onClick={deselectAllFiltered} className="text-xs text-muted-foreground">Deselect all</button>
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-border">
                    {filteredProducts.slice(0, 50).map((p) => (
                      <label key={p.handle} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                        <Checkbox checked={manualSelection.has(p.handle)} onCheckedChange={() => toggleProduct(p.handle)} />
                        <span className="text-xs flex-1 truncate">{p.title}</span>
                        <span className="text-xs font-mono-data text-muted-foreground">${p.currentPrice.toFixed(2)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.isOnSale ? "bg-secondary/20 text-secondary" : "bg-muted text-muted-foreground"}`}>
                          {p.isOnSale ? `−${p.salePercent}%` : "full"}
                        </span>
                      </label>
                    ))}
                    {filteredProducts.length > 50 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">...and {filteredProducts.length - 50} more</p>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* ═══ STEP 3 — DISCOUNT ═══ */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Step 3 — Choose discount
              </h3>

              {/* Direction cards */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => setDirection("apply")}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    direction === "apply" ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <p className="text-lg mb-1">📉</p>
                  <p className="text-sm font-semibold">Apply Sale</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Put products ON SALE</p>
                </button>
                <button
                  onClick={() => setDirection("end")}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    direction === "end" ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <p className="text-lg mb-1">🔄</p>
                  <p className="text-sm font-semibold">End Sale</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Restore original prices</p>
                </button>
              </div>

              {direction === "apply" && (
                <div className="space-y-4">
                  {/* Discount type */}
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["percentage", "% Off"],
                      ["fixed", "$ Off"],
                      ["exact", "Set Price"],
                      ["multiply", "Multiply"],
                    ] as [DiscountType, string][]).map(([val, label]) => (
                      <button key={val} onClick={() => setDiscountType(val)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          discountType === val ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Value input */}
                  {discountType === "percentage" && (
                    <>
                      <div className="flex items-center gap-3">
                        <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))}
                          className="w-24 text-center font-mono-data text-lg" min={1} max={99} />
                        <span className="text-lg font-semibold">%</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[10, 20, 25, 30, 40, 50].map((v) => (
                          <button key={v} onClick={() => setDiscountValue(v)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono-data font-medium transition-colors ${
                              discountValue === v ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                            {v}%
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {discountType === "fixed" && (
                    <div className="flex items-center gap-2">
                      <span className="text-lg">$</span>
                      <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))}
                        className="w-28 font-mono-data" min={0} step={0.01} />
                      <span className="text-sm text-muted-foreground">off each</span>
                    </div>
                  )}
                  {discountType === "exact" && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">$</span>
                        <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))}
                          className="w-28 font-mono-data" min={0} step={0.01} />
                      </div>
                      <p className="text-[11px] text-secondary mt-1.5">⚠ Sets every selected product to the same price.</p>
                    </div>
                  )}
                  {discountType === "multiply" && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">RRP ×</span>
                        <Input type="number" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))}
                          className="w-24 font-mono-data" min={0} max={1} step={0.05} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">0.7 = 30% off · 0.5 = 50% off</p>
                    </div>
                  )}

                  {/* Rounding */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Rounding rule:</p>
                    <div className="space-y-1.5">
                      {ROUNDING_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="rounding" checked={rounding === opt.value}
                            onChange={() => setRounding(opt.value)} className="accent-[hsl(var(--primary))]" />
                          <span className="text-xs">{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground">— {opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Price floor */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Price floor: $</span>
                    <Input type="number" value={priceFloor} onChange={(e) => setPriceFloor(e.target.value)}
                      placeholder="optional" className="w-24 text-xs font-mono-data" min={0} step={0.01} />
                  </div>
                </div>
              )}

              {direction === "end" && (
                <div className="bg-card rounded-lg border border-border p-4 text-xs text-muted-foreground space-y-1.5">
                  <p>This will:</p>
                  <p className="flex items-center gap-1.5"><Check className="w-3 h-3 text-success" /> Set Variant Price back to Compare At Price (original RRP)</p>
                  <p className="flex items-center gap-1.5"><Check className="w-3 h-3 text-success" /> Clear Variant Compare At Price</p>
                  <p className="flex items-center gap-1.5"><Check className="w-3 h-3 text-success" /> Add 'full_price' back to Tags</p>
                  <p className="mt-2 text-[11px]">Products already at full price will be skipped.</p>
                </div>
              )}
            </section>

            {/* ═══ TAG MANAGEMENT ═══ */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tag changes</h3>
              <div className="space-y-2">
                {direction === "apply" ? (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={tagOpts.removeFullPrice} onCheckedChange={(c) => setTagOpts((o) => ({ ...o, removeFullPrice: !!c }))} />
                      Remove 'full_price' tag <span className="text-muted-foreground">(recommended)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={tagOpts.addSaleTag} onCheckedChange={(c) => setTagOpts((o) => ({ ...o, addSaleTag: !!c }))} />
                      Add sale tag:
                      <Input value={tagOpts.saleTagName} onChange={(e) => setTagOpts((o) => ({ ...o, saleTagName: e.target.value }))}
                        className="w-24 h-7 text-xs" />
                    </label>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Custom tag:</span>
                      <Input value={tagOpts.customTag} onChange={(e) => setTagOpts((o) => ({ ...o, customTag: e.target.value }))}
                        placeholder="e.g. EOFY-Sale" className="flex-1 h-7 text-xs" />
                    </div>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={tagOpts.removeFullPrice} onCheckedChange={(c) => setTagOpts((o) => ({ ...o, removeFullPrice: !!c }))} />
                      Add 'full_price' tag back
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={tagOpts.addSaleTag} onCheckedChange={(c) => setTagOpts((o) => ({ ...o, addSaleTag: !!c }))} />
                      Remove 'sale' tag
                    </label>
                  </>
                )}
              </div>
            </section>

            {/* ═══ LIVE PREVIEW ═══ */}
            {selectedProducts.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Preview — before and after
                </h3>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium">Product</th>
                          <th className="text-right px-2 py-2 font-medium">Old Price</th>
                          <th className="text-right px-2 py-2 font-medium">Compare-at</th>
                          <th className="px-1 py-2">→</th>
                          <th className="text-right px-2 py-2 font-medium">New Price</th>
                          <th className="text-right px-2 py-2 font-medium">New Comp.</th>
                          <th className="text-right px-2 py-2 font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previews.slice(0, 10).map(({ product: p, result: r }) => (
                          <tr key={p.handle}>
                            <td className="px-3 py-2 max-w-[180px] truncate">{p.title}</td>
                            <td className="text-right px-2 py-2 font-mono-data text-muted-foreground">${p.currentPrice.toFixed(2)}</td>
                            <td className="text-right px-2 py-2 font-mono-data text-muted-foreground">
                              {p.compareAtPrice ? `$${p.compareAtPrice.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-1 py-2 text-muted-foreground">→</td>
                            <td className={`text-right px-2 py-2 font-mono-data font-semibold ${statusColor(r)}`}>
                              ${r.newPrice.toFixed(2)}
                            </td>
                            <td className="text-right px-2 py-2 font-mono-data text-muted-foreground">
                              {r.newCompare ? `$${r.newCompare.toFixed(2)}` : "—"}
                            </td>
                            <td className={`text-right px-2 py-2 font-mono-data font-semibold ${statusColor(r)}`}>{r.change}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previews.length > 10 && (
                    <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                      Showing 10 of {previews.length} products
                    </p>
                  )}
                </div>

                {/* Summary */}
                <div className="mt-3 bg-card rounded-lg border border-border p-3 text-xs space-y-1 text-muted-foreground">
                  <p>{selectedProducts.length} products · {affectedVariants} variant rows</p>
                  {direction === "apply" && <p>Average discount: {avgDiscount.toFixed(1)}%</p>}
                  {direction === "apply" && previews.length > 0 && (
                    <p>Price range: ${Math.min(...previews.map((p) => p.result.newPrice)).toFixed(2)} – ${Math.max(...previews.map((p) => p.result.newPrice)).toFixed(2)}</p>
                  )}
                  {previews.filter((p) => p.result.status === "skipped").length > 0 && (
                    <p className="text-secondary flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {previews.filter((p) => p.result.status === "skipped").length} products skipped (already at full price)
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* ═══ STEP 4 — PUSH / DOWNLOAD ═══ */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Step 4 — Export your updated file
              </h3>

              {/* Shopify Push (shown when connected) */}
              <div className="mb-4">
                <ShopifyPushFlow
                  products={selectedProducts.map((p): PushProduct => {
                    const r = calculateNewPrice(
                      p.currentPrice, p.compareAtPrice, direction,
                      discountType, discountValue, rounding,
                      priceFloor ? parseFloat(priceFloor) : undefined
                    );
                    return {
                      title: p.title,
                      vendor: p.vendor,
                      product_type: p.type,
                      tags: p.tags.join(", "),
                      variants: [{
                        price: r.newPrice.toFixed(2),
                        compare_at_price: r.newCompare ? r.newCompare.toFixed(2) : undefined,
                        inventory_management: "shopify",
                      }],
                    };
                  })}
                  source="bulk_sale"
                  onFallbackCSV={handleDownload}
                />
              </div>

              {/* Save template */}
              <div className="mb-4">
                {!showTemplateSave ? (
                  <button onClick={() => setShowTemplateSave(true)} className="text-xs text-muted-foreground flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save as template
                  </button>
                ) : (
                  <div className="flex gap-2 items-center">
                    <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Template name" className="flex-1 h-8 text-xs" />
                    <Button size="sm" variant="teal" onClick={handleSaveTemplate} className="h-8 text-xs">Save</Button>
                    <button onClick={() => setShowTemplateSave(false)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>

              {/* Summary card */}
              <div className="bg-card rounded-lg border border-border p-4 mb-4 text-sm space-y-1">
                <p className="font-medium">Ready to download</p>
                <p className="text-xs text-muted-foreground">
                  {selectedProducts.length} products {direction === "apply" ? `on sale (${discountType === "percentage" ? `${discountValue}% off` : ""})` : "restored to full price"}
                </p>
                <p className="text-xs text-muted-foreground">{affectedVariants} variant rows updated</p>
                {tagOpts.removeFullPrice && (
                  <p className="text-xs text-muted-foreground">
                    Tags: {direction === "apply" ? "'full_price' removed" : "'full_price' added"}
                    {tagOpts.addSaleTag && (direction === "apply" ? ` · '${tagOpts.saleTagName}' added` : ` · '${tagOpts.saleTagName}' removed`)}
                  </p>
                )}
              </div>

              <Button variant="amber" className="w-full h-12 text-base" disabled={selectedProducts.length === 0} onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" /> Download Sale CSV
              </Button>

              <div className="flex gap-3 mt-3 justify-center">
                <button onClick={handleCopy} className="text-xs text-muted-foreground flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Copy CSV to clipboard
                </button>
              </div>

              {/* Post-download: import guide */}
              {downloaded && (
                <div className="mt-6">
                  <button onClick={() => setShowImportGuide(!showImportGuide)} className="flex items-center gap-1 text-xs text-primary">
                    {showImportGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    How to import this file into Shopify
                  </button>
                  {showImportGuide && (
                    <ol className="text-xs text-muted-foreground mt-2 space-y-1.5 pl-4 list-decimal">
                      <li>In Shopify Admin → go to Products</li>
                      <li>Click Import (top right)</li>
                      <li>Click 'Add file' → select the downloaded CSV</li>
                      <li className="font-medium text-foreground">Tick: ☑ 'Overwrite existing products with matching handle'</li>
                      <li>Click 'Upload and continue'</li>
                      <li>Review the preview — check prices look correct</li>
                      <li>Click 'Import products'</li>
                      <li>Allow 1–5 minutes for Shopify to process</li>
                    </ol>
                  )}
                  {showImportGuide && (
                    <div className="mt-3 bg-secondary/10 rounded-lg p-3 text-xs text-secondary">
                      <p className="font-medium">⚠️ Important:</p>
                      <p className="mt-1">Always tick 'Overwrite existing products'. If something goes wrong, import the ORIGINAL file to reverse all changes.</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default BulkSaleFlow;
