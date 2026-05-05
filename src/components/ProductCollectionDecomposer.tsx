import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Layers, Sparkles, ExternalLink, RefreshCw, Check, Search, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { createCollectionGraphQL } from "@/lib/shopify-api";
import { toast } from "sonner";

type LevelLabel =
  | "brand" | "brand_story" | "category" | "sub_category"
  | "modified_sub_category" | "feature" | "cross_reference";

interface DecomposedCollection {
  title: string;
  handle: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  level_label: LevelLabel;
  rule_column: "tag" | "title" | "vendor" | "product_type";
  rule_relation: "equals" | "contains" | "starts_with";
  rule_condition: string;
  is_new: boolean;
  seo_title: string;
  meta_description: string;
  rationale: string;
  product_ids: string[];
  selected: boolean;
}

interface InProduct {
  title: string;
  vendor: string;
  product_type: string;
  tags: string;
  handle: string;
  product_id: string;
}

interface Props {
  onBack: () => void;
  initialProducts?: InProduct[];
  invoiceLabel?: string;
  onOpenCollectionSEO?: (handles: string[]) => void;
}

const LEVEL_GROUPS: { label: string; labels: LevelLabel[] }[] = [
  { label: "Brand collections", labels: ["brand"] },
  { label: "Brand Story collections", labels: ["brand_story"] },
  { label: "Category collections", labels: ["category"] },
  { label: "Sub-category collections", labels: ["sub_category"] },
  { label: "Modified sub-category collections", labels: ["modified_sub_category"] },
  { label: "Feature collections", labels: ["feature"] },
  { label: "Cross-reference collections", labels: ["cross_reference"] },
];

function loadProductsFromLocalStorage(): InProduct[] {
  const keys = ["invoice_lines", "batch_review_products", "sonic_scan_batch", "scan_items"];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        return items.map((p: any, i: number) => ({
          title: p.title || p.name || p.product_title || "",
          vendor: p.vendor || p.brand || p.supplier || "",
          product_type: p.product_type || p.type || p.category || "",
          tags: Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || ""),
          handle: p.handle || "",
          product_id: String(p.product_id || p.id || `local-${i}`),
        })).filter(p => p.title);
      }
    } catch { /* */ }
  }
  return [];
}

interface CatalogSuggestion {
  title: string;
  handle: string;
  level: "brand" | "brand_story" | "category" | "brand_category" | "feature";
  priority: "high" | "medium" | "low";
  estimated_products: number;
  rule_column: "tag" | "vendor" | "title" | "product_type";
  rule_relation: "equals" | "contains" | "starts_with";
  rule_condition: string;
  seo_title: string;
  meta_description: string;
  rationale: string;
  selected: boolean;
}

interface EmptyCollection {
  id: string | number;
  title: string;
  handle: string;
  kind: "custom" | "smart";
  products_count: number;
  recommendation: "delete" | "keep" | "fix_rules";
}

interface GapStats {
  brands_without_collection?: number;
  style_lines_without_collection?: number;
  feature_gaps?: string[];
  total_products_uncollected?: number;
}

export default function ProductCollectionDecomposer({
  onBack, initialProducts, invoiceLabel, onOpenCollectionSEO,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [tab, setTab] = useState<"invoice" | "paste" | "catalog">(initialProducts?.length ? "invoice" : "invoice");
  const [products, setProducts] = useState<InProduct[]>(initialProducts ?? []);
  const [pasteText, setPasteText] = useState("");
  const [pasteVendor, setPasteVendor] = useState("");
  const [pasteType, setPasteType] = useState("");
  const [loadedLabel, setLoadedLabel] = useState(invoiceLabel || "");

  const [analysing, setAnalysing] = useState(false);
  const [collections, setCollections] = useState<DecomposedCollection[]>([]);
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);

  // Catalog-scan state
  const [scanMode, setScanMode] = useState<"full" | "brand" | "type">("full");
  const [scanVendor, setScanVendor] = useState("");
  const [scanType, setScanType] = useState("");
  const [scanProgress, setScanProgress] = useState<string[]>([]);
  const [isCatalogScan, setIsCatalogScan] = useState(false);
  const [catalogSuggestions, setCatalogSuggestions] = useState<CatalogSuggestion[]>([]);
  const [emptyCollections, setEmptyCollections] = useState<EmptyCollection[]>([]);
  const [gapStats, setGapStats] = useState<GapStats>({});
  const [scanStats, setScanStats] = useState<{ total_existing_collections?: number; unique_products?: number; unique_brands?: number }>({});
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low" | "feature" | "brand">("all");
  const [deletingEmpty, setDeletingEmpty] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState(0);
  const [pushResults, setPushResults] = useState<{ handle: string; title: string; ok: boolean; shopifyId?: string; error?: string }[]>([]);

  // ── Step 1 helpers ──
  const loadFromCurrentInvoice = () => {
    const items = loadProductsFromLocalStorage();
    if (items.length === 0) {
      toast.error("No invoice products found in this session.");
      return;
    }
    setProducts(items);
    setLoadedLabel(`${items.length} products from current invoice session`);
  };

  const loadFromPaste = () => {
    const lines = pasteText.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste at least one product title.");
      return;
    }
    if (!pasteVendor.trim()) {
      toast.error("Enter the vendor.");
      return;
    }
    const items: InProduct[] = lines.map((title, i) => ({
      title,
      vendor: pasteVendor.trim(),
      product_type: pasteType.trim(),
      tags: "",
      handle: "",
      product_id: `paste-${i}`,
    }));
    setProducts(items);
    setLoadedLabel(`${items.length} pasted products`);
  };

  const analyse = async () => {
    if (products.length === 0) {
      toast.error("Load some products first.");
      return;
    }
    setAnalysing(true);
    setStep(2);
    try {
      // Pull existing handles from collection_memory
      const { data: { user } } = await supabase.auth.getUser();
      let existing: string[] = [];
      if (user) {
        const { data } = await supabase
          .from("collection_memory")
          .select("collection_handle")
          .eq("user_id", user.id);
        existing = ((data ?? []) as { collection_handle: string }[]).map(r => r.collection_handle);
      }

      const storeConfig = (() => {
        try { return JSON.parse(localStorage.getItem("store_config_sonic_invoice") || "{}"); }
        catch { return {}; }
      })();

      // Only send first 30 products to AI — enough to detect all collection
      // patterns. The AI extrapolates the pattern from a sample, not from
      // every variant. Keeps us under the 60s Gemini gateway timeout.
      const sampleProducts = products.slice(0, 30);
      const { data, error } = await supabase.functions.invoke("decompose-product-collections", {
        body: {
          products: sampleProducts,
          store_name: storeConfig.store_name || "Splash Swimwear",
          store_city: storeConfig.store_city || "Darwin",
          existing_collection_handles: existing,
        },
      });
      if (error) throw error;
      const list: DecomposedCollection[] = (data?.collections ?? []).map((c: any) => ({
        ...c,
        selected: !!c.is_new,
      }));
      setCollections(list);
      if (list.length > 0) setSelectedHandle(list[0].handle);
    } catch (e: any) {
      toast.error(e?.message || "Failed to analyse collections.");
      setStep(1);
    } finally {
      setAnalysing(false);
    }
  };

  // ── Catalog gap scan (Mode: full / brand / type) ──
  const runCatalogScan = async () => {
    setIsCatalogScan(true);
    setAnalysing(true);
    setStep(2);
    setCatalogSuggestions([]);
    setEmptyCollections([]);
    setGapStats({});
    setScanStats({});
    setScanProgress(["Fetching existing collections…"]);

    const storeConfig = (() => {
      try { return JSON.parse(localStorage.getItem("store_config_sonic_invoice") || "{}"); }
      catch { return {}; }
    })();

    try {
      // Animate progress steps while AI runs
      const steps = [
        "Fetching existing collections…",
        "Loading in-stock products…",
        "Identifying style lines…",
        "AI gap analysis…",
        "Building suggestions…",
      ];
      let stepIdx = 0;
      const interval = setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1);
        setScanProgress(steps.slice(0, stepIdx + 1));
      }, 6000);

      const { data, error } = await supabase.functions.invoke("catalog-collection-audit", {
        body: {
          store_name: storeConfig.store_name || "Splash Swimwear",
          store_city: storeConfig.store_city || "Darwin",
          mode: scanMode,
          filter_vendor: scanMode === "brand" ? scanVendor : undefined,
          filter_type: scanMode === "type" ? scanType : undefined,
          max_products: 800,
        },
      });
      clearInterval(interval);
      setScanProgress(steps);

      if (error) throw error;

      const suggestions: CatalogSuggestion[] = (data?.suggested_collections ?? []).map((s: any) => ({
        ...s,
        selected: s.priority === "high",
      }));
      setCatalogSuggestions(suggestions);
      setEmptyCollections(data?.empty_collections ?? []);
      setGapStats(data?.gap_analysis ?? {});
      setScanStats(data?.stats ?? {});
      try {
        localStorage.setItem("catalog_audit_last_run", new Date().toISOString());
        localStorage.setItem("catalog_audit_last_count", String(suggestions.length));
      } catch { /* */ }
      toast.success(`${suggestions.length} collection gaps identified`);
    } catch (e: any) {
      toast.error(e?.message || "Catalog scan failed");
      setStep(1);
      setIsCatalogScan(false);
    } finally {
      setAnalysing(false);
    }
  };

  const toggleSuggestion = (handle: string, value: boolean) => {
    setCatalogSuggestions(prev => prev.map(s => s.handle === handle ? { ...s, selected: value } : s));
  };

  const filteredSuggestions = useMemo(() => {
    if (priorityFilter === "all") return catalogSuggestions;
    if (priorityFilter === "feature") return catalogSuggestions.filter(s => s.level === "feature");
    if (priorityFilter === "brand") return catalogSuggestions.filter(s => s.level === "brand" || s.level === "brand_story" || s.level === "brand_category");
    return catalogSuggestions.filter(s => s.priority === priorityFilter);
  }, [catalogSuggestions, priorityFilter]);

  const selectedSuggestionCount = catalogSuggestions.filter(s => s.selected).length;

  const pushCatalogSuggestions = async () => {
    const toPush = catalogSuggestions.filter(s => s.selected);
    if (toPush.length === 0) {
      toast.error("No suggestions selected.");
      return;
    }
    setStep(3);
    setPushing(true);
    setPushProgress(0);
    const results: typeof pushResults = [];
    const { data: { user } } = await supabase.auth.getUser();
    let shopDomain = "";
    try {
      if (user) {
        const { data } = await supabase
          .from("platform_connections")
          .select("shop_domain")
          .eq("user_id", user.id)
          .eq("platform", "shopify")
          .eq("is_active", true)
          .maybeSingle();
        shopDomain = (data as { shop_domain?: string } | null)?.shop_domain || "";
      }
    } catch { /* */ }

    for (let i = 0; i < toPush.length; i++) {
      const s = toPush[i];
      try {
        const result = await createCollectionGraphQL({
          title: s.title,
          handle: s.handle,
          seo: { title: s.seo_title, description: s.meta_description },
          ruleSet: {
            appliedDisjunctively: false,
            rules: [{ column: s.rule_column, relation: s.rule_relation, condition: s.rule_condition }],
          },
        });
        const shopifyId = result?.id || result?.admin_graphql_api_id || "";
        results.push({ handle: s.handle, title: s.title, ok: true, shopifyId });
        if (user && shopDomain) {
          await supabase.from("collection_memory").upsert({
            user_id: user.id,
            shop_domain: shopDomain,
            collection_title: s.title,
            collection_handle: s.handle,
            shopify_collection_id: String(shopifyId || ""),
            level: s.level,
            source_invoice: "catalog_audit",
          }, { onConflict: "user_id,shop_domain,collection_handle" });
        }
      } catch (e: any) {
        results.push({ handle: s.handle, title: s.title, ok: false, error: e?.message || "Failed" });
      }
      setPushProgress(Math.round(((i + 1) / toPush.length) * 100));
      setPushResults([...results]);
      await new Promise(r => setTimeout(r, 500));
    }
    setPushing(false);
    toast.success(`${results.filter(r => r.ok).length} collections created`);
  };

  const deleteEmptyCollection = async (e: EmptyCollection) => {
    if (!confirm(`Delete collection "${e.title}" from Shopify? This cannot be undone.`)) return;
    setDeletingEmpty(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: { action: "delete_collection", collection_id: e.id, collection_type: e.kind },
      });
      if (error) throw error;
      if ((data as any)?.success) {
        setEmptyCollections(prev => prev.filter(x => x.handle !== e.handle));
        toast.success(`Deleted ${e.title}`);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("collection_memory").delete()
            .eq("user_id", user.id)
            .eq("collection_handle", e.handle);
        }
      } else {
        throw new Error((data as any)?.error || "Delete failed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete collection");
    } finally {
      setDeletingEmpty(false);
    }
  };
  const grouped = useMemo(() => {
    const byLabel: Record<string, DecomposedCollection[]> = {};
    for (const c of collections) {
      const key = c.level_label;
      (byLabel[key] ??= []).push(c);
    }
    return byLabel;
  }, [collections]);

  const newCount = collections.filter(c => c.is_new && c.selected).length;
  const skipCount = collections.filter(c => !c.is_new).length;
  const selected = collections.find(c => c.handle === selectedHandle) || null;

  const toggleOne = (handle: string, value: boolean) => {
    setCollections(prev => prev.map(c => c.handle === handle ? { ...c, selected: value } : c));
  };

  const selectAllNew = () => setCollections(prev => prev.map(c => ({ ...c, selected: c.is_new })));
  const deselectExisting = () => setCollections(prev => prev.map(c => c.is_new ? c : { ...c, selected: false }));

  const updateSelected = (patch: Partial<DecomposedCollection>) => {
    if (!selected) return;
    setCollections(prev => prev.map(c => c.handle === selected.handle ? { ...c, ...patch } : c));
  };

  // ── Step 3 push ──
  const pushSelected = async () => {
    const toPush = collections.filter(c => c.selected && c.is_new);
    if (toPush.length === 0) {
      toast.error("No new collections selected.");
      return;
    }
    setStep(3);
    setPushing(true);
    setPushProgress(0);
    const results: typeof pushResults = [];
    const { data: { user } } = await supabase.auth.getUser();

    // shop domain
    let shopDomain = "";
    try {
      if (user) {
        const { data } = await supabase
          .from("platform_connections")
          .select("shop_domain")
          .eq("user_id", user.id)
          .eq("platform", "shopify")
          .eq("is_active", true)
          .maybeSingle();
        shopDomain = (data as { shop_domain?: string } | null)?.shop_domain || "";
      }
    } catch { /* */ }

    for (let i = 0; i < toPush.length; i++) {
      const c = toPush[i];
      try {
        const result = await createCollectionGraphQL({
          title: c.title,
          handle: c.handle,
          seo: { title: c.seo_title, description: c.meta_description },
          ruleSet: {
            appliedDisjunctively: false,
            rules: [{ column: c.rule_column, relation: c.rule_relation, condition: c.rule_condition }],
          },
        });
        const shopifyId = result?.id || result?.admin_graphql_api_id || "";
        results.push({ handle: c.handle, title: c.title, ok: true, shopifyId });

        if (user && shopDomain) {
          await supabase.from("collection_memory").upsert({
            user_id: user.id,
            shop_domain: shopDomain,
            collection_title: c.title,
            collection_handle: c.handle,
            shopify_collection_id: String(shopifyId || ""),
            level: c.level_label,
            source_invoice: loadedLabel || null,
          }, { onConflict: "user_id,shop_domain,collection_handle" });
        }
      } catch (e: any) {
        results.push({ handle: c.handle, title: c.title, ok: false, error: e?.message || "Failed" });
      }
      setPushProgress(Math.round(((i + 1) / toPush.length) * 100));
      setPushResults([...results]);
      // gentle pacing for Shopify
      await new Promise(r => setTimeout(r, 500));
    }
    setPushing(false);
    const okCount = results.filter(r => r.ok).length;
    toast.success(`${okCount} collections created`);
  };

  // ── Render ──
  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold font-display">Collection Builder</h1>
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {[1,2,3].map(n => (
            <div key={n} className={`px-2 py-1 rounded ${step===n ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Step {n}</div>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="invoice">From invoice</TabsTrigger>
              <TabsTrigger value="paste">Paste titles</TabsTrigger>
            </TabsList>
            <TabsContent value="invoice" className="space-y-3 pt-3">
              <p className="text-sm text-muted-foreground">
                Load products from the most recent invoice session in this browser.
              </p>
              <Button onClick={loadFromCurrentInvoice} variant="secondary">
                <RefreshCw className="w-4 h-4 mr-2" /> Load products from current invoice
              </Button>
            </TabsContent>
            <TabsContent value="paste" className="space-y-3 pt-3">
              <Textarea
                rows={8}
                placeholder="One product title per line"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Vendor (e.g. Seafolly)" value={pasteVendor} onChange={(e) => setPasteVendor(e.target.value)} />
                <Input placeholder="Product type (e.g. Bikini Bottoms)" value={pasteType} onChange={(e) => setPasteType(e.target.value)} />
              </div>
              <Button onClick={loadFromPaste} variant="secondary">Load pasted titles</Button>
            </TabsContent>
          </Tabs>

          {products.length > 0 && (
            <div className="rounded-md border border-border p-3 bg-card">
              <div className="text-sm font-medium mb-2">{loadedLabel || `${products.length} products loaded`}</div>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                {products.slice(0, 5).map((p, i) => <li key={i}>{p.title}</li>)}
                {products.length > 5 && <li>…and {products.length - 5} more</li>}
              </ul>
              {products.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Note: AI analyses the first 30 products to detect collection patterns — this covers all style lines.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={analyse} disabled={products.length === 0}>
              Analyse collections <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {analysing ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-12 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> AI is analysing {products.length} products…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{collections.length} collections proposed</Badge>
                <Badge>{newCount} new selected</Badge>
                <Badge variant="outline">{skipCount} already exist</Badge>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={selectAllNew}>Select all new</Button>
                  <Button size="sm" variant="outline" onClick={deselectExisting}>Deselect existing</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left panel */}
                <div className="border border-border rounded-md bg-card">
                  <Accordion type="multiple" defaultValue={LEVEL_GROUPS.map(g => g.label)}>
                    {LEVEL_GROUPS.map(group => {
                      const items = group.labels.flatMap(l => grouped[l] || []);
                      if (items.length === 0) return null;
                      const newN = items.filter(i => i.is_new).length;
                      return (
                        <AccordionItem value={group.label} key={group.label}>
                          <AccordionTrigger className="px-3 text-sm">
                            {group.label} <span className="ml-2 text-xs text-muted-foreground">({newN} new / {items.length} total)</span>
                          </AccordionTrigger>
                          <AccordionContent className="px-3 space-y-1">
                            {items.map(c => (
                              <div
                                key={c.handle}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm ${selectedHandle === c.handle ? "bg-muted" : "hover:bg-muted/60"}`}
                                onClick={() => setSelectedHandle(c.handle)}
                              >
                                <Checkbox
                                  checked={c.selected}
                                  onCheckedChange={(v) => toggleOne(c.handle, !!v)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <span className="truncate flex-1">{c.title}</span>
                                {c.is_new
                                  ? <Badge className="text-[10px]">★ NEW</Badge>
                                  : <Badge variant="outline" className="text-[10px]">✓ EXISTS</Badge>}
                              </div>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>

                {/* Right panel */}
                <div className="border border-border rounded-md bg-card p-4 space-y-3">
                  {selected ? (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Title</label>
                        <Input value={selected.title} onChange={(e) => updateSelected({ title: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Handle</label>
                        <Input value={selected.handle} onChange={(e) => updateSelected({ handle: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">SEO title ({selected.seo_title.length}/60)</label>
                        <Input value={selected.seo_title} onChange={(e) => updateSelected({ seo_title: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Meta description ({selected.meta_description.length}/155)</label>
                        <Textarea rows={3} value={selected.meta_description} onChange={(e) => updateSelected({ meta_description: e.target.value })} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rule: products where <b>{selected.rule_column}</b> {selected.rule_relation} <b>“{selected.rule_condition}”</b>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">Matching products ({selected.product_ids.length})</div>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {products.filter(p => selected.product_ids.includes(p.product_id)).slice(0, 8).map(p => (
                            <li key={p.product_id} className="truncate">{p.title}</li>
                          ))}
                          {selected.product_ids.length > 8 && <li>…and {selected.product_ids.length - 8} more</li>}
                        </ul>
                      </div>
                      <div className="text-[11px] text-muted-foreground italic">{selected.rationale}</div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Select a collection on the left to preview.</div>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                <Button onClick={pushSelected} disabled={newCount === 0}>
                  <Sparkles className="w-4 h-4 mr-2" /> Create {newCount} collections in Shopify
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Progress value={pushProgress} />
          <div className="text-sm text-muted-foreground">
            {pushing ? `Creating collections… ${pushProgress}%` : `Done — ${pushResults.filter(r => r.ok).length} created`}
          </div>
          <ul className="text-sm space-y-1">
            {pushResults.map(r => (
              <li key={r.handle} className="flex items-center gap-2">
                {r.ok ? <Check className="w-4 h-4 text-primary" /> : <span className="w-4 h-4 text-destructive">✕</span>}
                <span className="flex-1 truncate">{r.title}</span>
                {r.error && <span className="text-xs text-destructive">{r.error}</span>}
              </li>
            ))}
          </ul>
          {!pushing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => window.open("https://admin.shopify.com/", "_blank")}>
                View collections in Shopify <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
              {onOpenCollectionSEO && (
                <Button onClick={() => onOpenCollectionSEO(pushResults.filter(r => r.ok).map(r => r.handle))}>
                  Add collection page SEO content <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
              <Button variant="ghost" onClick={onBack}>Done</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
