import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Loader2, Check, Copy, RefreshCw, Download, Eye, Code, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";

interface CollectionSEOFlowProps {
  onBack: () => void;
}

interface ParsedCollection {
  handle: string;
  title: string;
  collType: "brand" | "brand_print" | "brand_type" | "brand_cut" | "type" | "print_only" | "brand_gender_type";
  vendor: string;
  print: string | null;
  style: string | null;
  typeLabel: string;
  gender: string | null;
  seoKeyword: string;
  rules: { column: string; relation: string; condition: string }[];
  products: { handle: string; title: string }[];
  description?: {
    html: string;
    answerCapsule: string;
    wordCount: number;
    seoTitle: string;
    seoDescription: string;
    internalLinks: string[];
    generatedAt: string;
  };
  status: "pending" | "writing" | "done" | "skipped";
}

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

const SIBLING_TYPES: Record<string, string[]> = {
  "Bikini Tops": ["Bikini Bottoms", "Bikini Sets", "One Pieces", "Tankini Tops"],
  "Triangle Bikini Tops": ["Bikini Tops", "Bikini Sets", "Bandeau Bikini Tops"],
  "Bandeau Bikini Tops": ["Bikini Tops", "Triangle Bikini Tops"],
  "Bikini Bottoms": ["Bikini Tops", "Bikini Sets"],
  "One Pieces": ["Swimdresses", "Tankini Tops", "Bikini Sets"],
  "Rashies & Sunsuits": ["One Pieces", "Boardshorts"],
  "Boardshorts": ["Rashies & Sunsuits", "Mens Swimwear"],
  "Dresses": ["Kaftans & Cover Ups", "Tops", "Sarongs"],
  "Hats": ["Sunnies", "Accessories"],
  "Sunnies": ["Hats", "Accessories"],
};

function toHandle(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pluralise(type: string): string {
  if (type.endsWith("s") || type.endsWith("wear")) return type;
  if (type.endsWith("y")) return type.slice(0, -1) + "ies";
  return type + "s";
}

function parseMiddleTokens(title: string, vendor: string, type: string) {
  const lower = title.toLowerCase();
  const vendorLower = (vendor || "").toLowerCase();
  let remaining = title;
  if (vendorLower && lower.startsWith(vendorLower)) {
    remaining = title.slice(vendor.length).trim();
  }
  // Find and strip type suffix
  const typeLower = (type || "").toLowerCase();
  for (const opt of TYPE_OPTIONS) {
    const optLower = opt.toLowerCase();
    if (remaining.toLowerCase().endsWith(optLower)) {
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
  return {
    print: first,
    style: tokens.length > 1 ? tokens.slice(1).join(" ") : null,
  };
}

function detectGenderFromTags(tags: string): string | null {
  const t = (tags || "").toLowerCase();
  if (t.includes("womens") || t.includes("women")) return "Womens";
  if (t.includes("mens") || t.includes("men")) return "Mens";
  if (t.includes("kids") || t.includes("boys") || t.includes("girls")) return "Kids";
  return null;
}

function detectProductType(title: string, type: string): string {
  if (type) return type;
  const lower = title.toLowerCase();
  for (const opt of TYPE_OPTIONS) {
    if (lower.includes(opt.toLowerCase())) return opt;
  }
  return "";
}

function addToMap(map: Map<string, ParsedCollection>, coll: Omit<ParsedCollection, "status" | "products" | "description"> & { product: { handle: string; title: string } }) {
  const existing = map.get(coll.handle);
  if (existing) {
    if (!existing.products.find(p => p.handle === coll.product.handle)) {
      existing.products.push(coll.product);
    }
    return;
  }
  map.set(coll.handle, {
    handle: coll.handle,
    title: coll.title,
    collType: coll.collType,
    vendor: coll.vendor,
    print: coll.print || null,
    style: coll.style || null,
    typeLabel: coll.typeLabel || "",
    gender: coll.gender || null,
    seoKeyword: coll.seoKeyword,
    rules: coll.rules,
    products: [coll.product],
    status: "pending",
  });
}

function parseProductsToCollections(products: any[]): ParsedCollection[] {
  const map = new Map<string, ParsedCollection>();
  products.forEach(product => {
    const title = product.title || product.productTitle || "";
    const vendor = product.vendor || product.brand || "";
    const type = detectProductType(title, product.type || product.productType || "");
    const tags = product.tags || "";
    const handle = product.handle || toHandle(title);
    const prod = { handle, title };

    // Type 1 — Brand
    if (vendor) {
      addToMap(map, {
        handle: toHandle(vendor),
        title: vendor,
        collType: "brand",
        vendor,
        print: null,
        style: null,
        typeLabel: "",
        gender: null,
        seoKeyword: `${vendor} swimwear Australia`,
        rules: [{ column: "vendor", relation: "equals", condition: vendor }],
        product: prod,
      });
    }

    const { print, style } = parseMiddleTokens(title, vendor, type);

    // Type 2 — Brand + Print
    if (vendor && print) {
      addToMap(map, {
        handle: toHandle(`${vendor} ${print}`),
        title: `${vendor} ${print}`,
        collType: "brand_print",
        vendor,
        print,
        style: null,
        typeLabel: type,
        gender: null,
        seoKeyword: `${vendor} ${print} swimwear`,
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "tag", relation: "equals", condition: print.toLowerCase() },
        ],
        product: prod,
      });
    }

    // Type 3 — Brand + Type
    if (vendor && type) {
      const plural = pluralise(type);
      addToMap(map, {
        handle: toHandle(`${vendor} ${plural}`),
        title: `${vendor} ${plural}`,
        collType: "brand_type",
        vendor,
        print: null,
        style: null,
        typeLabel: type,
        gender: null,
        seoKeyword: `${vendor} ${plural} Australia`,
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "tag", relation: "equals", condition: type },
        ],
        product: prod,
      });
    }

    // Type 4 — Brand + Specific Cut
    if (vendor && style && type) {
      const cutTitle = `${vendor} ${style} ${pluralise(type)}`;
      addToMap(map, {
        handle: toHandle(cutTitle),
        title: cutTitle,
        collType: "brand_cut",
        vendor,
        print: null,
        style,
        typeLabel: type,
        gender: null,
        seoKeyword: `${vendor} ${style} ${type}`,
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "title", relation: "contains", condition: style },
        ],
        product: prod,
      });
    }

    // Type 5 — Type only
    if (type) {
      const plural = pluralise(type);
      addToMap(map, {
        handle: toHandle(plural),
        title: plural,
        collType: "type",
        vendor: "",
        print: null,
        style: null,
        typeLabel: type,
        gender: null,
        seoKeyword: `${type} Australia`,
        rules: [{ column: "tag", relation: "equals", condition: type }],
        product: prod,
      });
    }

    // Type 7 — Brand + Gender + Type
    const gender = detectGenderFromTags(tags);
    if (vendor && gender && type) {
      const gTitle = `${vendor} ${gender} ${pluralise(type)}`;
      addToMap(map, {
        handle: toHandle(gTitle),
        title: gTitle,
        collType: "brand_gender_type",
        vendor,
        print: null,
        style: null,
        typeLabel: type,
        gender,
        seoKeyword: `${vendor} ${gender} ${type}`,
        rules: [
          { column: "vendor", relation: "equals", condition: vendor },
          { column: "tag", relation: "equals", condition: gender.toLowerCase() },
          { column: "tag", relation: "equals", condition: type },
        ],
        product: prod,
      });
    }
  });

  return Array.from(map.values()).filter(c => c.products.length >= 1);
}

function buildRelatedLinks(coll: ParsedCollection, all: ParsedCollection[]): { handle: string; anchorText: string }[] {
  const links: { handle: string; anchorText: string }[] = [];
  if (coll.collType === "brand_print" || coll.collType === "brand_cut") {
    const parent = all.find(c => c.collType === "brand" && c.title === coll.vendor);
    if (parent) links.push({ handle: parent.handle, anchorText: `${coll.vendor} swimwear` });
    all.filter(c => c.collType === "brand_type" && c.vendor === coll.vendor).slice(0, 3)
      .forEach(c => links.push({ handle: c.handle, anchorText: c.title.toLowerCase() }));
  }
  if (coll.collType === "brand") {
    all.filter(c => (c.collType === "brand_print" || c.collType === "brand_type") && c.vendor === coll.title && c.products.length > 0)
      .slice(0, 5).forEach(c => links.push({ handle: c.handle, anchorText: c.title.toLowerCase() }));
  }
  if (coll.collType === "brand_type") {
    const parent = all.find(c => c.collType === "brand" && c.title === coll.vendor);
    if (parent) links.push({ handle: parent.handle, anchorText: `all ${coll.vendor} swimwear` });
    all.filter(c => c.collType === "brand_type" && c.vendor === coll.vendor && c.handle !== coll.handle)
      .slice(0, 3).forEach(c => links.push({ handle: c.handle, anchorText: c.title.toLowerCase() }));
    const siblings = SIBLING_TYPES[pluralise(coll.typeLabel)] || [];
    all.filter(c => c.collType === "type" && siblings.some(s => c.title.includes(s)))
      .slice(0, 2).forEach(c => links.push({ handle: c.handle, anchorText: c.title.toLowerCase() }));
  }
  if (coll.collType === "type") {
    all.filter(c => c.collType === "brand_type" && c.typeLabel === coll.typeLabel)
      .slice(0, 4).forEach(c => links.push({ handle: c.handle, anchorText: `${c.vendor} ${coll.typeLabel}` }));
    const siblings = SIBLING_TYPES[coll.title] || SIBLING_TYPES[pluralise(coll.typeLabel)] || [];
    all.filter(c => c.collType === "type" && siblings.some(s => c.title.includes(s)))
      .slice(0, 2).forEach(c => links.push({ handle: c.handle, anchorText: c.title.toLowerCase() }));
  }
  return links.slice(0, 6);
}

function generateSmartCollectionsCSV(collections: ParsedCollection[]): string {
  const headers = [
    "Handle", "Command", "Title", "Body HTML", "Sort Order", "Published",
    "Must Match", "SEO Title", "SEO Description",
    "Rule: Product Column", "Rule: Relation", "Rule: Condition"
  ];
  const rows = [headers.map(h => `"${h}"`).join(",")];
  collections.forEach(c => {
    c.rules.forEach((rule, i) => {
      const row = [
        i === 0 ? c.handle : "",
        i === 0 ? "MERGE" : "",
        i === 0 ? c.title : "",
        i === 0 ? (c.description?.html || "") : "",
        i === 0 ? "created-desc" : "",
        i === 0 ? "TRUE" : "",
        i === 0 ? "all" : "",
        i === 0 ? (c.description?.seoTitle || "") : "",
        i === 0 ? (c.description?.seoDescription || "") : "",
        rule.column, rule.relation, rule.condition
      ];
      rows.push(row.map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","));
    });
  });
  return "\uFEFF" + rows.join("\n");
}

const STEPS = ["Parse", "Descriptions", "Links", "Export"];

export default function CollectionSEOFlow({ onBack }: CollectionSEOFlowProps) {
  const [step, setStep] = useState(0);
  const [collections, setCollections] = useState<ParsedCollection[]>([]);
  const [source, setSource] = useState<"invoice" | "paste">("invoice");
  const [pasteText, setPasteText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"preview" | "html" | "seo">("preview");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load saved collections
  useEffect(() => {
    try {
      const saved = localStorage.getItem("seo_collections_generated");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setCollections(parsed);
      }
    } catch {}
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (collections.length > 0) {
      localStorage.setItem("seo_collections_generated", JSON.stringify(collections));
    }
  }, [collections]);

  const handleParse = () => {
    let products: any[] = [];
    if (source === "invoice") {
      try {
        products = JSON.parse(localStorage.getItem("invoice_lines") || "[]");
      } catch { products = []; }
      if (products.length === 0) {
        try {
          products = JSON.parse(localStorage.getItem("sonic_scan_batch") || "[]");
        } catch { products = []; }
      }
    } else if (source === "paste") {
      products = pasteText.split("\n").filter(l => l.trim()).map(line => {
        const parts = line.trim().split("|").map(p => p.trim());
        return { title: parts[0] || line.trim(), vendor: parts[1] || "", type: parts[2] || "", tags: parts[3] || "", handle: toHandle(parts[0] || line.trim()) };
      });
    }
    if (products.length === 0) {
      toast.error("No products found. Import an invoice first or paste product titles.");
      return;
    }
    const parsed = parseProductsToCollections(products);
    setCollections(parsed);
    addAuditEntry("Collection SEO", `Parsed ${products.length} products → ${parsed.length} collections`);
    toast.success(`Parsed ${products.length} products → ${parsed.length} collections`);
    setStep(1);
  };

  const handleGenerateAll = async () => {
    const pending = collections.filter(c => c.status === "pending");
    if (pending.length === 0) { toast("All descriptions already written"); return; }
    setGenerating(true);
    setGenProgress({ done: 0, total: pending.length });

    const storeName = localStorage.getItem("store_name") || "our store";
    const storeCity = localStorage.getItem("store_city") || "Australia";
    const storeUrl = localStorage.getItem("store_website") || "";
    const locale = localStorage.getItem("store_locale") || "AU";

    for (let i = 0; i < pending.length; i += 5) {
      const batch = pending.slice(i, i + 5);
      const batchInput = batch.map(c => ({
        title: c.title,
        collection_type: c.collType,
        products: c.products.slice(0, 5),
        tags: c.typeLabel,
        vendor: c.vendor,
      }));

      try {
        const { data, error } = await supabase.functions.invoke("collection-seo", {
          body: { collections: batchInput, storeName, storeCity, locale, industry: "swimwear" },
        });
        if (error) throw error;
        const results = data?.results || [];
        setCollections(prev => {
          const updated = [...prev];
          batch.forEach((c, idx) => {
            const collIdx = updated.findIndex(u => u.handle === c.handle);
            if (collIdx >= 0 && results[idx]) {
              const r = results[idx];
              updated[collIdx] = {
                ...updated[collIdx],
                status: "done",
                description: {
                  html: `${r.intro_text || ""}${r.seo_content || ""}`,
                  answerCapsule: (r.intro_text || "").replace(/<[^>]+>/g, "").slice(0, 200),
                  wordCount: ((r.intro_text || "") + (r.seo_content || "")).replace(/<[^>]+>/g, "").split(/\s+/).length,
                  seoTitle: r.meta_title || c.title,
                  seoDescription: r.meta_description || "",
                  internalLinks: r.related_collections || [],
                  generatedAt: new Date().toISOString(),
                },
              };
            }
          });
          return updated;
        });
      } catch (err: any) {
        console.error("Generation error:", err);
        toast.error(err?.message || "Failed to generate descriptions");
      }
      setGenProgress(p => ({ ...p, done: Math.min(i + 5, pending.length) }));
    }

    setGenerating(false);
    addAuditEntry("Collection SEO", `Generated descriptions for ${pending.length} collections`);
    toast.success("Descriptions generated!");
  };

  const handleExport = (type: "smart" | "descriptions") => {
    const written = collections.filter(c => c.status === "done");
    if (written.length === 0) { toast.error("No descriptions written yet"); return; }

    let csv: string;
    let filename: string;
    if (type === "smart") {
      csv = generateSmartCollectionsCSV(written);
      filename = "Smart Collections.csv";
    } else {
      const headers = ["Handle", "Body HTML", "SEO Title", "SEO Description"];
      const rows = [headers.map(h => `"${h}"`).join(",")];
      written.forEach(c => {
        rows.push([c.handle, c.description?.html || "", c.description?.seoTitle || "", c.description?.seoDescription || ""]
          .map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","));
      });
      csv = "\uFEFF" + rows.join("\n");
      filename = "Collection Descriptions.csv";
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addAuditEntry("Collection SEO", `Exported ${filename} — ${written.length} collections`);
    toast.success(`Downloaded ${filename}`);
  };

  const copyHtml = (html: string) => {
    navigator.clipboard.writeText(html);
    toast.success("HTML copied");
  };

  const collTypeBadge = (t: string) => {
    const map: Record<string, { label: string; color: string }> = {
      brand: { label: "Brand", color: "bg-primary/15 text-primary" },
      brand_print: { label: "Print", color: "bg-accent/15 text-accent-foreground" },
      brand_type: { label: "Type", color: "bg-success/15 text-success" },
      brand_cut: { label: "Cut", color: "bg-warning/15 text-warning" },
      type: { label: "Type Only", color: "bg-secondary text-secondary-foreground" },
      brand_gender_type: { label: "Gender+Type", color: "bg-muted text-muted-foreground" },
    };
    const m = map[t] || { label: t, color: "bg-muted text-muted-foreground" };
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m.color}`}>{m.label}</span>;
  };

  const statusBadge = (s: string) => {
    if (s === "done") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success">✓ Done</span>;
    if (s === "writing") return <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">Writing...</span>;
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Pending</span>;
  };

  const doneCount = collections.filter(c => c.status === "done").length;
  const byType = (t: string) => collections.filter(c => c.collType === t).length;

  const selectedColl = selected ? collections.find(c => c.handle === selected) : null;

  // Build link map data for Step 3
  const buildLinkMap = () => {
    return collections.map(c => ({
      handle: c.handle,
      title: c.title,
      collType: c.collType,
      links: buildRelatedLinks(c, collections),
    }));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold font-display">Collection SEO</h1>
        <p className="text-sm text-muted-foreground mt-1">Turn product names into rankable collection pages</p>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mt-4 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <button
                onClick={() => i <= step && setStep(i)}
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
        {/* ───── STEP 0: PARSE ───── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg border border-border p-4">
              <h2 className="text-base font-semibold mb-2">Source products</h2>
              <div className="space-y-2">
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
                  className="w-full mt-3 p-3 rounded-md border border-border bg-background text-sm font-mono-data min-h-[120px]"
                  placeholder={"Tigerlily Caya Tara Triangle Bikini Top\nSeafolly Collective Belted One Piece\nBond-Eye The One Piece"}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                />
              )}
            </div>
            <Button className="w-full h-12 text-base" onClick={handleParse}>
              Parse products <ChevronRight className="w-4 h-4 ml-1" />
            </Button>

            {collections.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold">Last parsed: {collections.length} collections</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/50 rounded p-2">Brand: <strong>{byType("brand")}</strong></div>
                  <div className="bg-muted/50 rounded p-2">Brand+Print: <strong>{byType("brand_print")}</strong></div>
                  <div className="bg-muted/50 rounded p-2">Brand+Type: <strong>{byType("brand_type")}</strong></div>
                  <div className="bg-muted/50 rounded p-2">Brand+Cut: <strong>{byType("brand_cut")}</strong></div>
                  <div className="bg-muted/50 rounded p-2">Type only: <strong>{byType("type")}</strong></div>
                  <div className="bg-muted/50 rounded p-2">Done: <strong>{doneCount}</strong></div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {collections.slice(0, 15).map(c => (
                    <span key={c.handle} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {c.title}
                    </span>
                  ))}
                  {collections.length > 15 && <span className="text-[10px] text-muted-foreground">+{collections.length - 15} more</span>}
                </div>
                <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                  Continue to descriptions →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ───── STEP 1: DESCRIPTIONS ───── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{doneCount}/{collections.length} descriptions written</p>
              </div>
              <Button onClick={handleGenerateAll} disabled={generating} size="sm">
                {generating ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {genProgress.done}/{genProgress.total}</> : "Write all"}
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: queue */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {collections.map(c => (
                  <button
                    key={c.handle}
                    onClick={() => setSelected(c.handle)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${selected === c.handle ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate flex-1">{c.title}</span>
                      {collTypeBadge(c.collType)}
                      {statusBadge(c.status)}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{c.products.length} products · {c.seoKeyword}</p>
                  </button>
                ))}
              </div>

              {/* Right: preview */}
              <div className="bg-card rounded-lg border border-border p-4">
                {selectedColl ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold flex-1">{selectedColl.title}</h3>
                      {collTypeBadge(selectedColl.collType)}
                    </div>
                    {selectedColl.description ? (
                      <>
                        <div className="flex gap-1 border-b border-border">
                          {(["preview", "html", "seo"] as const).map(tab => (
                            <button key={tab} onClick={() => setViewTab(tab)}
                              className={`text-xs px-3 py-1.5 border-b-2 transition-colors ${viewTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                              {tab === "preview" ? <Eye className="w-3 h-3" /> : tab === "html" ? <Code className="w-3 h-3" /> : <Search className="w-3 h-3" />}
                              <span className="ml-1 capitalize">{tab}</span>
                            </button>
                          ))}
                        </div>
                        {viewTab === "preview" && (
                          <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: selectedColl.description.html }} />
                        )}
                        {viewTab === "html" && (
                          <div className="relative">
                            <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono-data">{selectedColl.description.html}</pre>
                            <Button variant="ghost" size="sm" className="absolute top-1 right-1" onClick={() => copyHtml(selectedColl.description!.html)}>
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        {viewTab === "seo" && (
                          <div className="space-y-2 text-sm">
                            <div className="bg-muted/50 rounded p-3">
                              <p className="text-xs text-muted-foreground">SEO Title ({selectedColl.description.seoTitle.length} chars)</p>
                              <p className="font-medium text-primary">{selectedColl.description.seoTitle}</p>
                            </div>
                            <div className="bg-muted/50 rounded p-3">
                              <p className="text-xs text-muted-foreground">Meta Description ({selectedColl.description.seoDescription.length} chars)</p>
                              <p>{selectedColl.description.seoDescription}</p>
                            </div>
                            <div className="bg-muted/50 rounded p-3">
                              <p className="text-xs text-muted-foreground">Word count</p>
                              <p className="font-medium">{selectedColl.description.wordCount} words</p>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Description not yet generated. Click "Write all" to generate.</p>
                    )}
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><strong>Handle:</strong> {selectedColl.handle}</p>
                      <p><strong>Rules:</strong> {selectedColl.rules.map(r => `${r.column} ${r.relation} "${r.condition}"`).join(" AND ")}</p>
                      <p><strong>Products:</strong> {selectedColl.products.map(p => p.title).join(", ")}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic text-center py-8">Select a collection to preview</p>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(2)}>View link map →</Button>
            </div>
          </div>
        )}

        {/* ───── STEP 2: LINK MAP ───── */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Internal linking map</h2>
            <p className="text-sm text-muted-foreground">See how collection pages link to each other.</p>

            {(() => {
              const linkMap = buildLinkMap();
              const totalLinks = linkMap.reduce((sum, c) => sum + c.links.length, 0);
              const orphaned = linkMap.filter(c => c.links.length === 0).length;

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-primary">{linkMap.length}</p>
                      <p className="text-xs text-muted-foreground">Collections</p>
                    </div>
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-success">{totalLinks}</p>
                      <p className="text-xs text-muted-foreground">Total links</p>
                    </div>
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className={`text-2xl font-bold ${orphaned > 0 ? "text-destructive" : "text-success"}`}>{orphaned}</p>
                      <p className="text-xs text-muted-foreground">Orphaned</p>
                    </div>
                  </div>

                  {/* Hierarchy tree */}
                  <div className="bg-card rounded-lg border border-border p-4 space-y-3 max-h-[50vh] overflow-y-auto">
                    {/* Brand-level nodes */}
                    {linkMap.filter(c => c.collType === "brand").map(brand => (
                      <div key={brand.handle} className="border-l-2 border-primary/30 pl-3 space-y-1">
                        <p className="text-sm font-semibold">{brand.title} {collTypeBadge("brand")}</p>
                        {brand.links.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">→ {brand.links.map(l => l.anchorText).join(", ")}</p>
                        )}
                        {/* Children */}
                        {linkMap.filter(c => (c.collType === "brand_print" || c.collType === "brand_type" || c.collType === "brand_cut") && collections.find(cc => cc.handle === c.handle)?.vendor === brand.title).map(child => (
                          <div key={child.handle} className="ml-4 border-l border-muted pl-3 py-0.5">
                            <p className="text-xs">{child.title} {collTypeBadge(child.collType)}</p>
                            {child.links.length > 0 && (
                              <p className="text-[10px] text-muted-foreground">→ {child.links.map(l => l.anchorText).join(", ")}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                    {/* Type-only nodes */}
                    {linkMap.filter(c => c.collType === "type").map(typeNode => (
                      <div key={typeNode.handle} className="border-l-2 border-secondary/50 pl-3 space-y-1">
                        <p className="text-sm font-semibold">{typeNode.title} {collTypeBadge("type")}</p>
                        {typeNode.links.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">→ {typeNode.links.map(l => l.anchorText).join(", ")}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(3)}>Export →</Button>
            </div>
          </div>
        )}

        {/* ───── STEP 3: EXPORT ───── */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Export collection pages</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-primary">{collections.length}</p>
                <p className="text-xs text-muted-foreground">Total collections</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-success">{doneCount}</p>
                <p className="text-xs text-muted-foreground">With descriptions</p>
              </div>
            </div>

            <div className="space-y-3">
              <Button className="w-full h-12 text-base" onClick={() => handleExport("smart")}>
                <Download className="w-4 h-4 mr-2" /> Smart Collections.csv
              </Button>
              <Button variant="outline" className="w-full h-12 text-base" onClick={() => handleExport("descriptions")}>
                <Download className="w-4 h-4 mr-2" /> Descriptions only.csv
              </Button>
            </div>

            <details className="bg-muted/30 rounded-lg p-4">
              <summary className="text-sm font-medium cursor-pointer">How to import into Shopify via Matrixify</summary>
              <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal ml-4">
                <li>Open Matrixify → New Import</li>
                <li>Upload <strong>Smart Collections.csv</strong></li>
                <li>Wait for analysis — confirm it shows "Smart Collections" as the detected type</li>
                <li>Click Import</li>
                <li>Verify collections appear in Shopify Admin → Products → Collections</li>
              </ol>
            </details>

            <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
          </div>
        )}
      </div>
    </div>
  );
}
