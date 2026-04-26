// ════════════════════════════════════════════════════════════
// Phase 3 + Phase 4 Panel
// Mounts above PostParseReviewScreen once products are validated.
//
// Phase 3 — Stock Check
//   - Reads the user's cached catalog from product_catalog_cache
//     (Shopify or Lightspeed, whichever the user picked in Phase 1).
//   - Classifies every line via the existing legacy classifier
//     (refill / new_colour / new_product) — no new logic.
//   - Renders stat bar + grouped table + "Connect POS" banner if no
//     catalog cached.
//
// Phase 4 — Enrich (new products only)
//   - For each NEW product, fires three parallel background jobs:
//       1. price-lookup-search  → market RRP (AUD)
//       2. fetch-product-description → brand/retailer description
//       3. image-search → product image URL
//   - Non-blocking. Live progress + per-row updates. Failures show
//     "Fetch manually" but never block the rest of the flow.
//
// ════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  classifyAllItems,
  type InvoiceLineItem,
  type ShopifyVariant,
  type ClassifiedItem,
} from "@/lib/stock-matcher-legacy";
import type { ValidatedProduct } from "@/lib/invoice-validator";
import { Loader2, Package, RefreshCw, Sparkles, AlertCircle, CheckCircle2, ImageIcon, FileText, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type Pos = "shopify" | "lightspeed";

interface CatalogRow {
  platform_product_id: string;
  platform_variant_id: string | null;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  variant_title: string | null;
  colour: string | null;
  size: string | null;
  current_qty: number | null;
  current_cost: number | null;
  current_price: number | null;
}

interface EnrichState {
  price?: { value: number; source: string } | null;
  description?: string | null;
  imageUrl?: string | null;
  status: "pending" | "running" | "done" | "failed";
  errors: string[];
}

interface PhaseThreeFourPanelProps {
  products: ValidatedProduct[];
  supplierName?: string | null;
  /** Called when the user chooses to skip enrichment and jump to review. */
  onProceed?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────
function getPreferredPos(): Pos {
  const v = localStorage.getItem("preferred_pos");
  return v === "lightspeed" ? "lightspeed" : "shopify";
}

function toLineItem(p: ValidatedProduct, idx: number): InvoiceLineItem {
  return {
    styleNumber: (p as any).style_number || p.sku || `line-${idx}`,
    styleName: p.name || "Untitled",
    colour: p.colour || "",
    colourCode: "",
    size: p.size || "",
    barcode: (p as any).barcode || "",
    sku: p.sku || "",
    brand: p.brand || "",
    quantityOrdered: Number(p.qty) || 0,
    rrp: Number(p.rrp) || 0,
    wholesale: Number(p.cost) || 0,
  };
}

// Convert a flat catalog cache row → minimal ShopifyVariant the
// legacy classifier understands. One product per platform_product_id;
// variants grouped under it.
//
// `vendorHint` is the supplier we're currently importing from. When the
// cache row has no `vendor` (legacy rows synced before the column existed),
// we fall back to detecting the vendor by checking whether the supplier
// name appears as a prefix in the product title — this is how Shopify
// stores Walnut Melbourne / similar brands when vendor is empty.
function catalogToVariants(
  rows: CatalogRow[],
  vendorHint?: string | null,
): ShopifyVariant[] {
  const productMap = new Map<string, ShopifyVariant["product"]>();
  const variants: ShopifyVariant[] = [];
  const hint = (vendorHint || "").trim().toLowerCase();

  for (const r of rows) {
    if (!productMap.has(r.platform_product_id)) {
      let vendor = (r as CatalogRow & { vendor?: string | null }).vendor || "";
      if (!vendor && hint) {
        const title = (r.product_title || "").toLowerCase();
        if (title.startsWith(hint)) vendor = vendorHint as string;
      }
      productMap.set(r.platform_product_id, {
        id: r.platform_product_id,
        title: r.product_title || "",
        vendor,
        productType: "",
        tags: [],
        options: [],
        variants: [],
      });
    }
  }

  for (const r of rows) {
    const product = productMap.get(r.platform_product_id)!;
    const v: ShopifyVariant = {
      id: r.platform_variant_id || r.platform_product_id,
      sku: r.sku || "",
      barcode: r.barcode || "",
      title: r.variant_title || `${r.colour || ""} / ${r.size || ""}`.trim(),
      inventoryItemId: r.platform_variant_id || "",
      inventoryQty: r.current_qty ?? 0,
      price: String(r.current_price ?? ""),
      option1: r.colour || "",
      option2: r.size || "",
      product,
    };
    product.variants.push(v);
    variants.push(v);
  }

  return variants;
}

// ─── Component ────────────────────────────────────────────────
const PhaseThreeFourPanel = ({ products, supplierName, onProceed }: PhaseThreeFourPanelProps) => {
  const pos = useMemo<Pos>(() => getPreferredPos(), []);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogConnected, setCatalogConnected] = useState(false);
  const [classified, setClassified] = useState<ClassifiedItem[] | null>(null);
  const [enrichMap, setEnrichMap] = useState<Record<string, EnrichState>>({});
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const startedRef = useRef(false);

  // Stable list of accepted line items
  const acceptedItems = useMemo(
    () => products.filter(p => !p._rejected),
    [products],
  );

  // ─── Phase 3 — load catalog & classify ──────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) {
            setCatalogConnected(false);
            // Still classify with empty catalog → everything "new"
            const items = acceptedItems.map(toLineItem);
            const result = classifyAllItems(items, []);
            setClassified(result.classified_items);
          }
          return;
        }

        const { data, error } = await supabase
          .from("product_catalog_cache")
          .select("platform_product_id, platform_variant_id, sku, barcode, product_title, variant_title, colour, size, current_qty, current_cost, current_price")
          .eq("user_id", user.id)
          .eq("platform", pos)
          .limit(5000);

        if (cancelled) return;

        const rows = (data ?? []) as CatalogRow[];
        setCatalogConnected(rows.length > 0);

        const variants = catalogToVariants(rows);
        const items = acceptedItems.map(toLineItem);
        const result = classifyAllItems(items, variants);
        setClassified(result.classified_items);

        if (error) console.warn("[Phase3] catalog load error:", error);
        console.log(`[Phase3] catalog=${rows.length} items=${items.length} refills=${result.summary.refills} new_colours=${result.summary.new_colours} new_products=${result.summary.new_products}`);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [acceptedItems, pos]);

  // ─── Phase 4 — parallel enrichment for new products only ────
  useEffect(() => {
    if (!classified || startedRef.current) return;
    const newOnesAll = classified.filter(c => c.classification === "new_product" || c.classification === "new_colour");
    if (newOnesAll.length === 0) return;

    // Deduplicate: one enrichment call per unique brand+styleName combination.
    // Without this, every variant (size/colour) of the same product triggers a
    // separate fetch-product-description / image-search / websearch call.
    const seen = new Set<string>();
    const newOnes = newOnesAll.filter(c => {
      const ol = c.original_line as unknown as Record<string, unknown>;
      const key = [
        String(ol.vendor || ol.brand || supplierName || ""),
        String(ol.product_title || ol.title || ol.styleName || ol.name || ""),
      ].join("|").toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(
      "[PhaseThreeFour] dedup:",
      newOnesAll.length,
      "→",
      newOnes.length,
      "items. Keys:",
      Array.from(seen).join(", "),
    );
    if (newOnes.length === 0) return;

    startedRef.current = true;
    setEnrichRunning(true);

    // Init pending state — keyed off the same dedup list so UI reflects 1 row per product.
    const initial: Record<string, EnrichState> = {};
    newOnes.forEach(c => {
      initial[keyFor(c)] = { status: "pending", errors: [] };
    });
    setEnrichMap(initial);

    // Concurrency-limited parallel runner — keep it gentle for edge fns.
    const CONCURRENCY = 3;
    let cursor = 0;
    let inflight = 0;
    let done = 0;

    const finish = () => {
      done++;
      if (done >= newOnes.length) setEnrichRunning(false);
    };

    const next = () => {
      while (inflight < CONCURRENCY && cursor < newOnes.length) {
        const item = newOnes[cursor++];
        inflight++;
        runEnrich(item, supplierName || "")
          .then(result => {
            setEnrichMap(prev => ({ ...prev, [keyFor(item)]: result }));
          })
          .catch(err => {
            setEnrichMap(prev => ({
              ...prev,
              [keyFor(item)]: { status: "failed", errors: [String(err?.message || err)] },
            }));
          })
          .finally(() => {
            inflight--;
            finish();
            next();
          });
      }
    };
    next();
  }, [classified, supplierName]);

  // ─── Render ──────────────────────────────────────────────────
  if (catalogLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 mb-3 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm">Checking against your {pos === "shopify" ? "Shopify" : "Lightspeed"} catalog…</span>
      </div>
    );
  }

  if (!classified) return null;

  const counts = {
    refills: classified.filter(c => c.classification === "refill").length,
    new_colours: classified.filter(c => c.classification === "new_colour").length,
    new_products: classified.filter(c => c.classification === "new_product").length,
  };
  const total = classified.length;
  const enrichTotal = Object.keys(enrichMap).length;
  const enrichDone = Object.values(enrichMap).filter(e => e.status === "done" || e.status === "failed").length;

  return (
    <div className="rounded-lg border border-border bg-card mb-3 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
          3
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Stock check &amp; enrichment</div>
          <div className="text-xs text-muted-foreground">
            {total} line{total === 1 ? "" : "s"} classified against your {pos === "shopify" ? "Shopify" : "Lightspeed"} catalog
          </div>
        </div>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* ── Connect POS banner ── */}
          {!catalogConnected && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
              <div className="text-xs">
                <div className="font-semibold text-warning">No {pos} catalog cached</div>
                <div className="text-muted-foreground mt-0.5">
                  Connect {pos === "shopify" ? "Shopify" : "Lightspeed"} to automatically identify new vs existing stock.
                  All items have been treated as new for now — you can still proceed.
                </div>
              </div>
            </div>
          )}

          {/* ── Stat bar ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="New products" value={counts.new_products} tone="primary" icon={<Package className="w-3.5 h-3.5" />} />
            <Stat label="Exact refills" value={counts.refills} tone="success" icon={<RefreshCw className="w-3.5 h-3.5" />} />
            <Stat label="New variants" value={counts.new_colours} tone="info" icon={<Sparkles className="w-3.5 h-3.5" />} />
            <Stat label="Total lines" value={total} tone="muted" icon={<FileText className="w-3.5 h-3.5" />} />
          </div>

          {/* ── Enrichment progress ── */}
          {enrichTotal > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Enriching {enrichTotal} new product{enrichTotal === 1 ? "" : "s"} — prices, descriptions, images
                </div>
                <span className="text-xs font-mono-data text-muted-foreground">{enrichDone}/{enrichTotal}</span>
              </div>
              <div className="h-1.5 bg-muted rounded overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${enrichTotal === 0 ? 0 : (enrichDone / enrichTotal) * 100}%` }}
                />
              </div>
              {!enrichRunning && enrichDone === enrichTotal && (
                <div className="mt-1.5 text-[11px] text-success flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Enrichment complete
                </div>
              )}
            </div>
          )}

          {/* ── Classified table ── */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Product</th>
                  <th className="text-left px-2 py-1.5 font-medium">Variant</th>
                  <th className="text-left px-2 py-1.5 font-medium">Status</th>
                  <th className="text-left px-2 py-1.5 font-medium">Enrichment</th>
                </tr>
              </thead>
              <tbody>
                {classified.map((c, i) => {
                  const k = keyFor(c);
                  const enrich = enrichMap[k];
                  return (
                    <tr key={i} className="border-t border-border hover:bg-muted/20">
                      <td className="px-2 py-1.5">
                        <div className="font-medium truncate max-w-[200px]">{c.original_line.styleName}</div>
                        {c.original_line.brand && (
                          <div className="text-[10px] text-muted-foreground truncate">{c.original_line.brand}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono-data text-[11px] text-muted-foreground">
                        {[c.original_line.colour, c.original_line.size].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-2 py-1.5"><Badge classification={c.classification} /></td>
                      <td className="px-2 py-1.5">
                        {c.classification === "refill" ? (
                          <span className="text-[10px] text-muted-foreground">Update qty only</span>
                        ) : enrich ? (
                          <EnrichCell state={enrich} />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Action ── */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onProceed}
              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90"
            >
              Continue to review →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────
function keyFor(c: ClassifiedItem) {
  return `${c.original_line.sku || c.original_line.styleName}-${c.original_line.colour}-${c.original_line.size}`;
}

async function runEnrich(c: ClassifiedItem, supplierName: string): Promise<EnrichState> {
  const errors: string[] = [];

  const [priceRes, descRes, imageRes] = await Promise.allSettled([
    supabase.functions.invoke("price-lookup-search", {
      body: {
        // Brand-first product_name so the search engine query leads with the brand.
        product_name: `${c.original_line.brand || supplierName} ${c.original_line.styleName}`.trim(),
        supplier: c.original_line.brand || supplierName,
        style_number: c.original_line.sku || "",
        colour: c.original_line.colour || undefined,
      },
    }),
    supabase.functions.invoke("fetch-product-description", {
      body: {
        style_name: c.original_line.styleName,
        brand: c.original_line.brand || supplierName,
        style_number: c.original_line.sku || "",
        product_type: (c.original_line as { type?: string }).type || undefined,
      },
    }),
    supabase.functions.invoke("image-search", {
      body: {
        // image-search expects a `products` array, NOT a single `query` string.
        // Brand-first so the AI anchors on the correct label.
        products: [{
          searchQuery: `${c.original_line.brand || supplierName} ${c.original_line.styleName} ${c.original_line.colour || ""}`.trim(),
          brand: c.original_line.brand || supplierName,
          styleName: c.original_line.styleName,
          styleNumber: c.original_line.sku || "",
          colour: c.original_line.colour || "",
        }],
      },
    }),
  ]);

  // Price
  let price: { value: number; source: string } | null = null;
  if (priceRes.status === "fulfilled" && !priceRes.value.error) {
    const top = priceRes.value.data?.results?.[0];
    if (top?.price && top.price > 0) price = { value: Number(top.price), source: top.url || "web" };
  } else if (priceRes.status === "rejected") {
    errors.push("price");
  }

  // Description
  let description: string | null = null;
  if (descRes.status === "fulfilled" && !descRes.value.error) {
    description = descRes.value.data?.description || null;
  } else if (descRes.status === "rejected") {
    errors.push("description");
  }

  // Image
  let imageUrl: string | null = null;
  if (imageRes.status === "fulfilled" && !imageRes.value.error) {
    // image-search returns `{ results: [{ idx, imageUrl, source }] }`
    imageUrl = imageRes.value.data?.results?.[0]?.imageUrl || imageRes.value.data?.results?.[0]?.url || null;
  } else if (imageRes.status === "rejected") {
    errors.push("image");
  }

  const anyHit = !!(price || description || imageUrl);
  return {
    price,
    description,
    imageUrl,
    status: anyHit ? "done" : (errors.length ? "failed" : "done"),
    errors,
  };
}

// ─── Sub-components ──────────────────────────────────────────
const Stat = ({ label, value, tone, icon }: {
  label: string; value: number; tone: "primary" | "success" | "info" | "muted"; icon: React.ReactNode;
}) => (
  <div className={cn(
    "rounded-md border p-2",
    tone === "primary" && "border-primary/30 bg-primary/5",
    tone === "success" && "border-success/30 bg-success/5",
    tone === "info" && "border-secondary/30 bg-secondary/5",
    tone === "muted" && "border-border bg-muted/30",
  )}>
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
      {icon}{label}
    </div>
    <div className="text-xl font-bold font-mono-data mt-0.5">{value}</div>
  </div>
);

const Badge = ({ classification }: { classification: ClassifiedItem["classification"] }) => {
  if (classification === "refill") {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/15 text-success">Update qty only</span>;
  }
  if (classification === "new_colour") {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary/15 text-secondary-foreground">New variant</span>;
  }
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary">New product</span>;
};

const EnrichCell = ({ state }: { state: EnrichState }) => {
  if (state.status === "pending" || state.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Fetching…
      </span>
    );
  }
  if (state.status === "failed") {
    return <span className="text-[10px] text-warning">Fetch manually</span>;
  }
  return (
    <div className="flex items-center gap-2 text-[10px]">
      {state.price && (
        <span className="inline-flex items-center gap-0.5 text-success" title={state.price.source}>
          <DollarSign className="w-2.5 h-2.5" />{state.price.value.toFixed(0)}
        </span>
      )}
      {state.description && (
        <span className="inline-flex items-center gap-0.5 text-primary" title="Description fetched">
          <FileText className="w-2.5 h-2.5" />Desc
        </span>
      )}
      {state.imageUrl && (
        <span className="inline-flex items-center gap-0.5 text-secondary-foreground" title={state.imageUrl}>
          <ImageIcon className="w-2.5 h-2.5" />Img
        </span>
      )}
      {!state.price && !state.description && !state.imageUrl && (
        <span className="text-muted-foreground">No results</span>
      )}
    </div>
  );
};

export default PhaseThreeFourPanel;
