import { useState, useEffect } from "react";
import { ChevronLeft, Sparkles, Plus, Check, X, Eye, Loader2, AlertTriangle, ShoppingBag, Brain, Zap, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getSmartCollections,
  getCustomCollections,
  createSmartCollection,
  createCollectionGraphQL,
  type ShopifyCollection,
  type GraphQLCollectionInput,
} from "@/lib/shopify-api";

/* ─── Types ─── */
interface CollectionSuggestion {
  id: string;
  title: string;
  handle: string;
  type: "by_type" | "by_attribute" | "by_vendor" | "by_price" | "brand" | "style" | "category" | "style_category" | "feature" | "broad_category" | "colour" | "print_story" | "seasonal";
  rules: { column: string; relation: string; condition: string }[];
  disjunctive: boolean;
  matchingProducts: number;
  sampleProducts: string[];
  confidence: number;
  reason: string;
  seoTitle: string;
  seoDescription: string;
  bodyContent?: string;
  internalLinksTo?: string[];
  duplicate: boolean;
  duplicateOf?: string;
}

interface ProductData {
  title: string;
  product_type: string;
  vendor: string;
  tags: string[];
  price: number;
}

/* ─── Helpers ─── */
function toHandle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getConfidenceColor(c: number) {
  if (c >= 80) return "bg-success/10 text-success border-success/20";
  if (c >= 50) return "bg-warning/10 text-warning border-warning/20";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

function getConfidenceLabel(c: number) {
  if (c >= 80) return "High";
  if (c >= 50) return "Medium";
  return "Low";
}

function getTypeLabel(t: string) {
  switch (t) {
    case "by_type": return "Product Type";
    case "by_attribute": return "Attribute";
    case "by_vendor": return "Vendor";
    case "by_price": return "Price Range";
    case "brand": return "Brand";
    case "style": return "Style";
    case "category": return "Category";
    case "style_category": return "Style+Category";
    case "feature": return "Feature";
    case "broad_category": return "Broad Category";
    case "colour": return "Colour";
    case "print_story": return "Print/Story";
    case "seasonal": return "Seasonal";
    default: return t;
  }
}

/* ─── Generation engine ─── */
function generateSuggestions(
  products: ProductData[],
  existingTitles: Set<string>
): CollectionSuggestion[] {
  const suggestions: CollectionSuggestion[] = [];
  const seen = new Set<string>();

  const add = (s: Omit<CollectionSuggestion, "id" | "duplicate" | "duplicateOf">) => {
    if (seen.has(s.handle) || s.matchingProducts === 0) return;
    seen.add(s.handle);
    const dup = existingTitles.has(s.title.toLowerCase());
    suggestions.push({
      ...s,
      id: crypto.randomUUID(),
      duplicate: dup,
      duplicateOf: dup ? s.title : undefined,
    });
  };

  // 1. By product type
  const typeCounts = new Map<string, ProductData[]>();
  products.forEach((p) => {
    const t = p.product_type?.trim();
    if (t) {
      if (!typeCounts.has(t)) typeCounts.set(t, []);
      typeCounts.get(t)!.push(p);
    }
  });
  typeCounts.forEach((prods, type) => {
    add({
      title: type,
      handle: toHandle(type),
      type: "by_type",
      rules: [{ column: "type", relation: "equals", condition: type }],
      disjunctive: false,
      matchingProducts: prods.length,
      sampleProducts: prods.slice(0, 3).map((p) => p.title),
      confidence: prods.length >= 3 ? 95 : prods.length >= 2 ? 80 : 60,
      reason: `${prods.length} products match type "${type}"`,
      seoTitle: `${type} | Shop Our Collection`,
      seoDescription: `Browse our curated selection of ${type.toLowerCase()}. Find the perfect style for every occasion.`,
    });
  });

  // 2. By vendor
  const vendorCounts = new Map<string, ProductData[]>();
  products.forEach((p) => {
    const v = p.vendor?.trim();
    if (v) {
      if (!vendorCounts.has(v)) vendorCounts.set(v, []);
      vendorCounts.get(v)!.push(p);
    }
  });
  vendorCounts.forEach((prods, vendor) => {
    add({
      title: `${vendor} Collection`,
      handle: toHandle(`${vendor}-collection`),
      type: "by_vendor",
      rules: [{ column: "vendor", relation: "equals", condition: vendor }],
      disjunctive: false,
      matchingProducts: prods.length,
      sampleProducts: prods.slice(0, 3).map((p) => p.title),
      confidence: prods.length >= 3 ? 90 : 70,
      reason: `${prods.length} products from vendor "${vendor}"`,
      seoTitle: `${vendor} | Shop the Brand`,
      seoDescription: `Explore the latest from ${vendor}. Discover styles you'll love.`,
    });
  });

  // 3. By tag (attribute)
  const tagCounts = new Map<string, ProductData[]>();
  products.forEach((p) => {
    p.tags?.forEach((tag) => {
      const t = tag.trim();
      if (t && t.length > 1) {
        if (!tagCounts.has(t)) tagCounts.set(t, []);
        tagCounts.get(t)!.push(p);
      }
    });
  });
  // Only tags with 2+ products
  tagCounts.forEach((prods, tag) => {
    if (prods.length < 2) return;
    // Skip generic single-word tags that overlap with types
    if (typeCounts.has(tag)) return;
    add({
      title: tag,
      handle: toHandle(tag),
      type: "by_attribute",
      rules: [{ column: "tag", relation: "equals", condition: tag }],
      disjunctive: false,
      matchingProducts: prods.length,
      sampleProducts: prods.slice(0, 3).map((p) => p.title),
      confidence: prods.length >= 5 ? 85 : prods.length >= 3 ? 75 : 55,
      reason: `${prods.length} products tagged "${tag}"`,
      seoTitle: `${tag} | Shop Now`,
      seoDescription: `Browse our ${tag.toLowerCase()} collection. Curated styles for every taste.`,
    });
  });

  // 4. By price range
  const priceRanges = [
    { label: "Under $50", handle: "under-50", max: 50 },
    { label: "$50–$100", handle: "50-to-100", min: 50, max: 100 },
    { label: "Premium Collection", handle: "premium-collection", min: 100 },
  ];
  priceRanges.forEach(({ label, handle, min, max }) => {
    const matching = products.filter((p) => {
      if (min !== undefined && p.price < min) return false;
      if (max !== undefined && p.price >= max) return false;
      return true;
    });
    if (matching.length < 2) return;
    const rules: { column: string; relation: string; condition: string }[] = [];
    if (min !== undefined) rules.push({ column: "variant_price", relation: "greater_than", condition: String(min) });
    if (max !== undefined) rules.push({ column: "variant_price", relation: "less_than", condition: String(max) });
    add({
      title: label,
      handle,
      type: "by_price",
      rules,
      disjunctive: false,
      matchingProducts: matching.length,
      sampleProducts: matching.slice(0, 3).map((p) => p.title),
      confidence: matching.length >= 5 ? 80 : 60,
      reason: `${matching.length} products in this price range`,
      seoTitle: `${label} | Shop Affordable Styles`,
      seoDescription: `Discover great products ${label.toLowerCase()}. Quality styles at every price point.`,
    });
  });

  // Sort: non-duplicates first, then by confidence
  return suggestions.sort((a, b) => {
    if (a.duplicate !== b.duplicate) return a.duplicate ? 1 : -1;
    return b.confidence - a.confidence;
  });
}

/* ─── Main Component ─── */
export default function AutoCollectionBuilder({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"quick" | "architect">("architect");
  const [step, setStep] = useState<"input" | "review" | "creating" | "done">("input");
  const [products, setProducts] = useState<ProductData[]>([]);
  const [suggestions, setSuggestions] = useState<CollectionSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ title: string; ok: boolean; error?: string }[]>([]);
  const [filterType, setFilterType] = useState<string>("all");

  // Load products from localStorage (batch review / scan mode data)
  useEffect(() => {
    const sources = ["batch_review_products", "scan_items", "invoice_products"];
    const all: ProductData[] = [];
    sources.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) return;
        items.forEach((item: any) => {
          all.push({
            title: item.title || item.product_title || "",
            product_type: item.product_type || item.type || "",
            vendor: item.vendor || "",
            tags: Array.isArray(item.tags) ? item.tags : typeof item.tags === "string" ? item.tags.split(",").map((t: string) => t.trim()) : [],
            price: parseFloat(item.price || item.retail_price || "0") || 0,
          });
        });
      } catch {}
    });
    setProducts(all);
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Fetch existing collections to detect duplicates
      const existingTitles = new Set<string>();
      try {
        const [smart, custom] = await Promise.all([getSmartCollections(), getCustomCollections()]);
        [...smart, ...custom].forEach((c) => existingTitles.add(c.title.toLowerCase()));
      } catch {
        // Offline or no connection — continue without duplicate check
      }

      if (mode === "architect") {
        // AI-powered hierarchical collection generation
        const storeConfig = JSON.parse(localStorage.getItem("store_config") || "{}");
        const { data, error } = await supabase.functions.invoke("collection-architect", {
          body: {
            products: products.slice(0, 20),
            storeName: storeConfig.storeName || storeConfig.store_name,
            storeCity: storeConfig.storeCity || storeConfig.city,
            industry: storeConfig.industry || "swimwear",
            locale: storeConfig.locale || "AU",
          },
        });
        if (error) throw error;

        const aiCollections: CollectionSuggestion[] = (data.collections || []).map((c: any) => {
          const dup = existingTitles.has((c.title || "").toLowerCase());
          return {
            id: crypto.randomUUID(),
            title: c.title || "",
            handle: c.handle || "",
            type: c.type || "feature",
            rules: Array.isArray(c.smart_collection_rules)
              ? c.smart_collection_rules
              : [{ column: "tag", relation: "contains", condition: c.handle || "" }],
            disjunctive: c.disjunctive ?? true,
            matchingProducts: 0,
            sampleProducts: [],
            confidence: 85,
            reason: `AI-generated ${c.type || "collection"} for SEO hierarchy`,
            seoTitle: c.seo_title || c.title || "",
            seoDescription: c.meta_description || "",
            bodyContent: c.body_content || "",
            internalLinksTo: c.internal_links_to || [],
            duplicate: dup,
            duplicateOf: dup ? c.title : undefined,
          };
        });

        setSuggestions(aiCollections);
        const preSelected = new Set<string>();
        aiCollections.forEach((s) => {
          if (!s.duplicate) preSelected.add(s.id);
        });
        setSelected(preSelected);
      } else {
        // Quick local generation
        const result = generateSuggestions(products, existingTitles);
        setSuggestions(result);
        const preSelected = new Set<string>();
        result.forEach((s) => {
          if (!s.duplicate && s.confidence >= 70) preSelected.add(s.id);
        });
        setSelected(preSelected);
      }
      setStep("review");
    } catch (err: any) {
      toast.error("Failed to generate: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSelected = async () => {
    const toCreate = suggestions.filter((s) => selected.has(s.id));
    if (toCreate.length === 0) return;
    setCreating(true);
    setStep("creating");
    setProgress(0);
    const res: { title: string; ok: boolean; error?: string }[] = [];

    for (let i = 0; i < toCreate.length; i++) {
      const s = toCreate[i];
      try {
        const isArchitectType = ["brand","style","category","style_category","feature","broad_category","colour","print_story","seasonal"].includes(s.type);
        
        if (isArchitectType && s.rules.length > 0) {
          // Use GraphQL for architect collections — supports ruleSet, SEO, metafields
          const gqlInput: GraphQLCollectionInput = {
            title: s.title,
            handle: s.handle,
            descriptionHtml: s.bodyContent || `<p>${s.seoDescription}</p>`,
            seo: { title: s.seoTitle, description: s.seoDescription },
            ruleSet: {
              appliedDisjunctively: s.disjunctive,
              rules: s.rules,
            },
          };
          await createCollectionGraphQL(gqlInput);
        } else {
          // REST API for quick-mode collections
          await createSmartCollection({
            title: s.title,
            rules: s.rules,
            disjunctive: s.disjunctive,
            body_html: s.bodyContent || `<p>${s.seoDescription}</p>`,
            metafields_global_title_tag: s.seoTitle,
            metafields_global_description_tag: s.seoDescription,
          });
        }
        res.push({ title: s.title, ok: true });
      } catch (err: any) {
        res.push({ title: s.title, ok: false, error: err?.message || "Unknown error" });
      }
      setProgress(Math.round(((i + 1) / toCreate.length) * 100));
      if (i < toCreate.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    setResults(res);
    setCreating(false);
    setStep("done");
    const ok = res.filter((r) => r.ok).length;
    const fail = res.filter((r) => !r.ok).length;
    toast.success(`Created ${ok} collection${ok !== 1 ? "s" : ""}${fail ? `, ${fail} failed` : ""}`);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const filtered = getFiltered();
    const allSelected = filtered.every((s) => selected.has(s.id));
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((s) => (allSelected ? next.delete(s.id) : next.add(s.id)));
      return next;
    });
  };

  const getFiltered = () => {
    if (filterType === "all") return suggestions;
    return suggestions.filter((s) => s.type === filterType);
  };

  const filtered = getFiltered();
  const types = [...new Set(suggestions.map((s) => s.type))];

  /* ─── Input step ─── */
  if (step === "input") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">🗂️ Auto Collection Builder</h2>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setMode("architect")}
            className={`p-3 rounded-xl border text-left transition-all ${mode === "architect" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}
          >
            <Brain className={`w-5 h-5 mb-1 ${mode === "architect" ? "text-primary" : "text-muted-foreground"}`} />
            <p className="text-xs font-semibold">SEO Architect</p>
            <p className="text-[10px] text-muted-foreground">AI hierarchy with internal linking, 8-15 collections per product</p>
          </button>
          <button
            onClick={() => setMode("quick")}
            className={`p-3 rounded-xl border text-left transition-all ${mode === "quick" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}
          >
            <Zap className={`w-5 h-5 mb-1 ${mode === "quick" ? "text-primary" : "text-muted-foreground"}`} />
            <p className="text-xs font-semibold">Quick Build</p>
            <p className="text-[10px] text-muted-foreground">Local rules-based: type, vendor, tag, price</p>
          </button>
        </div>

        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                {mode === "architect" ? <Brain className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
              </div>
              <div>
                <p className="text-sm font-semibold">{mode === "architect" ? "Collection Architect" : "Quick Collection Builder"}</p>
                <p className="text-xs text-muted-foreground">
                  {mode === "architect"
                    ? "Generates SEO hierarchy: brand → style → category → feature → colour collections with internal linking"
                    : "Analyses types, vendors, tags & prices for smart collection rules"}
                </p>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 mb-4 border border-border">
              <p className="text-xs font-medium mb-1">Products loaded: {products.length}</p>
              {products.length === 0 && (
                <p className="text-xs text-destructive">No product data found. Process an invoice or use Scan Mode first.</p>
              )}
              {products.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Types: {new Set(products.map((p) => p.product_type).filter(Boolean)).size}</p>
                  <p>Vendors: {new Set(products.map((p) => p.vendor).filter(Boolean)).size}</p>
                  <p>Unique tags: {new Set(products.flatMap((p) => p.tags)).size}</p>
                </div>
              )}
            </div>
            <Button
              onClick={handleGenerate}
              disabled={products.length === 0 || loading}
              className="w-full"
              variant="teal"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />{mode === "architect" ? "AI building hierarchy..." : "Analyzing products..."}</>
              ) : (
                <>{mode === "architect" ? <Brain className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}{mode === "architect" ? "Build SEO Collection Hierarchy" : "Generate Collections"}</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Creating step ─── */
  if (step === "creating") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-semibold font-display">Creating Collections…</h2>
        </div>
        <Card>
          <CardContent className="p-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm font-medium mb-2">Publishing to Shopify</p>
            <Progress value={progress} className="h-2 mb-2" />
            <p className="text-xs text-muted-foreground">{progress}% complete</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Done step ─── */
  if (step === "done") {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">✅ Collections Created</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-success">{ok.length}</p><p className="text-xs text-muted-foreground">Created</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-destructive">{failed.length}</p><p className="text-xs text-muted-foreground">Failed</p></CardContent></Card>
        </div>
        <div className="space-y-2 mb-4">
          {results.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${r.ok ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"}`}>
              {r.ok ? <Check className="w-4 h-4 text-success shrink-0" /> : <X className="w-4 h-4 text-destructive shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                {r.error && <p className="text-xs text-destructive">{r.error}</p>}
              </div>
            </div>
          ))}
        </div>
        <Button onClick={onBack} className="w-full" variant="outline">Done</Button>
      </div>
    );
  }

  /* ─── Review step ─── */
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setStep("input")} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Suggested Collections</h2>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Card><CardContent className="p-2 text-center"><p className="text-lg font-bold">{suggestions.length}</p><p className="text-[10px] text-muted-foreground">Total</p></CardContent></Card>
        <Card><CardContent className="p-2 text-center"><p className="text-lg font-bold text-primary">{selected.size}</p><p className="text-[10px] text-muted-foreground">Selected</p></CardContent></Card>
        <Card><CardContent className="p-2 text-center"><p className="text-lg font-bold text-warning">{suggestions.filter((s) => s.duplicate).length}</p><p className="text-[10px] text-muted-foreground">Duplicates</p></CardContent></Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        <button onClick={() => setFilterType("all")} className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${filterType === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>
          All ({suggestions.length})
        </button>
        {types.map((t) => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${filterType === t ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border"}`}>
            {getTypeLabel(t)} ({suggestions.filter((s) => s.type === t).length})
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAll}>
          {filtered.every((s) => selected.has(s.id)) ? "Deselect all" : "Select all"}
        </Button>
        <div className="flex-1" />
        <Button
          variant="teal"
          size="sm"
          className="text-xs h-8"
          disabled={selected.size === 0}
          onClick={handleCreateSelected}
        >
          <Plus className="w-3 h-3 mr-1" />Create {selected.size} collection{selected.size !== 1 ? "s" : ""}
        </Button>
      </div>

      {/* Collection cards */}
      <div className="space-y-2">
        {filtered.map((s) => (
          <Card key={s.id} className={`transition-all ${s.duplicate ? "opacity-60" : ""}`}>
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={selected.has(s.id)}
                  onCheckedChange={() => toggleSelect(s.id)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-semibold">{s.title}</p>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">{getTypeLabel(s.type)}</Badge>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${getConfidenceColor(s.confidence)}`}>
                      {s.confidence}% {getConfidenceLabel(s.confidence)}
                    </span>
                    {s.duplicate && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20 font-medium flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" /> Duplicate
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{s.reason}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShoppingBag className="w-3 h-3" /> {s.matchingProducts} products
                    <button
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="ml-auto text-primary text-[10px] flex items-center gap-0.5"
                    >
                      <Eye className="w-3 h-3" /> {expandedId === s.id ? "Hide" : "Preview"}
                    </button>
                  </div>

                  {expandedId === s.id && (
                    <div className="mt-2 pt-2 border-t border-border space-y-2 animate-fade-in">
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Rules</p>
                        {s.rules.map((r, i) => (
                          <p key={i} className="text-xs font-mono bg-muted/50 rounded px-2 py-0.5 mb-0.5">
                            {r.column} {r.relation} "{r.condition}"
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">SEO</p>
                        <p className="text-xs">{s.seoTitle}</p>
                        <p className="text-[10px] text-muted-foreground">{s.seoDescription}</p>
                      </div>
                      {s.sampleProducts.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Sample Products</p>
                          {s.sampleProducts.map((p, i) => (
                            <p key={i} className="text-xs text-muted-foreground">• {p}</p>
                          ))}
                        </div>
                      )}
                      {s.bodyContent && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">SEO Body Content</p>
                          <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 max-h-32 overflow-y-auto prose prose-xs" dangerouslySetInnerHTML={{ __html: s.bodyContent.slice(0, 500) + (s.bodyContent.length > 500 ? "…" : "") }} />
                        </div>
                      )}
                      {s.internalLinksTo && s.internalLinksTo.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5 flex items-center gap-1"><Link className="w-3 h-3" /> Internal Links</p>
                          <div className="flex flex-wrap gap-1">
                            {s.internalLinksTo.map((h, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">/{h}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No suggestions in this category
        </div>
      )}
    </div>
  );
}
