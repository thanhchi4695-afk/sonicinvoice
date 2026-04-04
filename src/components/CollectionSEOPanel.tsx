import { useState } from "react";
import { ChevronLeft, Sparkles, RefreshCw, Check, Copy, Search, Globe, ChevronDown, ChevronUp, ExternalLink, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { getCustomCollections, getSmartCollections, updateCollectionSEO, type ShopifyCollection } from "@/lib/shopify-api";
import { toast } from "sonner";

interface CollectionSEOResult {
  intro_text: string;
  seo_content: string;
  faq: { q: string; a: string }[];
  meta_title: string;
  meta_description: string;
  primary_keyword: string;
  secondary_keywords: string[];
  related_collections: string[];
  confidence_score: number;
  confidence_reason: string;
}

interface CollectionInput {
  id: string;
  shopifyId?: number;
  shopifyType?: "custom" | "smart";
  title: string;
  collection_type: string;
  products: { title: string }[];
  tags: string;
  vendor: string;
}

export default function CollectionSEOPanel({ onBack }: { onBack: () => void }) {
  const [collections, setCollections] = useState<CollectionInput[]>([]);
  const [results, setResults] = useState<Map<string, CollectionSEOResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushed, setPushed] = useState<Set<string>>(new Set());
  const [pushingAll, setPushingAll] = useState(false);
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0 });

  // Load collections from localStorage (same source as AutoCollectionBuilder)
  const loadFromLocal = () => {
    try {
      const raw = localStorage.getItem("sonic_scan_batch") || "[]";
      const products = JSON.parse(raw);
      if (!Array.isArray(products) || products.length === 0) {
        toast.error("No products found. Scan or import products first.");
        return;
      }

      // Group by product_type to create collection inputs
      const typeMap = new Map<string, CollectionInput>();
      products.forEach((p: any) => {
        const type = p.product_type || p.type || "General";
        if (!typeMap.has(type)) {
          typeMap.set(type, {
            id: `type-${type.toLowerCase().replace(/\s+/g, "-")}`,
            title: type,
            collection_type: "smart",
            products: [],
            tags: "",
            vendor: "",
          });
        }
        typeMap.get(type)!.products.push({ title: p.product_title || p.title || "" });
      });

      // Also group by vendor
      const vendorMap = new Map<string, CollectionInput>();
      products.forEach((p: any) => {
        const vendor = p.vendor || p.brand || "";
        if (!vendor) return;
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, {
            id: `vendor-${vendor.toLowerCase().replace(/\s+/g, "-")}`,
            title: `${vendor} Collection`,
            collection_type: "smart",
            products: [],
            tags: "",
            vendor,
          });
        }
        vendorMap.get(vendor)!.products.push({ title: p.product_title || p.title || "" });
      });

      const all = [...typeMap.values(), ...vendorMap.values()];
      setCollections(all);
      toast.success(`Found ${all.length} potential collections`);
    } catch {
      toast.error("Failed to load product data");
    }
  };

  const addManualCollection = () => {
    if (!manualTitle.trim()) return;
    const id = `manual-${Date.now()}`;
    setCollections(prev => [...prev, {
      id,
      title: manualTitle.trim(),
      collection_type: "custom",
      products: [],
      tags: "",
      vendor: "",
    }]);
    setManualTitle("");
  };

  const loadFromShopify = async () => {
    setLoading(true);
    try {
      const [custom, smart] = await Promise.all([getCustomCollections(), getSmartCollections()]);
      const mapped: CollectionInput[] = [
        ...custom.map(c => ({
          id: `shopify-custom-${c.id}`,
          shopifyId: c.id,
          shopifyType: "custom" as const,
          title: c.title,
          collection_type: "custom",
          products: [] as { title: string }[],
          tags: "",
          vendor: "",
        })),
        ...smart.map(c => ({
          id: `shopify-smart-${c.id}`,
          shopifyId: c.id,
          shopifyType: "smart" as const,
          title: c.title,
          collection_type: "smart",
          products: [] as { title: string }[],
          tags: "",
          vendor: "",
        })),
      ];
      setCollections(mapped);
      toast.success(`Loaded ${mapped.length} collections from Shopify`);
    } catch (e: any) {
      toast.error(e.message || "Failed to load collections from Shopify");
    } finally {
      setLoading(false);
    }
  };

  const pushSEOToShopify = async (colId: string) => {
    const col = collections.find(c => c.id === colId);
    const result = results.get(colId);
    if (!col || !result || !col.shopifyId || !col.shopifyType) {
      toast.error("This collection must be loaded from Shopify to push SEO");
      return;
    }
    setPushing(colId);
    try {
      const bodyHtml = `${result.intro_text}\n\n${result.seo_content}`;
      await updateCollectionSEO(col.shopifyId, col.shopifyType, {
        body_html: bodyHtml,
        meta_title: result.meta_title,
        meta_description: result.meta_description,
      });
      setPushed(prev => new Set(prev).add(colId));
      toast.success(`SEO pushed for "${col.title}"`);
    } catch (e: any) {
      toast.error(e.message || "Failed to push SEO");
    } finally {
      setPushing(null);
    }
  };

  const pushAllToShopify = async () => {
    const pushable = collections.filter(c => c.shopifyId && c.shopifyType && results.has(c.id) && !pushed.has(c.id));
    if (pushable.length === 0) {
      toast.error("No collections to push. Load from Shopify and generate SEO first.");
      return;
    }
    setPushingAll(true);
    setPushProgress({ done: 0, total: pushable.length });
    for (let i = 0; i < pushable.length; i++) {
      const col = pushable[i];
      const result = results.get(col.id)!;
      try {
        const bodyHtml = `${result.intro_text}\n\n${result.seo_content}`;
        await updateCollectionSEO(col.shopifyId!, col.shopifyType!, {
          body_html: bodyHtml,
          meta_title: result.meta_title,
          meta_description: result.meta_description,
        });
        setPushed(prev => new Set(prev).add(col.id));
      } catch (e: any) {
        console.error(`Failed to push SEO for ${col.title}:`, e);
      }
      setPushProgress({ done: i + 1, total: pushable.length });
      if (i < pushable.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    setPushingAll(false);
    toast.success("SEO pushed to all collections");
  };

  const generateSEO = async () => {
    if (collections.length === 0) {
      toast.error("Add collections first");
      return;
    }
    setGenerating(true);
    const config = getStoreConfig();
    const newResults = new Map<string, CollectionSEOResult>();
    const batchSize = 10;

    for (let i = 0; i < collections.length; i += batchSize) {
      const batch = collections.slice(i, i + batchSize);
      setProgress({ done: i, total: collections.length });

      try {
        const { data, error } = await supabase.functions.invoke("collection-seo", {
          body: {
            collections: batch.map(c => ({
              title: c.title,
              collection_type: c.collection_type,
              products: c.products.slice(0, 5),
              tags: c.tags,
              vendor: c.vendor,
            })),
            storeName: config.name,
            storeCity: config.city,
            locale: config.locale,
            industry: config.industry,
          },
        });
        if (error) throw error;
        const items = data?.results || [];
        batch.forEach((c, idx) => {
          if (items[idx]) newResults.set(c.id, items[idx]);
        });
      } catch (e: any) {
        console.error("Collection SEO batch error:", e);
        toast.error(e.message || "SEO generation failed");
      }
    }

    setResults(newResults);
    setProgress({ done: collections.length, total: collections.length });
    setGenerating(false);
    toast.success(`Generated SEO for ${newResults.size} collections`);
  };

  const copyHtml = (id: string, html: string) => {
    navigator.clipboard.writeText(html);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 85) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const removeCollection = (id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
    setResults(prev => { const n = new Map(prev); n.delete(id); return n; });
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">🔍 Collection SEO AI</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Turn every collection into a high-ranking Google landing page</p>

      {/* Stats */}
      {collections.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <p className="text-lg font-bold">{collections.length}</p>
            <p className="text-[10px] text-muted-foreground">Collections</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <p className="text-lg font-bold">{results.size}</p>
            <p className="text-[10px] text-muted-foreground">SEO Ready</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <p className="text-lg font-bold">
              {results.size > 0 ? Math.round([...results.values()].reduce((s, r) => s + r.confidence_score, 0) / results.size) : 0}%
            </p>
            <p className="text-[10px] text-muted-foreground">Avg Score</p>
          </div>
        </div>
      )}

      {/* Load & Add */}
      <div className="space-y-2 mb-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={loadFromLocal}>
            <Search className="w-3.5 h-3.5" /> From products
          </Button>
          <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={loadFromShopify} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            From Shopify
          </Button>
        </div>
        <div className="flex gap-2">
          <input
            value={manualTitle}
            onChange={e => setManualTitle(e.target.value)}
            placeholder="Add collection manually (e.g. Blue Dresses)"
            className="flex-1 h-9 rounded-md bg-input border border-border px-3 text-sm"
            onKeyDown={e => e.key === "Enter" && addManualCollection()}
          />
          <Button variant="outline" size="sm" className="h-9" onClick={addManualCollection}>Add</Button>
        </div>
      </div>

      {/* Generate button */}
      {collections.length > 0 && (
        <Button
          variant="default"
          className="w-full mb-4 gap-2"
          onClick={generateSEO}
          disabled={generating}
        >
          {generating ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Generating {progress.done}/{progress.total}</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Generate SEO for all collections</>
          )}
        </Button>
      )}

      {/* Push All to Shopify */}
      {results.size > 0 && collections.some(c => c.shopifyId) && (
        <Button
          variant="default"
          className="w-full mb-4 gap-2"
          onClick={pushAllToShopify}
          disabled={pushingAll || generating}
        >
          {pushingAll ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Pushing {pushProgress.done}/{pushProgress.total}</>
          ) : (
            <><Upload className="w-4 h-4" /> Push SEO to Shopify ({results.size} collections)</>
          )}
        </Button>
      )}

      {/* Collection list */}
      <div className="space-y-2">
        {collections.map(col => {
          const result = results.get(col.id);
          const isExpanded = expanded === col.id;

          return (
            <div key={col.id} className="bg-card rounded-lg border border-border overflow-hidden">
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 p-3 text-left"
                onClick={() => setExpanded(isExpanded ? null : col.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{col.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {col.collection_type} · {col.products.length} products
                    {col.vendor && ` · ${col.vendor}`}
                  </p>
                </div>
                {result && (
                  <span className={`text-xs font-bold ${getConfidenceColor(result.confidence_score)}`}>
                    {result.confidence_score}%
                  </span>
                )}
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>

              {/* Expanded result */}
              {isExpanded && result && (
                <div className="border-t border-border p-3 space-y-3">
                  {/* Google preview */}
                  <div className="bg-background border border-border rounded-lg p-2.5">
                    <p className="text-[10px] text-muted-foreground mb-1">Google Preview</p>
                    <p className="text-sm text-[#1a0dab] font-medium leading-snug truncate">{result.meta_title}</p>
                    <p className="text-[11px] text-[#006621] truncate">sonicinvoice.lovable.app › collections</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{result.meta_description}</p>
                  </div>

                  {/* Meta */}
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Meta Title ({result.meta_title.length} chars)</p>
                    <p className="text-xs">{result.meta_title}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Meta Description ({result.meta_description.length} chars)</p>
                    <p className="text-xs">{result.meta_description}</p>
                  </div>

                  {/* Intro */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-[9px] font-semibold text-muted-foreground">Intro (above products)</p>
                      <button onClick={() => copyHtml(col.id + "-intro", result.intro_text)} className="text-[9px] text-primary flex items-center gap-0.5">
                        {copiedId === col.id + "-intro" ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                        {copiedId === col.id + "-intro" ? "Copied" : "Copy HTML"}
                      </button>
                    </div>
                    <div className="text-xs bg-muted/50 rounded p-2 prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: result.intro_text }} />
                  </div>

                  {/* SEO Content */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-[9px] font-semibold text-muted-foreground">SEO Content (below products)</p>
                      <button onClick={() => copyHtml(col.id + "-seo", result.seo_content)} className="text-[9px] text-primary flex items-center gap-0.5">
                        {copiedId === col.id + "-seo" ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                        {copiedId === col.id + "-seo" ? "Copied" : "Copy HTML"}
                      </button>
                    </div>
                    <div className="text-xs bg-muted/50 rounded p-2 prose prose-xs max-w-none max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: result.seo_content }} />
                  </div>

                  {/* Keywords */}
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground mb-1">Keywords</p>
                    <div className="flex flex-wrap gap-1">
                      <span className="px-1.5 py-0.5 text-[9px] bg-primary/10 text-primary rounded font-semibold">{result.primary_keyword}</span>
                      {result.secondary_keywords.map((k, i) => (
                        <span key={i} className="px-1.5 py-0.5 text-[9px] bg-muted rounded text-muted-foreground">{k}</span>
                      ))}
                    </div>
                  </div>

                  {/* FAQ */}
                  {result.faq.length > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold text-muted-foreground mb-1">FAQ Section</p>
                      <div className="space-y-1.5">
                        {result.faq.map((f, i) => (
                          <div key={i} className="bg-muted/50 rounded p-2">
                            <p className="text-[11px] font-semibold">Q: {f.q}</p>
                            <p className="text-[11px] text-muted-foreground">A: {f.a}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Related collections */}
                  {result.related_collections.length > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold text-muted-foreground mb-1">Related Collections</p>
                      <div className="flex flex-wrap gap-1">
                        {result.related_collections.map((r, i) => (
                          <span key={i} className="px-1.5 py-0.5 text-[9px] bg-muted rounded text-muted-foreground flex items-center gap-0.5">
                            <ExternalLink className="w-2 h-2" /> {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Confidence */}
                  <div className="pt-1 border-t border-border">
                    <p className="text-[9px] text-muted-foreground">
                      Confidence: <span className={`font-bold ${getConfidenceColor(result.confidence_score)}`}>{result.confidence_score}%</span> · {result.confidence_reason}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={() => {
                      copyHtml(col.id + "-all", `${result.intro_text}\n\n${result.seo_content}`);
                      toast.success("All HTML copied");
                    }}>
                      <Copy className="w-3 h-3" /> Copy All HTML
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs px-3" onClick={() => removeCollection(col.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {/* Collapsed - no result yet */}
              {isExpanded && !result && (
                <div className="border-t border-border p-3">
                  <p className="text-xs text-muted-foreground">Click "Generate SEO" above to create content for this collection.</p>
                  <Button size="sm" variant="destructive" className="h-7 text-xs mt-2" onClick={() => removeCollection(col.id)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {collections.length === 0 && (
        <div className="text-center py-12">
          <Globe className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No collections loaded</p>
          <p className="text-xs text-muted-foreground mt-1">Load from products or add manually</p>
        </div>
      )}
    </div>
  );
}
