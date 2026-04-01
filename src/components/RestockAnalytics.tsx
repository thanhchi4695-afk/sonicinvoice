import { useState, useMemo, useCallback, useRef } from "react";
import {
  ChevronLeft, Upload, ChevronDown, ChevronUp, Check, Search, X,
  Download, Copy, Mail, List, Grid, BarChart3, Filter,
  AlertTriangle, ShoppingCart, Plus, Minus, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { parseInventoryFile, ParsedInventory } from "@/lib/inventory-parser";
import {
  runAnalytics, AnalyticsResult, ProductAnalysis, BrandHealth,
  ReorderItem, buildReorderItems, generateJoorCSV, generateEmailTemplate,
  RestockSettings, DEFAULT_SETTINGS,
} from "@/lib/restock-analytics";

interface Props { onBack: () => void }

type ViewMode = "list" | "grid" | "brand";

const RestockAnalytics = ({ onBack }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedInventory | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadTab, setUploadTab] = useState("shopify");

  // Filters
  const [brandFilter, setBrandFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<"" | "urgent" | "soon" | "monitor">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Expanded products
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Reorder drawer
  const [showReorder, setShowReorder] = useState(false);
  const [reorderItems, setReorderItems] = useState<ReorderItem[]>([]);

  // Settings
  const [settings] = useState<RestockSettings>(DEFAULT_SETTINGS);

  // How-to guides
  const [showGuide, setShowGuide] = useState(false);
  const [showFirstUse, setShowFirstUse] = useState(true);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const result = await parseInventoryFile(file);
      setParsed(result);
      setFileName(file.name);
      const analysis = runAnalytics(result, settings);
      setAnalytics(analysis);
      setShowFirstUse(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setLoading(false);
    }
  }, [settings]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!analytics) return [];
    let products = analytics.products.filter((p) => p.issue !== "healthy");
    if (brandFilter) products = products.filter((p) => p.brand === brandFilter);
    if (typeFilter) products = products.filter((p) => p.productType === typeFilter);
    if (urgencyFilter) products = products.filter((p) => p.urgency === urgencyFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      products = products.filter((p) => p.productName.toLowerCase().includes(q));
    }
    return products;
  }, [analytics, brandFilter, typeFilter, urgencyFilter, searchQuery]);

  // Reorder helpers
  const addToReorder = (product: ProductAnalysis) => {
    const items = buildReorderItems([product]);
    setReorderItems((prev) => {
      const existing = new Set(prev.map((i) => `${i.productId}-${i.size}`));
      const newItems = items.filter((i) => !existing.has(`${i.productId}-${i.size}`));
      return [...prev, ...newItems];
    });
    setShowReorder(true);
  };

  const addAllBrandToReorder = (brand: string) => {
    if (!analytics) return;
    const brandProducts = analytics.products.filter(
      (p) => p.brand === brand && p.issue !== "healthy"
    );
    const items = buildReorderItems(brandProducts);
    setReorderItems((prev) => {
      const existing = new Set(prev.map((i) => `${i.productId}-${i.size}`));
      const newItems = items.filter((i) => !existing.has(`${i.productId}-${i.size}`));
      return [...prev, ...newItems];
    });
    setShowReorder(true);
  };

  const removeReorderItem = (idx: number) => {
    setReorderItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateReorderQty = (idx: number, qty: number) => {
    setReorderItems((prev) => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(1, qty) } : item));
  };

  const reorderTotals = useMemo(() => {
    const units = reorderItems.reduce((s, i) => s + i.qty, 0);
    const cost = reorderItems.reduce((s, i) => s + i.qty * i.unitCost, 0);
    const rrp = reorderItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const brands = new Set(reorderItems.map((i) => i.brand));
    return { lines: reorderItems.length, units, cost, rrp, brands: Array.from(brands) };
  }, [reorderItems]);

  const handleDownloadJoor = (brand: string) => {
    const csv = generateJoorCSV(reorderItems, brand);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brand.toLowerCase().replace(/\s+/g, "_")}_reorder_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyEmail = (brand: string) => {
    const text = generateEmailTemplate(reorderItems, brand, "My Store");
    navigator.clipboard.writeText(text);
  };

  const urgencyIcon = (u: string) => u === "urgent" ? "🔴" : u === "soon" ? "🟡" : "🟢";
  const sizeStatusColor = (s: string) =>
    s === "sold_out" ? "bg-destructive/20 text-destructive" :
    s === "low" ? "bg-secondary/20 text-secondary" :
    "bg-success/20 text-success";

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">📊 Restock Analytics</h2>
          {reorderItems.length > 0 && (
            <button onClick={() => setShowReorder(!showReorder)} className="ml-auto flex items-center gap-1 text-xs bg-primary/15 text-primary px-2.5 py-1 rounded-full">
              <ShoppingCart className="w-3 h-3" /> {reorderItems.length}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6 max-w-3xl mx-auto">

        {/* ═══ FIRST USE GUIDE ═══ */}
        {showFirstUse && !parsed && (
          <div className="bg-card rounded-lg border border-border p-5 space-y-4">
            <h3 className="text-base font-semibold font-display">How Restock Analytics works</h3>
            <div className="space-y-3">
              {[
                { icon: "📤", text: "Export your products from Shopify or JOOR" },
                { icon: "📊", text: "Upload the file here — AI analyses every size" },
                { icon: "🔴", text: "Review size holes and restock priorities" },
                { icon: "📋", text: "Generate your JOOR reorder file or Purchase Order" },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-lg">{step.icon}</span>
                  <div>
                    <span className="text-xs text-muted-foreground">Step {i + 1}</span>
                    <p className="text-sm">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="teal" className="w-full" onClick={() => setShowFirstUse(false)}>
              Upload my file →
            </Button>
          </div>
        )}

        {/* ═══ UPLOAD ═══ */}
        {(!parsed || showFirstUse) && !showFirstUse && (
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Upload your inventory file
            </h3>
            <Tabs value={uploadTab} onValueChange={setUploadTab}>
              <TabsList className="w-full grid grid-cols-3 mb-4">
                <TabsTrigger value="shopify" className="text-[11px]">📤 Shopify Export</TabsTrigger>
                <TabsTrigger value="inventory" className="text-[11px]">📤 Inventory CSV</TabsTrigger>
                <TabsTrigger value="joor" className="text-[11px]">📤 JOOR Export</TabsTrigger>
              </TabsList>

              {["shopify", "inventory", "joor"].map((tab) => (
                <TabsContent key={tab} value={tab}>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full h-36 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 active:bg-muted transition-colors"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Upload className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium">Drop your {tab === "joor" ? "JOOR" : "Shopify"} file here</p>
                    <p className="text-xs text-muted-foreground">.csv or .xlsx</p>
                  </button>
                </TabsContent>
              ))}
            </Tabs>

            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

            <button onClick={() => setShowGuide(!showGuide)} className="flex items-center gap-1 text-xs text-muted-foreground mt-3">
              {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              How to get this file
            </button>
            {showGuide && (
              <ol className="text-xs text-muted-foreground mt-2 space-y-1 pl-4 list-decimal">
                {uploadTab === "shopify" && <>
                  <li>Go to Shopify Admin → Products</li>
                  <li>Click Export (top right)</li>
                  <li>Select: All products</li>
                  <li>Select: CSV for Excel</li>
                  <li>Upload the downloaded file here</li>
                </>}
                {uploadTab === "inventory" && <>
                  <li>Go to Shopify Admin → Products → Inventory</li>
                  <li>Click Export (top right)</li>
                  <li>Select: All variants</li>
                  <li>Select: Available quantities only</li>
                  <li>Upload the downloaded file here</li>
                </>}
                {uploadTab === "joor" && <>
                  <li>Log in to JOOR</li>
                  <li>Go to Orders or Inventory</li>
                  <li>Click Export → Flat File (CSV or Excel)</li>
                  <li>Select the season/linesheet you need</li>
                  <li>Upload the downloaded file here</li>
                </>}
              </ol>
            )}

            {loading && <p className="text-sm text-primary mt-3 animate-pulse">Analysing inventory...</p>}
            {error && <p className="text-sm text-destructive mt-3">{error}</p>}
          </section>
        )}

        {/* ═══ SCAN SUMMARY ═══ */}
        {parsed && analytics && (
          <>
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  <span className="text-sm font-medium">
                    {parsed.source === "joor" ? "JOOR" : "Shopify"} file: {fileName}
                  </span>
                </div>
                <button onClick={() => { setParsed(null); setAnalytics(null); setShowFirstUse(false); }}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {parsed.totalProducts} active products · {parsed.totalVariants} variants
                {parsed.archivedExcluded > 0 && ` · ${parsed.archivedExcluded} archived excluded`}
              </p>
            </div>

            {/* ═══ SUMMARY TILES ═══ */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Size holes", value: analytics.summary.productsWithHoles, sub: `of ${analytics.summary.totalProducts} products` },
                { label: "Sizes to fill", value: analytics.summary.totalHoles, sub: "need reorder" },
                { label: "Complete stockouts", value: analytics.summary.completeStockouts, sub: "full reorder" },
                { label: "Low stock", value: analytics.summary.lowStockVariants, sub: `≤ ${settings.lowStockThreshold} units` },
              ].map((tile, i) => (
                <div key={i} className="bg-card rounded-lg border border-border p-3">
                  <p className="text-2xl font-bold font-mono-data">{tile.value}</p>
                  <p className="text-xs font-medium mt-0.5">{tile.label}</p>
                  <p className="text-[10px] text-muted-foreground">{tile.sub}</p>
                </div>
              ))}
            </div>

            {/* ═══ FILTERS ═══ */}
            <div className="flex flex-wrap gap-2 items-center">
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
                className="h-8 rounded-md bg-input border border-border px-2 text-xs text-foreground">
                <option value="">All brands</option>
                {parsed.allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                className="h-8 rounded-md bg-input border border-border px-2 text-xs text-foreground">
                <option value="">All types</option>
                {parsed.allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex gap-1">
                {(["urgent", "soon", "monitor"] as const).map((u) => (
                  <button key={u} onClick={() => setUrgencyFilter(urgencyFilter === u ? "" : u)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      urgencyFilter === u ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                    {urgencyIcon(u)} {u === "urgent" ? `${analytics.summary.urgentCount}` : u === "soon" ? `${analytics.summary.soonCount}` : `${analytics.summary.monitorCount}`}
                  </button>
                ))}
              </div>
            </div>

            <Input placeholder="Search product name..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} className="h-9 text-sm" />

            {/* View toggle */}
            <div className="flex gap-1">
              {([
                { mode: "list" as const, icon: List, label: "List" },
                { mode: "grid" as const, icon: Grid, label: "Grid" },
                { mode: "brand" as const, icon: BarChart3, label: "Brand" },
              ]).map(({ mode, icon: Icon, label }) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    viewMode === mode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>
                  <Icon className="w-3 h-3" /> {label}
                </button>
              ))}
            </div>

            {/* ═══ LIST VIEW ═══ */}
            {viewMode === "list" && (
              <div className="space-y-2">
                {filteredProducts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No flagged products match your filters</p>
                )}
                {filteredProducts.slice(0, 50).map((p) => (
                  <div key={p.productId} className="bg-card rounded-lg border border-border overflow-hidden">
                    <button onClick={() => setExpandedProduct(expandedProduct === p.productId ? null : p.productId)}
                      className="w-full px-4 py-3 text-left">
                      <div className="flex items-start gap-3">
                        <span className="text-sm font-mono-data shrink-0">{urgencyIcon(p.urgency)} {p.priorityScore}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{p.productName}</p>
                          <p className="text-xs text-muted-foreground">{p.brand} · {p.productType}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.issueLabel}</p>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${
                          expandedProduct === p.productId ? "rotate-90" : ""
                        }`} />
                      </div>
                    </button>

                    {expandedProduct === p.productId && (
                      <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left py-1 font-medium">Size</th>
                              <th className="text-right py-1 font-medium">Qty</th>
                              <th className="text-left py-1 pl-3 font-medium">Status</th>
                              <th className="text-right py-1 font-medium">Reorder</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {p.sizes.map((s) => (
                              <tr key={s.size}>
                                <td className="py-1.5 font-medium">{s.size}</td>
                                <td className="py-1.5 text-right font-mono-data">{s.qty}</td>
                                <td className="py-1.5 pl-3">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sizeStatusColor(s.status)}`}>
                                    {s.status === "sold_out" ? "❌ Sold out" : s.status === "low" ? "⚠ Low" : "✓ OK"}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right font-mono-data">
                                  {s.suggestedReorder > 0 ? `${s.suggestedReorder} units` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Button variant="teal" size="sm" onClick={() => addToReorder(p)} className="w-full text-xs">
                          <Plus className="w-3 h-3 mr-1" /> Add to reorder list
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ═══ GRID VIEW ═══ */}
            {viewMode === "grid" && (
              <div className="grid grid-cols-2 gap-3">
                {filteredProducts.slice(0, 40).map((p) => (
                  <div key={p.productId} className="bg-card rounded-lg border border-border p-3 space-y-2">
                    <p className="text-xs font-semibold truncate">{p.productName}</p>
                    <p className="text-[10px] text-muted-foreground">{p.brand}</p>
                    <div className="flex flex-wrap gap-1">
                      {p.sizes.map((s) => (
                        <span key={s.size} className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-mono-data font-semibold ${sizeStatusColor(s.status)}`}>
                          {s.size}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {urgencyIcon(p.urgency)} {p.holesCount} hole{p.holesCount !== 1 ? "s" : ""}
                    </p>
                    <button onClick={() => addToReorder(p)} className="text-[10px] text-primary font-medium">
                      + Add to reorder
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ BRAND VIEW ═══ */}
            {viewMode === "brand" && (
              <div className="space-y-3">
                {analytics.brands.map((bh) => (
                  <div key={bh.brand} className="bg-card rounded-lg border border-border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{bh.brand}</p>
                      <span className="text-sm font-mono-data font-bold">{bh.healthPercent}%</span>
                    </div>
                    <Progress value={bh.healthPercent} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {bh.soldOut} holes · {bh.completeStockouts} stockouts · {bh.lowStock} low
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => { setBrandFilter(bh.brand); setViewMode("list"); }}
                        className="text-xs text-primary font-medium">View details →</button>
                      <button onClick={() => addAllBrandToReorder(bh.brand)}
                        className="text-xs text-muted-foreground">Add all to reorder</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ REORDER DRAWER ═══ */}
        {showReorder && reorderItems.length > 0 && (
          <section className="bg-card rounded-lg border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                Reorder List ({reorderItems.length} lines)
              </h3>
              <button onClick={() => setShowReorder(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {reorderItems.map((item, idx) => (
                <div key={idx} className="py-2 flex items-center gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.productName}</p>
                    <p className="text-muted-foreground">{item.brand} · Size {item.size}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateReorderQty(idx, item.qty - 1)}
                      className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center font-mono-data">{item.qty}</span>
                    <button onClick={() => updateReorderQty(idx, item.qty + 1)}
                      className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {item.unitCost > 0 && (
                    <span className="text-muted-foreground font-mono-data w-16 text-right">
                      ${(item.qty * item.unitCost).toFixed(0)}
                    </span>
                  )}
                  <button onClick={() => removeReorderItem(idx)} className="text-muted-foreground">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>Total lines:</span><span className="font-mono-data">{reorderTotals.lines}</span></div>
              <div className="flex justify-between"><span>Total units:</span><span className="font-mono-data">{reorderTotals.units}</span></div>
              {reorderTotals.cost > 0 && (
                <div className="flex justify-between"><span>Total cost:</span><span className="font-mono-data">${reorderTotals.cost.toFixed(2)}</span></div>
              )}
              {reorderTotals.rrp > 0 && (
                <div className="flex justify-between"><span>Total RRP:</span><span className="font-mono-data">${reorderTotals.rrp.toFixed(2)}</span></div>
              )}
            </div>

            {/* Export buttons */}
            <div className="space-y-2">
              {reorderTotals.brands.map((brand) => (
                <div key={brand} className="flex gap-2">
                  <Button variant="amber" size="sm" className="flex-1 text-xs" onClick={() => handleDownloadJoor(brand)}>
                    <Download className="w-3 h-3 mr-1" /> {brand} JOOR file
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleCopyEmail(brand)}>
                    <Mail className="w-3 h-3 mr-1" /> Email
                  </Button>
                </div>
              ))}
            </div>

            <Button variant="ghost" size="sm" className="w-full text-xs text-destructive"
              onClick={() => { setReorderItems([]); setShowReorder(false); }}>
              Clear reorder list
            </Button>
          </section>
        )}
      </div>
    </div>
  );
};

export default RestockAnalytics;
