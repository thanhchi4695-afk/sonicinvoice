// ══════════════════════════════════════════════════════════
// Phase 3 — Price Research Orchestrator
// For each extracted invoice product, run price research in
// priority order:
//   1. price-lookup-search → supplier/retailer scrape (Firecrawl)
//   2. price-intelligence  → Google Shopping / barcode APIs (waterfall)
//   3. markup fallback     → cost × multiplier (e.g. 2.2 swimwear)
// Persists results to price_lookups and returns a summary.
// ══════════════════════════════════════════════════════════

import { supabase } from "@/integrations/supabase/client";
import { matchPrice, type PriceProduct } from "@/lib/price-intelligence";

export interface Phase3Item {
  product_title: string;
  vendor?: string;
  sku?: string;
  barcode?: string;
  unit_cost?: number;
  rrp?: number;
  product_type?: string;
}

export interface Phase3ProductResult {
  product_title: string;
  vendor?: string;
  recommended_rrp: number | null;
  price_source: "website" | "supplier_scrape" | "ai_search" | "market_waterfall" | "markup_fallback" | "none";
  confidence: number;
  source_url?: string;
  description?: string;
  image_url?: string;
  /** Provider/cache info for the new ai_search tier — surfaced on hover. */
  source_meta?: {
    provider?: "anthropic-websearch" | "brave-search";
    query?: string;
    cacheHit?: boolean;
    costAud?: number;
  };
  error?: string;
}

export interface Phase3Summary {
  total: number;
  succeeded: number;
  failed: number;
  bySource: Record<string, number>;
  results: Phase3ProductResult[];
}

// Default markup multipliers — used when no web price found.
// Conservative defaults; can be tuned per industry profile.
const DEFAULT_MARKUP_BY_TYPE: Record<string, number> = {
  swimwear: 2.4,
  bikini: 2.4,
  apparel: 2.5,
  clothing: 2.5,
  accessories: 2.8,
  beauty: 2.2,
  default: 2.4,
};

function pickMarkup(productType?: string): number {
  if (!productType) return DEFAULT_MARKUP_BY_TYPE.default;
  const lower = productType.toLowerCase();
  for (const [key, mult] of Object.entries(DEFAULT_MARKUP_BY_TYPE)) {
    if (lower.includes(key)) return mult;
  }
  return DEFAULT_MARKUP_BY_TYPE.default;
}

async function callWebsiteRRP(item: Phase3Item): Promise<Phase3ProductResult | null> {
  if (!item.vendor || !item.product_title) return null;
  try {
    const { data, error } = await supabase.functions.invoke(
      "supplier-website-rrp",
      {
        body: {
          vendor: item.vendor,
          style_name: item.product_title,
          style_number: item.sku || "",
          // Forward colour so the registry matcher can disambiguate
          // multi-colourway products like "Reid Leather Sandal".
          colour: (item as Phase3Item & { colour?: string }).colour || "",
        },
      },
    );
    if (error) return null;
    const d = data as {
      found?: boolean;
      price?: number;
      product_url?: string;
      confidence?: number;
      image_url?: string;
      description?: string;
    };
    if (!d?.found || !d.price || d.price <= 0) return null;
    return {
      product_title: item.product_title,
      vendor: item.vendor,
      recommended_rrp: Number(d.price),
      price_source: "website",
      confidence: d.confidence ?? 95,
      source_url: d.product_url,
      image_url: d.image_url,
      description: d.description,
    };
  } catch (e) {
    console.warn("[Phase3] website RRP lookup failed:", e);
    return null;
  }
}

// ── Per-brand markup lookup from supplier_intelligence ──
// Falls back to the static type table if the brand isn't learned yet.
const _brandMarkupCache = new Map<string, number | null>();
async function getBrandMarkup(vendor?: string): Promise<number | null> {
  if (!vendor) return null;
  const key = vendor.toLowerCase().trim();
  if (_brandMarkupCache.has(key)) return _brandMarkupCache.get(key) ?? null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("supplier_intelligence")
      .select("markup_multiplier")
      .eq("user_id", user.id)
      .ilike("supplier_name", vendor)
      .maybeSingle();
    const mult = data?.markup_multiplier ? Number(data.markup_multiplier) : null;
    _brandMarkupCache.set(key, mult);
    return mult;
  } catch {
    return null;
  }
}

async function searchOnce(
  item: Phase3Item,
  mode: "primary" | "sku",
): Promise<Phase3ProductResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke("price-lookup-search", {
      body: {
        product_name: item.product_title,
        supplier: item.vendor || "",
        style_number: item.sku || "",
        colour: undefined,
        mode,
      },
    });
    if (error || !data?.results?.length) return null;
    const top = data.results[0];
    if (!top?.price || top.price <= 0) return null;
    return {
      product_title: item.product_title,
      vendor: item.vendor,
      recommended_rrp: Number(top.price),
      price_source: "supplier_scrape",
      confidence: top.confidence ?? (mode === "sku" ? 75 : 80),
      source_url: top.url,
      description: top.description,
      image_url: top.imageUrl || top.image_url,
    };
  } catch (e) {
    console.warn(`[Phase3] supplier scrape (${mode}) failed:`, e);
    return null;
  }
}

async function callSupplierScrape(item: Phase3Item): Promise<Phase3ProductResult | null> {
  // Primary: brand-anchored product-name search with AU bias.
  const primary = await searchOnce(item, "primary");
  if (primary) return primary;
  // Fallback: SKU/style-code search (e.g. "Jantzen JA84105BK site:jantzen.com.au")
  // Critical for non-Shopify brands where the product page is only findable
  // by its product code embedded in the URL slug.
  if (item.sku && item.sku.length >= 4) {
    const sku = await searchOnce(item, "sku");
    if (sku) return sku;
  }
  return null;
}

// ── Tier 1.5: AI WebSearch (enrich-via-websearch) ─────────────
// Wraps the call in a 30-second timeout and retries up to 3× on 503 cold-starts.
// Always returns null on failure so the cascade continues without blocking the Review screen.
async function callWebsearchTier(item: Phase3Item): Promise<Phase3ProductResult | null> {
  if (!item.product_title) return null;

  const invokeOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const result = await supabase.functions.invoke("enrich-via-websearch", {
        body: {
          brand_name: item.vendor || "",
          product_name: item.product_title,
          colour: (item as Phase3Item & { colour?: string }).colour || "",
          product_code: item.sku || "",
        },
      });
      return result;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let resp: Awaited<ReturnType<typeof invokeOnce>> | null = null;
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        resp = await invokeOnce();
        const status = (resp?.error as { status?: number } | null)?.status;
        if (status !== 503) break;
      } catch (e) {
        if (attempt === 0) throw e;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!resp || resp.error) return null;
    const d = resp.data as {
      found?: boolean; price?: number | null; matched_url?: string | null;
      image_url?: string | null; description?: string | null;
      source?: string; query_used?: string; cache_hit?: boolean; cost_aud?: number;
    };
    if (!d?.found || !d.price || d.price <= 0) return null;
    return {
      product_title: item.product_title,
      vendor: item.vendor,
      recommended_rrp: Number(d.price),
      price_source: "ai_search",
      confidence: d.cache_hit ? 75 : 70,
      source_url: d.matched_url || undefined,
      image_url: d.image_url || undefined,
      description: d.description || undefined,
      source_meta: {
        provider: d.source as "anthropic-websearch" | "brave-search",
        query: d.query_used,
        cacheHit: d.cache_hit,
        costAud: d.cost_aud,
      },
    };
  } catch (e) {
    console.warn("[Phase3] websearch tier failed:", e);
    return null;
  }
}

async function callMarketWaterfall(item: Phase3Item): Promise<Phase3ProductResult | null> {
  try {
    const product: PriceProduct = {
      name: item.product_title,
      brand: item.vendor || "",
      barcode: item.barcode,
      type: item.product_type,
      currentPrice: item.rrp,
      costPrice: item.unit_cost,
    };
    const r = await matchPrice(product, "AUD");
    if (!r.price || r.price <= 0) return null;
    return {
      product_title: item.product_title,
      vendor: item.vendor,
      recommended_rrp: r.price,
      price_source: "market_waterfall",
      confidence: r.confidence,
      source_url: r.allPrices?.[0]?.store,
      description: r.description,
      image_url: r.imageUrl,
    };
  } catch (e) {
    console.warn("[Phase3] market waterfall failed:", e);
    return null;
  }
}

async function applyMarkupFallback(item: Phase3Item): Promise<Phase3ProductResult> {
  const cost = Number(item.unit_cost) || 0;
  // Per-brand multiplier from supplier_intelligence (learned over time);
  // fall back to type-based default (2.4 swimwear, 2.5 apparel, …).
  const brandMult = await getBrandMarkup(item.vendor);
  const mult = brandMult ?? pickMarkup(item.product_type);
  const rrp = cost > 0 ? Math.round(cost * mult * 100) / 100 : null;
  return {
    product_title: item.product_title,
    vendor: item.vendor,
    recommended_rrp: rrp,
    price_source: rrp ? "markup_fallback" : "none",
    confidence: rrp ? (brandMult ? 55 : 40) : 0,
  };
}

async function persistPriceLookup(userId: string, item: Phase3Item, r: Phase3ProductResult): Promise<void> {
  if (!r.recommended_rrp) return;
  try {
    await supabase.from("price_lookups").insert({
      user_id: userId,
      supplier: item.vendor || "Unknown",
      product_name: item.product_title,
      style_number: item.sku || null,
      supplier_cost: Number(item.unit_cost) || null,
      retail_price_aud: r.recommended_rrp,
      price_confidence: r.confidence,
      source_url: r.source_url || null,
      description: r.description || null,
      image_urls: r.image_url ? [r.image_url] : [],
      notes: `Phase 3 auto · ${r.price_source}`,
    });
  } catch (e) {
    console.warn("[Phase3] persist failed:", e);
  }
}

export interface Phase3Options {
  onProgress?: (done: number, total: number, current: Phase3ProductResult) => void;
  /** If true, only fall back to markup; skip web calls. Useful when no API keys configured. */
  markupOnly?: boolean;
  /** Concurrency limit — keep low to respect Firecrawl rate limits. */
  concurrency?: number;
}

export async function runPhase3PriceResearch(
  items: Phase3Item[],
  opts: Phase3Options = {},
): Promise<Phase3Summary> {
  const summary: Phase3Summary = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    bySource: {},
    results: [],
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[Phase3] not authenticated; skipping persistence");
  }

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 5));
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      let result: Phase3ProductResult | null = null;

      if (!opts.markupOnly) {
        // 1. Supplier's own website (cached) — highest authority for RRP
        result = await callWebsiteRRP(item);
        // 1.5 NEW — AI WebSearch (Anthropic web_search / Brave). Fills the
        // gap for non-Shopify brands and ambiguous product names.
        if (!result) result = await callWebsearchTier(item);
        // 2. Supplier/retailer scrape via Firecrawl
        if (!result) result = await callSupplierScrape(item);
        // 3. Market waterfall (Google Shopping / barcode)
        if (!result) result = await callMarketWaterfall(item);
      }
      // 4. Markup fallback (always available if cost present)
      if (!result) result = await applyMarkupFallback(item);

      if (result.recommended_rrp && result.recommended_rrp > 0) {
        summary.succeeded++;
        if (user) await persistPriceLookup(user.id, item, result);
      } else {
        summary.failed++;
      }
      summary.bySource[result.price_source] = (summary.bySource[result.price_source] || 0) + 1;
      summary.results.push(result);

      done++;
      opts.onProgress?.(done, items.length, result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summary;
}
