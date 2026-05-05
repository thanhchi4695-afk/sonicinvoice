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
import CollectionRuleMethodChooser, { loadStoredPrefs } from "@/components/CollectionRuleMethodChooser";
import {
  MethodPreferences,
  getCollectionTypeConfig,
  prefKeyToMethodLabel,
} from "@/lib/collection-rule-methods";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type LevelLabel =
  | "brand" | "brand_story" | "category" | "sub_category"
  | "modified_sub_category" | "feature" | "cross_reference";

interface CollectionRule {
  column: string;
  relation: string;
  condition: string;
}

interface DecomposedCollection {
  title: string;
  handle: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  level_label: LevelLabel;
  rule_column: string;
  rule_relation: string;
  rule_condition: string;
  rules?: CollectionRule[];      // optional: for AND/OR multi-rule
  disjunctive?: boolean;
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

  // Rule method preferences (per collection type)
  const storeName = (() => {
    try { return JSON.parse(localStorage.getItem("store_config_sonic_invoice") || "{}")?.store_name || "Splash Swimwear"; }
    catch { return "Splash Swimwear"; }
  })();
  const [methodPrefs, setMethodPrefs] = useState<MethodPreferences>(() => loadStoredPrefs(storeName));
  const [previewCounts, setPreviewCounts] = useState<Record<string, { count: number; titles: string[]; loading?: boolean; error?: string }>>({});

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
          method_preferences: methodPrefs,
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
          method_preferences: methodPrefs,
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

  const previewMatching = async (c: DecomposedCollection) => {
    setPreviewCounts(prev => ({ ...prev, [c.handle]: { ...(prev[c.handle] || { count: 0, titles: [] }), loading: true, error: undefined } }));
    try {
      // Use first rule for the preview (good signal even when AND-rule).
      const rule = (c.rules && c.rules[0]) || { column: c.rule_column, relation: c.rule_relation, condition: c.rule_condition };
      // Build a Shopify search query string
      const colKey = rule.column === "type" || rule.column === "product_type" ? "product_type"
        : rule.column === "vendor" ? "vendor"
        : rule.column === "tag" ? "tag"
        : "title";
      const q = `${colKey}:'${(rule.condition || "").replace(/'/g, "\\'")}'`;
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: { action: "graphql", query: `query($q:String!){ products(first: 250, query:$q){ edges{ node{ title } } } }`, variables: { q } },
      });
      if (error) throw error;
      const edges = (data as any)?.data?.products?.edges || [];
      const titles = edges.map((e: any) => e.node?.title).filter(Boolean);
      setPreviewCounts(prev => ({ ...prev, [c.handle]: { count: edges.length, titles, loading: false } }));
    } catch (e: any) {
      setPreviewCounts(prev => ({ ...prev, [c.handle]: { count: 0, titles: [], loading: false, error: e?.message || "Preview failed" } }));
    }
  };
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
            appliedDisjunctively: !!c.disjunctive,
            rules: (c.rules && c.rules.length > 0)
              ? c.rules
              : [{ column: c.rule_column, relation: c.rule_relation, condition: c.rule_condition }],
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
              <TabsTrigger value="catalog">
                <Search className="w-3.5 h-3.5 mr-1" /> Scan full catalog
              </TabsTrigger>
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
            <TabsContent value="catalog" className="space-y-4 pt-3">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Search className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold">Full Catalog Gap Analysis</h3>
                    <p className="text-xs text-muted-foreground">
                      Scan all your Shopify products and collections to find what's missing.
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <label className="text-xs font-medium text-muted-foreground">Scope</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="scanMode" checked={scanMode === "full"} onChange={() => setScanMode("full")} />
                      <span>All brands (full catalog)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="scanMode" checked={scanMode === "brand"} onChange={() => setScanMode("brand")} />
                      <span>One brand only</span>
                      <Input
                        className="h-7 w-44 ml-1"
                        placeholder="e.g. Seafolly"
                        value={scanVendor}
                        onChange={(e) => { setScanVendor(e.target.value); setScanMode("brand"); }}
                      />
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="scanMode" checked={scanMode === "type"} onChange={() => setScanMode("type")} />
                      <span>One category</span>
                      <Input
                        className="h-7 w-44 ml-1"
                        placeholder="e.g. Bikini Bottoms"
                        value={scanType}
                        onChange={(e) => { setScanType(e.target.value); setScanMode("type"); }}
                      />
                    </label>
                  </div>
                </div>

                {(() => {
                  let lastRun = "never";
                  let lastCount: string | null = null;
                  try {
                    const ts = localStorage.getItem("catalog_audit_last_run");
                    if (ts) lastRun = new Date(ts).toLocaleString();
                    lastCount = localStorage.getItem("catalog_audit_last_count");
                  } catch { /* */ }
                  return (
                    <div className="rounded border border-border bg-card/50 p-2 text-xs text-muted-foreground space-y-0.5">
                      <div>📊 Last scan: <span className="text-foreground">{lastRun}</span></div>
                      <div>Gaps identified: <span className="text-foreground">{lastCount ?? "—"}</span></div>
                    </div>
                  );
                })()}

                <Button
                  onClick={runCatalogScan}
                  disabled={analysing || (scanMode === "brand" && !scanVendor.trim()) || (scanMode === "type" && !scanType.trim())}
                  className="w-full"
                >
                  <Search className="w-4 h-4 mr-2" />
                  Scan now — analyse full catalog
                </Button>
              </div>
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

          {(products.length > 0 || tab === "catalog") && (
            <CollectionRuleMethodChooser
              storeName={storeName}
              products={products}
              value={methodPrefs}
              onChange={setMethodPrefs}
            />
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
            <div className="py-8 max-w-md mx-auto space-y-3">
              <div className="flex items-center gap-3 text-sm text-foreground justify-center mb-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                {isCatalogScan ? "Running full catalog audit…" : `AI is analysing ${products.length} products…`}
              </div>
              {isCatalogScan && (
                <ul className="space-y-1 text-sm">
                  {["Fetching existing collections…","Loading in-stock products…","Identifying style lines…","AI gap analysis…","Building suggestions…"].map((label, idx) => {
                    const done = idx < scanProgress.length - 1;
                    const active = idx === scanProgress.length - 1;
                    return (
                      <li key={idx} className={`flex items-center gap-2 ${active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                        {done ? <Check className="w-4 h-4 text-primary" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-4 h-4 inline-block">○</span>}
                        {label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : isCatalogScan ? (
            <>
              {/* SECTION A — Gap summary */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div className="text-2xl font-bold text-destructive">{gapStats.brands_without_collection ?? 0}</div>
                  <div className="text-xs text-muted-foreground">brands without collection</div>
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="text-2xl font-bold text-amber-500">{gapStats.style_lines_without_collection ?? 0}</div>
                  <div className="text-xs text-muted-foreground">style lines without collection</div>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="text-2xl font-bold text-primary">{(gapStats.feature_gaps ?? []).length}</div>
                  <div className="text-xs text-muted-foreground">feature collections missing</div>
                </div>
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="text-2xl font-bold">{emptyCollections.length}</div>
                  <div className="text-xs text-muted-foreground">existing collections empty/stale</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Scanned {scanStats.unique_products ?? 0} products across {scanStats.unique_brands ?? 0} brands · {scanStats.total_existing_collections ?? 0} existing collections
              </div>

              {/* SECTION B — Suggested new collections */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold flex-1">Suggested new collections ({catalogSuggestions.length})</h3>
                  <div className="flex flex-wrap gap-1">
                    {(["all","high","medium","low","feature","brand"] as const).map(p => (
                      <Button key={p} size="sm" variant={priorityFilter === p ? "default" : "outline"} onClick={() => setPriorityFilter(p)}>
                        {p === "all" ? "All" : p === "feature" ? "Feature only" : p === "brand" ? "Brand only" : `${p[0].toUpperCase()}${p.slice(1)} priority`}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border border-border rounded-md bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left w-8"></th>
                        <th className="px-2 py-2 text-left">Title</th>
                        <th className="px-2 py-2 text-left">Level</th>
                        <th className="px-2 py-2 text-left">Priority</th>
                        <th className="px-2 py-2 text-right">Est. products</th>
                        <th className="px-2 py-2 text-left">Rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSuggestions.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-xs">No suggestions match this filter.</td></tr>
                      )}
                      {filteredSuggestions.map(s => (
                        <tr key={s.handle} className="border-t border-border hover:bg-muted/30">
                          <td className="px-2 py-1.5">
                            <Checkbox checked={s.selected} onCheckedChange={(v) => toggleSuggestion(s.handle, !!v)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium">{s.title}</div>
                            <div className="text-[10px] text-muted-foreground italic truncate max-w-md">{s.rationale}</div>
                          </td>
                          <td className="px-2 py-1.5"><Badge variant="outline" className="text-[10px]">{s.level}</Badge></td>
                          <td className="px-2 py-1.5">
                            <Badge className={`text-[10px] ${s.priority === "high" ? "bg-destructive/20 text-destructive" : s.priority === "medium" ? "bg-amber-500/20 text-amber-600" : "bg-muted"}`}>
                              {s.priority}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-xs">{s.estimated_products}</td>
                          <td className="px-2 py-1.5">
                            <RulePill column={s.rule_column} relation={s.rule_relation} condition={s.rule_condition} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION C — Empty / stale collections */}
              {emptyCollections.length > 0 && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="empty">
                    <AccordionTrigger className="text-sm">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Empty / stale collections ({emptyCollections.length})
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1">
                        {emptyCollections.map(e => (
                          <li key={e.handle} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border text-sm">
                            <span className="flex-1 truncate">
                              <b>{e.title}</b>
                              <span className="text-xs text-muted-foreground ml-2">— {e.products_count} products</span>
                            </span>
                            <Badge variant="outline" className="text-[10px]">{e.kind}</Badge>
                            <Button size="sm" variant="destructive" disabled={deletingEmpty} onClick={() => deleteEmptyCollection(e)}>
                              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              <div className="flex justify-between sticky bottom-0 bg-background pt-3 pb-1 border-t border-border">
                <Button variant="ghost" onClick={() => { setStep(1); setIsCatalogScan(false); }}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button onClick={pushCatalogSuggestions} disabled={selectedSuggestionCount === 0}>
                  <Sparkles className="w-4 h-4 mr-2" /> Create {selectedSuggestionCount} collections in Shopify
                </Button>
              </div>
            </>
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
                      <RulePreviewPanel
                        collection={selected}
                        onUpdate={updateSelected}
                        onPreview={() => previewMatching(selected)}
                        previewState={previewCounts[selected.handle]}
                      />
                      <MethodChangeRow
                        levelLabel={selected.level_label}
                        prefs={methodPrefs}
                        onChangePrefs={setMethodPrefs}
                      />
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

// ────────────────────────────────────────────────────────────
// Helpers used in Step 2 right panel
// ────────────────────────────────────────────────────────────

const RULE_COLUMNS: { value: string; label: string }[] = [
  { value: "tag", label: "tag" },
  { value: "title", label: "title" },
  { value: "vendor", label: "vendor" },
  { value: "type", label: "type" },
  { value: "variant_price", label: "variant_price" },
];
const RULE_RELATIONS: { value: string; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "not_equals", label: "not equals" },
];

function RulePreviewPanel({
  collection, onUpdate, onPreview, previewState,
}: {
  collection: DecomposedCollection;
  onUpdate: (patch: Partial<DecomposedCollection>) => void;
  onPreview: () => void;
  previewState?: { count: number; titles: string[]; loading?: boolean; error?: string };
}) {
  const [editing, setEditing] = useState(false);
  const rules = collection.rules && collection.rules.length > 0
    ? collection.rules
    : [{ column: collection.rule_column, relation: collection.rule_relation, condition: collection.rule_condition }];
  const conjunction = collection.disjunctive ? "OR" : "AND";

  const updateRule = (idx: number, patch: Partial<CollectionRule>) => {
    const next = rules.map((r, i) => i === idx ? { ...r, ...patch } : r);
    if (idx === 0 && (!collection.rules || collection.rules.length === 0)) {
      onUpdate({
        rules: next,
        rule_column: next[0].column,
        rule_relation: next[0].relation,
        rule_condition: next[0].condition,
      });
    } else {
      onUpdate({ rules: next });
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">Shopify Smart Collection Rule</div>
      <div className="rounded border border-border bg-background p-2 space-y-1 text-xs font-mono">
        {rules.map((r, i) => (
          <div key={i}>
            {i > 0 && <div className="text-muted-foreground italic font-sans">{conjunction}</div>}
            {editing ? (
              <div className="flex flex-wrap gap-1 items-center">
                <Select value={r.column} onValueChange={(v) => updateRule(i, { column: v })}>
                  <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_COLUMNS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={r.relation} onValueChange={(v) => updateRule(i, { relation: v })}>
                  <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_RELATIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-7 flex-1 min-w-[140px]" value={r.condition} onChange={(e) => updateRule(i, { condition: e.target.value })} />
              </div>
            ) : (
              <div><b>{r.column}</b> {r.relation} <span className="text-primary">"{r.condition}"</span></div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(v => !v)}>{editing ? "Done editing" : "Edit rule"}</Button>
        <Button size="sm" variant="outline" onClick={onPreview} disabled={previewState?.loading}>
          {previewState?.loading ? "Checking…" : "Preview matching products"}
        </Button>
      </div>
      {previewState && !previewState.loading && !previewState.error && (
        <div className="text-xs text-muted-foreground">
          <div className="text-foreground"><b>{previewState.count}</b> products match this rule</div>
          {previewState.titles.length > 0 && (
            <ul className="list-disc pl-5 mt-1">
              {previewState.titles.slice(0, 5).map((t, i) => <li key={i} className="truncate">{t}</li>)}
            </ul>
          )}
        </div>
      )}
      {previewState?.error && <div className="text-xs text-destructive">{previewState.error}</div>}
    </div>
  );
}

function MethodChangeRow({
  levelLabel, prefs, onChangePrefs,
}: {
  levelLabel: string;
  prefs: MethodPreferences;
  onChangePrefs: (p: MethodPreferences) => void;
}) {
  const cfg = getCollectionTypeConfig(levelLabel);
  if (!cfg) return null;
  if (!cfg.choice_required) {
    return (
      <div className="text-[11px] text-muted-foreground">
        ℹ️ Fixed method: {cfg.fixed_method?.label} — cannot be changed.
      </div>
    );
  }
  const key = levelLabel as keyof MethodPreferences;
  const current = prefKeyToMethodLabel(levelLabel, prefs[key]) || "";
  return (
    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
      ℹ️ Using: <b className="text-foreground">{current}</b>
      <Select
        value={prefs[key]}
        onValueChange={(v) => onChangePrefs({ ...prefs, [key]: v } as MethodPreferences)}
      >
        <SelectTrigger className="h-6 w-44 text-[11px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {cfg.available_methods!.map(m => {
            const k = (() => {
              if (levelLabel === "category") return { "By product type": "type", "By tag": "tag", "By tag OR type (broadest)": "tag_or_type" }[m.label]!;
              if (levelLabel === "brand_category") return { "By vendor AND tag": "vendor_tag", "By vendor AND type": "vendor_type", "By title prefix": "title_prefix" }[m.label]!;
              return { "By title keyword": "title", "By tag": "tag" }[m.label]!;
            })();
            return <SelectItem key={k} value={k}>{m.label}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
