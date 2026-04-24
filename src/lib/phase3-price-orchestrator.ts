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
  price_source: "website" | "supplier_scrape" | "market_waterfall" | "markup_fallback" | "none";
  confidence: number;
  source_url?: string;
  description?: string;
  image_url?: string;
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
        },
      },
    );
    if (error) return null;
    const d = data as { found?: boolean; price?: number; product_url?: string; confidence?: number };
    if (!d?.found || !d.price || d.price <= 0) return null;
    return {
      product_title: item.product_title,
      vendor: item.vendor,
      recommended_rrp: Number(d.price),
      price_source: "website",
      confidence: d.confidence ?? 95,
      source_url: d.product_url,
    };
  } catch (e) {
    console.warn("[Phase3] website RRP lookup failed:", e);
    return null;
  }
}

async function callSupplierScrape(item: Phase3Item): Promise<Phase3ProductResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke("price-lookup-search", {
      body: {
        product_name: item.product_title,
        supplier: item.vendor || "",
        style_number: item.sku || "",
        colour: undefined,
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
      confidence: top.confidence ?? 80,
      source_url: top.url,
      description: top.description,
      image_url: top.imageUrl || top.image_url,
    };
  } catch (e) {
    console.warn("[Phase3] supplier scrape failed:", e);
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

function applyMarkupFallback(item: Phase3Item): Phase3ProductResult {
  const cost = Number(item.unit_cost) || 0;
  const mult = pickMarkup(item.product_type);
  const rrp = cost > 0 ? Math.round(cost * mult * 100) / 100 : null;
  return {
    product_title: item.product_title,
    vendor: item.vendor,
    recommended_rrp: rrp,
    price_source: rrp ? "markup_fallback" : "none",
    confidence: rrp ? 40 : 0,
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
        // 2. Supplier/retailer scrape via Firecrawl
        if (!result) result = await callSupplierScrape(item);
        // 3. Market waterfall (Google Shopping / barcode)
        if (!result) result = await callMarketWaterfall(item);
      }
      // 4. Markup fallback (always available if cost present)
      if (!result) result = applyMarkupFallback(item);

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
