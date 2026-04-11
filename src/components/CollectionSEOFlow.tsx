import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Loader2, Check, Copy, RefreshCw, Download, Eye, Code, Search, Brain, Zap, Link, ExternalLink, Sparkles, X, Layers, ArrowRight } from "lucide-react";
import WhatsNextSuggestions from "@/components/WhatsNextSuggestions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { createCollectionGraphQL, type GraphQLCollectionInput } from "@/lib/shopify-api";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";

interface CollectionSEOFlowProps {
  onBack: () => void;
  onStartFlow?: (flow: string) => void;
  products?: any[];
}

interface ArchitectCollection {
  id: string;
  title: string;
  handle: string;
  type: string;
  rules: { column: string; relation: string; condition: string }[];
  disjunctive: boolean;
  seoTitle: string;
  metaDescription: string;
  bodyContent: string;
  internalLinksTo: string[];
  selected: boolean;
}

interface PushResult {
  title: string;
  handle: string;
  ok: boolean;
  shopifyId?: string;
  error?: string;
}

interface CrossLink {
  from: string;
  to: string;
  anchor_text?: string;
  reason: string;
}

interface CollectionGroup {
  group_name: string;
  brand: string;
  products_in_group: number;
  product_titles: string[];
  collections: ArchitectCollection[];
  cross_links: CrossLink[];
}

interface HomepageSection {
  title: string;
  collections: string[];
  layout: string;
}

interface FooterMenuItem {
  heading: string;
  links: { title: string; handle: string }[];
}

// ── Local parse helpers (kept from original for "Quick" mode) ──

const TYPE_OPTIONS = [
  "Triangle Bikini Top", "Bandeau Bikini Top", "Halter Bikini Top", "Bralette Bikini Top",
  "Bikini Top", "Bikini Bottom", "Bikini Set", "One Piece", "Tankini Top", "Tankini Set",
  "Swimdress", "Rashie", "Sunsuits", "Rashies & Sunsuits", "Boardshort", "Boardshorts",
  "Kaftan", "Kaftans & Cover Ups", "Cover Up", "Sarong", "Dress", "Top", "Shorts",
  "Playsuit", "Hat", "Sunnies", "Bag", "Jewellery", "Accessories",
  "Mens Swimwear", "Boys Swimwear", "Girls Swimwear"
].sort((a, b) => b.length - a.length);

const SKIP_WORDS = new Set([
  "the", "a", "an", "and", "with", "for", "in", "my", "new", "classic", "original",
  "black", "white", "navy", "ivory", "stone", "ebony", "sand", "coral", "blush",
  "teal", "khaki", "red", "blue", "green", "pink", "yellow", "orange", "purple",
  "grey", "gray", "bronze", "gold", "silver", "nude", "tan", "olive", "cream",
  "high", "low", "front", "back", "tie", "side", "cross", "halter", "wrap",
  "small", "large", "long", "short", "mini", "maxi", "midi"
]);

function toHandle(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pluralise(type: string): string {
  if (type.endsWith("s") || type.endsWith("wear")) return type;
  if (type.endsWith("y")) return type.slice(0, -1) + "ies";
  return type + "s";
}

function detectProductType(title: string, type: string): string {
  if (type) return type;
  const lower = title.toLowerCase();
  for (const opt of TYPE_OPTIONS) {
    if (lower.includes(opt.toLowerCase())) return opt;
  }
  return "";
}

function parseMiddleTokens(title: string, vendor: string, type: string) {
  const lower = title.toLowerCase();
  const vendorLower = (vendor || "").toLowerCase();
  let remaining = title;
  if (vendorLower && lower.startsWith(vendorLower)) {
    remaining = title.slice(vendor.length).trim();
  }
  const typeLower = (type || "").toLowerCase();
  for (const opt of TYPE_OPTIONS) {
    if (remaining.toLowerCase().endsWith(opt.toLowerCase())) {
      remaining = remaining.slice(0, remaining.length - opt.length).trim();
      break;
    }
  }
  const tokens = remaining.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return { print: null, style: null };
  const first = tokens[0];
  if (first.length < 2 || SKIP_WORDS.has(first.toLowerCase())) {
    return { print: null, style: tokens.length > 1 ? tokens.slice(1).join(" ") : null };
  }
  return { print: first, style: tokens.length > 1 ? tokens.slice(1).join(" ") : null };
}

function quickParseToArchitect(products: any[]): ArchitectCollection[] {
  const map = new Map<string, ArchitectCollection>();

  products.forEach(product => {
    const title = product.title || product.product_title || product.productTitle || "";
    const vendor = product.vendor || product.brand || "";
    const type = detectProductType(title, product.type || product.product_type || product.productType || "");
    const { print } = parseMiddleTokens(title, vendor, type);

    const add = (c: Omit<ArchitectCollection, "id" | "selected">) => {
      if (map.has(c.handle)) return;
      map.set(c.handle, { ...c, id: crypto.randomUUID(), selected: true });
    };

    if (vendor) {
      add({
        title: vendor, handle: toHandle(vendor), type: "brand",
        rules: [{ column: "vendor", relation: "equals", condition: vendor }],
        disjunctive: false,
        seoTitle: `${vendor} Swimwear | Shop the Collection`,
        metaDescription: `Shop the full ${vendor} collection. Australian-designed swimwear.`,
        bodyContent: "", internalLinksTo: [],
      });
    }
    if (vendor && print) {
      add({
        title: `${vendor} ${print}`, handle: toHandle(`${vendor} ${print}`), type: "style",
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "title", relation: "contains", condition: print },
        ],
        disjunctive: false,
        seoTitle: `${vendor} ${print} | Shop Now`,
        metaDescription: `Shop ${vendor} ${print} swimwear online.`,
        bodyContent: "", internalLinksTo: [toHandle(vendor)],
      });
    }
    if (vendor && type) {
      const plural = pluralise(type);
      add({
        title: `${vendor} ${plural}`, handle: toHandle(`${vendor} ${plural}`), type: "category",
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "tag", relation: "equals", condition: type },
        ],
        disjunctive: false,
        seoTitle: `${vendor} ${plural} | Shop the Range`,
        metaDescription: `Browse ${vendor} ${plural}. Find your perfect fit.`,
        bodyContent: "", internalLinksTo: [toHandle(vendor)],
      });
    }
    if (type) {
      const plural = pluralise(type);
      add({
        title: plural, handle: toHandle(plural), type: "broad_category",
        rules: [{ column: "tag", relation: "equals", condition: type }],
        disjunctive: false,
        seoTitle: `${plural} | Shop Our Collection`,
        metaDescription: `Browse our curated selection of ${plural.toLowerCase()}.`,
        bodyContent: "", internalLinksTo: [],
      });
    }
  });

  return Array.from(map.values());
}

// ── Type badge helpers ──

const TYPE_COLORS: Record<string, string> = {
  brand: "bg-primary/15 text-primary",
  style: "bg-accent/15 text-accent-foreground",
  category: "bg-success/15 text-success",
  style_category: "bg-warning/15 text-warning",
  feature: "bg-secondary text-secondary-foreground",
  broad_category: "bg-muted text-muted-foreground",
  colour: "bg-primary/10 text-primary",
  print_story: "bg-accent/10 text-accent-foreground",
  seasonal: "bg-warning/10 text-warning",
};

function typeBadge(t: string) {
  const color = TYPE_COLORS[t] || "bg-muted text-muted-foreground";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${color}`}>{t.replace(/_/g, " ")}</span>;
}

// ── Steps ──
const STEPS = ["Source", "Review", "Links", "Push"];

export default function CollectionSEOFlow({ onBack, onStartFlow, products: propProducts }: CollectionSEOFlowProps) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"bulk" | "architect" | "quick">("bulk");
  const [source, setSource] = useState<"invoice" | "paste" | "props">(propProducts?.length ? "props" : "invoice");
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<ArchitectCollection[]>([]);
  const [crossLinks, setCrossLinks] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"preview" | "html" | "seo">("preview");

  // Bulk mode state
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [globalCrossLinks, setGlobalCrossLinks] = useState<CrossLink[]>([]);
  const [homepageSections, setHomepageSections] = useState<HomepageSection[]>([]);
  const [footerMenu, setFooterMenu] = useState<FooterMenuItem[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Push state
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState(0);
  const [pushResults, setPushResults] = useState<PushResult[]>([]);
  const [linkingStrategy, setLinkingStrategy] = useState("");

  const selectedCount = collections.filter(c => c.selected).length;

  // ── Load products ──
  const getProducts = (): any[] => {
    if (propProducts?.length) return propProducts;
    if (source === "paste") {
      return pasteText.split("\n").filter(l => l.trim()).map(line => {
        const parts = line.trim().split("|").map(p => p.trim());
        return { title: parts[0] || line.trim(), vendor: parts[1] || "", type: parts[2] || "", tags: parts[3] || "" };
      });
    }
    // Invoice source
    const keys = ["invoice_lines", "batch_review_products", "sonic_scan_batch", "scan_items"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const items = JSON.parse(raw);
          if (Array.isArray(items) && items.length > 0) return items;
        }
      } catch {}
    }
    return [];
  };

  const mapCollection = (c: any): ArchitectCollection => ({
    id: crypto.randomUUID(),
    title: c.title || "",
    handle: c.handle || toHandle(c.title || ""),
    type: c.type || "feature",
    rules: Array.isArray(c.smart_collection_rules)
      ? c.smart_collection_rules
      : [{ column: "tag", relation: "contains", condition: c.handle || "" }],
    disjunctive: c.disjunctive ?? true,
    seoTitle: c.seo_title || c.title || "",
    metaDescription: c.meta_description || "",
    bodyContent: c.body_content || "",
    internalLinksTo: c.internal_links_to || [],
    selected: true,
  });

  const handleGenerate = async () => {
    const products = getProducts();
    if (products.length === 0) {
      toast.error("No products found. Import an invoice first or paste product titles.");
      return;
    }

    setLoading(true);
    try {
      const storeConfig = JSON.parse(localStorage.getItem("store_config") || "{}");
      const storeParams = {
        storeName: storeConfig.storeName || storeConfig.store_name || localStorage.getItem("store_name") || "",
        storeCity: storeConfig.storeCity || storeConfig.city || localStorage.getItem("store_city") || "",
        industry: storeConfig.industry || "swimwear",
        locale: storeConfig.locale || "AU",
      };

      if (mode === "bulk") {
        // Bulk invoice-level hierarchy with groups & cross-links
        const { data, error } = await supabase.functions.invoke("collection-bulk-architect", {
          body: { products: products.slice(0, 40), ...storeParams },
        });
        if (error) throw error;

        // Map groups
        const mappedGroups: CollectionGroup[] = (data.groups || []).map((g: any) => ({
          group_name: g.group_name || "",
          brand: g.brand || "",
          products_in_group: g.products_in_group || 0,
          product_titles: g.product_titles || [],
          collections: (g.collections || []).map(mapCollection),
          cross_links: g.cross_links || [],
        }));

        // Global collections
        const globalColls = (data.global_collections || []).map(mapCollection);

        // Flatten all collections for the review step
        const allColls = [
          ...mappedGroups.flatMap(g => g.collections),
          ...globalColls,
        ];
        // De-duplicate by handle
        const seen = new Set<string>();
        const deduped = allColls.filter(c => {
          if (seen.has(c.handle)) return false;
          seen.add(c.handle);
          return true;
        });

        setGroups(mappedGroups);
        setGlobalCrossLinks(data.global_cross_links || []);
        setCollections(deduped);
        setLinkingStrategy(data.global_linking_strategy || "");
        setHomepageSections(data.homepage_sections || []);
        setFooterMenu(data.footer_menu || []);
        toast.success(`AI generated ${deduped.length} collections across ${mappedGroups.length} groups`);

      } else if (mode === "architect") {
        const { data, error } = await supabase.functions.invoke("collection-architect", {
          body: { products: products.slice(0, 20), ...storeParams },
        });
        if (error) throw error;

        const mapped = (data.collections || []).map(mapCollection);
        setCollections(mapped);
        setGroups([]);
        setLinkingStrategy(data.internal_linking_strategy || "");
        toast.success(`AI generated ${mapped.length} hierarchical collections`);
      } else {
        const parsed = quickParseToArchitect(products);
        setCollections(parsed);
        setGroups([]);
        toast.success(`Parsed ${products.length} products → ${parsed.length} collections`);
      }
      setStep(1);
      addAuditEntry("Collection SEO", `Generated ${mode} collections from ${products.length} products`);
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setCollections(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  };

  const toggleAll = () => {
    const allSelected = collections.every(c => c.selected);
    setCollections(prev => prev.map(c => ({ ...c, selected: !allSelected })));
  };

  const handlePushToShopify = async () => {
    const toPush = collections.filter(c => c.selected);
    if (toPush.length === 0) return;

    setPushing(true);
    setPushProgress(0);
    setStep(3);
    const results: PushResult[] = [];

    for (let i = 0; i < toPush.length; i++) {
      const c = toPush[i];
      try {
        const gqlInput: GraphQLCollectionInput = {
          title: c.title,
          handle: c.handle,
          descriptionHtml: c.bodyContent || `<p>${c.metaDescription}</p>`,
          seo: { title: c.seoTitle, description: c.metaDescription },
          ruleSet: {
            appliedDisjunctively: c.disjunctive,
            rules: c.rules,
          },
        };
        const result = await createCollectionGraphQL(gqlInput);
        results.push({ title: c.title, handle: c.handle, ok: true, shopifyId: result?.id });
      } catch (err: any) {
        results.push({ title: c.title, handle: c.handle, ok: false, error: err?.message || "Unknown error" });
      }
      setPushProgress(Math.round(((i + 1) / toPush.length) * 100));
      if (i < toPush.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    setPushResults(results);
    setPushing(false);
    const ok = results.filter(r => r.ok).length;
    addAuditEntry("Collection SEO", `Pushed ${ok}/${toPush.length} collections to Shopify`);
    toast.success(`Created ${ok} collection${ok !== 1 ? "s" : ""} in Shopify`);
  };

  const handleExportCSV = () => {
    const selected = collections.filter(c => c.selected);
    if (selected.length === 0) { toast.error("No collections selected"); return; }

    const headers = ["Handle", "Command", "Title", "Body HTML", "Sort Order", "Published", "Must Match", "SEO Title", "SEO Description", "Rule: Product Column", "Rule: Relation", "Rule: Condition"];
    const rows = [headers.map(h => `"${h}"`).join(",")];
    selected.forEach(c => {
      c.rules.forEach((rule, i) => {
        const row = [
          i === 0 ? c.handle : "", i === 0 ? "MERGE" : "", i === 0 ? c.title : "",
          i === 0 ? (c.bodyContent || "") : "", i === 0 ? "created-desc" : "",
          i === 0 ? "TRUE" : "", i === 0 ? (c.disjunctive ? "any" : "all") : "",
          i === 0 ? c.seoTitle : "", i === 0 ? c.metaDescription : "",
          rule.column, rule.relation, rule.condition,
        ];
        rows.push(row.map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","));
      });
    });
    const csv = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Smart Collections.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Exported ${selected.length} collections`);
  };

  const expanded = expandedId ? collections.find(c => c.id === expandedId) : null;

  // Group by type for display
  const typeGroups = collections.reduce<Record<string, ArchitectCollection[]>>((acc, c) => {
    (acc[c.type] = acc[c.type] || []).push(c);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold font-display">Collection SEO Architect</h1>
        <p className="text-sm text-muted-foreground mt-1">Generate hierarchical smart collections with SEO content & internal linking</p>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mt-4 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <button
                onClick={() => i <= step && !pushing && setStep(i)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {i + 1}. {s}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* ───── STEP 0: SOURCE ───── */}
        {step === 0 && (
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setMode("bulk")}
                className={`p-3 rounded-xl border text-left transition-all ${mode === "bulk" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}
              >
                <Layers className={`w-5 h-5 mb-1 ${mode === "bulk" ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-xs font-semibold">Bulk Invoice</p>
                <p className="text-[10px] text-muted-foreground">Full invoice → grouped hierarchy with cross-links</p>
              </button>
              <button
                onClick={() => setMode("architect")}
                className={`p-3 rounded-xl border text-left transition-all ${mode === "architect" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}
              >
                <Brain className={`w-5 h-5 mb-1 ${mode === "architect" ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-xs font-semibold">SEO Architect</p>
                <p className="text-[10px] text-muted-foreground">AI hierarchy per product</p>
              </button>
              <button
                onClick={() => setMode("quick")}
                className={`p-3 rounded-xl border text-left transition-all ${mode === "quick" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}
              >
                <Zap className={`w-5 h-5 mb-1 ${mode === "quick" ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-xs font-semibold">Quick</p>
                <p className="text-[10px] text-muted-foreground">Local rules-based</p>
              </button>
            </div>

            {/* Source picker */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h2 className="text-base font-semibold mb-2">Product source</h2>
              <div className="space-y-2">
                {propProducts?.length ? (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={source === "props"} onChange={() => setSource("props")} className="accent-primary" />
                    From invoice ({propProducts.length} products)
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={source === "invoice"} onChange={() => setSource("invoice")} className="accent-primary" />
                  Products from last invoice import
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={source === "paste"} onChange={() => setSource("paste")} className="accent-primary" />
                  Paste product titles (one per line)
                </label>
              </div>
              {source === "paste" && (
                <textarea
                  className="w-full mt-3 p-3 rounded-md border border-border bg-background text-sm font-mono min-h-[120px]"
                  placeholder={"Sea Level Breezer O Ring Bandeau One Piece - White\nTigerlily Caya Tara Triangle Bikini Top\nSeafolly Collective Belted One Piece"}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                />
              )}
            </div>

            {/* Cross-links toggle */}
            <div className="flex items-center justify-between bg-card rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Link className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Generate cross-collection internal links</p>
                  <p className="text-[10px] text-muted-foreground">AI will plan how collections link to each other</p>
                </div>
              </div>
              <Switch checked={crossLinks} onCheckedChange={setCrossLinks} />
            </div>

            <Button className="w-full h-12 text-base" onClick={handleGenerate} disabled={loading}>
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{mode === "bulk" ? "AI grouping & building hierarchy…" : mode === "architect" ? "AI building hierarchy…" : "Parsing products…"}</>
              ) : (
                <>{mode === "bulk" ? <Layers className="w-4 h-4 mr-2" /> : mode === "architect" ? <Brain className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}{mode === "bulk" ? "Build Full Invoice Hierarchy" : mode === "architect" ? "Build SEO Collection Hierarchy" : "Generate Collections"}</>
              )}
            </Button>
          </div>
        )}

        {/* ───── STEP 1: REVIEW ───── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-card rounded-lg border border-border p-2 text-center">
                <p className="text-lg font-bold">{collections.length}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-2 text-center">
                <p className="text-lg font-bold text-primary">{selectedCount}</p>
                <p className="text-[10px] text-muted-foreground">Selected</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-2 text-center">
                <p className="text-lg font-bold text-success">{Object.keys(typeGroups).length}</p>
                <p className="text-[10px] text-muted-foreground">Types</p>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={toggleAll}>
                {collections.every(c => c.selected) ? "Deselect all" : "Select all"}
              </Button>
              <div className="flex-1" />
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleExportCSV}>
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>

            {/* Collection cards grouped by type */}
            <div className="space-y-4 max-h-[55vh] overflow-y-auto">
              {Object.entries(typeGroups).map(([type, colls]) => (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {typeBadge(type)}
                    <span className="text-xs text-muted-foreground">{colls.length} collection{colls.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="space-y-2">
                    {colls.map(c => (
                      <div
                        key={c.id}
                        className={`bg-card rounded-lg border transition-all ${c.selected ? "border-primary/40" : "border-border opacity-60"}`}
                      >
                        <div className="p-3">
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={c.selected}
                              onCheckedChange={() => toggleSelect(c.id)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold">{c.title}</p>
                                {typeBadge(c.type)}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">/{c.handle}</p>

                              {/* SEO preview snippet */}
                              <div className="mt-2 bg-muted/30 rounded p-2 border border-border/50">
                                <p className="text-xs font-medium text-primary truncate">{c.seoTitle}</p>
                                <p className="text-[10px] text-muted-foreground line-clamp-2">{c.metaDescription}</p>
                              </div>

                              {/* Rules + links row */}
                              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                                <span>{c.rules.length} rule{c.rules.length !== 1 ? "s" : ""}</span>
                                {c.internalLinksTo.length > 0 && (
                                  <span className="flex items-center gap-0.5"><Link className="w-2.5 h-2.5" /> {c.internalLinksTo.length} links</span>
                                )}
                                <button
                                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                                  className="ml-auto text-primary flex items-center gap-0.5"
                                >
                                  <Eye className="w-3 h-3" /> {expandedId === c.id ? "Hide" : "Details"}
                                </button>
                              </div>

                              {/* Expanded details */}
                              {expandedId === c.id && (
                                <div className="mt-2 pt-2 border-t border-border space-y-2 animate-fade-in">
                                  <div>
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Rules</p>
                                    {c.rules.map((r, i) => (
                                      <p key={i} className="text-xs font-mono bg-muted/50 rounded px-2 py-0.5 mb-0.5">
                                        {r.column} {r.relation} "{r.condition}"
                                      </p>
                                    ))}
                                  </div>
                                  {c.bodyContent && (
                                    <div>
                                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">SEO Body Content</p>
                                      <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 max-h-32 overflow-y-auto prose prose-xs" dangerouslySetInnerHTML={{ __html: c.bodyContent.slice(0, 600) + (c.bodyContent.length > 600 ? "…" : "") }} />
                                    </div>
                                  )}
                                  {c.internalLinksTo.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5 flex items-center gap-1"><Link className="w-3 h-3" /> Internal Links</p>
                                      <div className="flex flex-wrap gap-1">
                                        {c.internalLinksTo.map((h, i) => (
                                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">/{h}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(2)}>
                View link map →
              </Button>
            </div>
          </div>
        )}

        {/* ───── STEP 2: INTERNAL LINKS ───── */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Internal Linking Strategy</h2>

            {linkingStrategy && (
              <div className="bg-card rounded-lg border border-border p-4 text-sm text-muted-foreground">
                {linkingStrategy}
              </div>
            )}

            {/* Link summary */}
            {(() => {
              const totalLinks = collections.reduce((sum, c) => sum + c.internalLinksTo.length, 0);
              const orphaned = collections.filter(c => c.internalLinksTo.length === 0 && c.selected).length;
              return (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <p className="text-2xl font-bold text-primary">{collections.filter(c => c.selected).length}</p>
                    <p className="text-xs text-muted-foreground">Collections</p>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <p className="text-2xl font-bold text-success">{totalLinks}</p>
                    <p className="text-xs text-muted-foreground">Internal links</p>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <p className={`text-2xl font-bold ${orphaned > 0 ? "text-destructive" : "text-success"}`}>{orphaned}</p>
                    <p className="text-xs text-muted-foreground">Orphaned</p>
                  </div>
                </div>
              );
            })()}

            {/* Hierarchy tree */}
            <div className="bg-card rounded-lg border border-border p-4 space-y-3 max-h-[50vh] overflow-y-auto">
              {/* Brand-level nodes */}
              {collections.filter(c => c.type === "brand" && c.selected).map(brand => (
                <div key={brand.id} className="border-l-2 border-primary/30 pl-3 space-y-1">
                  <p className="text-sm font-semibold">{brand.title} {typeBadge("brand")}</p>
                  {brand.internalLinksTo.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">→ {brand.internalLinksTo.join(", ")}</p>
                  )}
                  {/* Children */}
                  {collections.filter(c =>
                    c.selected && ["style", "category", "style_category"].includes(c.type) &&
                    c.handle.startsWith(brand.handle + "-")
                  ).map(child => (
                    <div key={child.id} className="ml-4 border-l border-muted pl-3 py-0.5">
                      <p className="text-xs">{child.title} {typeBadge(child.type)}</p>
                      {child.internalLinksTo.length > 0 && (
                        <p className="text-[10px] text-muted-foreground">→ {child.internalLinksTo.slice(0, 4).join(", ")}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {/* Broad / feature / colour nodes */}
              {collections.filter(c => c.selected && ["broad_category", "feature", "colour", "print_story", "seasonal"].includes(c.type)).map(node => (
                <div key={node.id} className="border-l-2 border-secondary/50 pl-3 space-y-0.5">
                  <p className="text-sm font-semibold">{node.title} {typeBadge(node.type)}</p>
                  {node.internalLinksTo.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">→ {node.internalLinksTo.slice(0, 4).join(", ")}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button className="flex-1" onClick={handlePushToShopify} disabled={selectedCount === 0}>
                <Sparkles className="w-4 h-4 mr-2" />
                Push {selectedCount} collection{selectedCount !== 1 ? "s" : ""} to Shopify →
              </Button>
            </div>
          </div>
        )}

        {/* ───── STEP 3: PUSH / DONE ───── */}
        {step === 3 && (
          <div className="space-y-4">
            {pushing ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-sm font-medium mb-2">Creating collections in Shopify…</p>
                <Progress value={pushProgress} className="h-2 mb-2 max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{pushProgress}% complete</p>
              </div>
            ) : (
              <>
                {/* Success summary */}
                {(() => {
                  const ok = pushResults.filter(r => r.ok).length;
                  const failed = pushResults.filter(r => !r.ok).length;
                  return (
                    <>
                      <div className="text-center py-4">
                        <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-3">
                          <Check className="w-6 h-6 text-success" />
                        </div>
                        <h2 className="text-lg font-bold">Collections Created!</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {ok} created{failed > 0 ? `, ${failed} failed` : ""}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-card rounded-lg border border-border p-3 text-center">
                          <p className="text-2xl font-bold text-success">{ok}</p>
                          <p className="text-xs text-muted-foreground">Created</p>
                        </div>
                        <div className="bg-card rounded-lg border border-border p-3 text-center">
                          <p className="text-2xl font-bold text-destructive">{failed}</p>
                          <p className="text-xs text-muted-foreground">Failed</p>
                        </div>
                      </div>

                      {/* Result list */}
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                        {pushResults.map((r, i) => (
                          <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${r.ok ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"}`}>
                            {r.ok ? <Check className="w-4 h-4 text-success shrink-0" /> : <X className="w-4 h-4 text-destructive shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{r.title}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">/{r.handle}</p>
                              {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                            </div>
                            {r.ok && (
                              <a
                                href={`https://admin.shopify.com/collections/${r.handle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <Button className="w-full" onClick={handleExportCSV}>
                          <Download className="w-4 h-4 mr-2" /> Export Matrixify CSV
                        </Button>
                        <Button variant="outline" className="w-full" onClick={onBack}>
                          Done
                        </Button>
                      </div>
                    </>
                  );
                })()}

                {onStartFlow && (
                  <WhatsNextSuggestions
                    completedFlow="collection_seo"
                    onStartFlow={onStartFlow}
                    onGoHome={onBack}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
