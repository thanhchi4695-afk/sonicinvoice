/**
 * Competitor price resolver for the pricing pipeline.
 *
 * Surfaces a single "best" competitor price for a given product so the
 * pricing engine (`priceRecommendation.calculateSaleRecommendation`) can
 * incorporate it as `competitorPrice`.
 *
 * Resolution order:
 *   1. Cached scrape in `competitor_prices` (from the monitoring agent),
 *      keyed by Shopify product id (preferred) or SKU.
 *   2. Live scrape via `fetchCompetitorPrice` if the caller passes a URL.
 *   3. null — caller decides how to degrade (priceRecommendation tolerates
 *      a missing competitor price and just lowers confidence to "medium").
 *
 * Always picks the LOWEST confident price across active competitors so we
 * benchmark against the most aggressive market price.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  fetchCompetitorPrice,
  type CompetitorPriceResult,
} from "./competitorScraper";

export interface ResolveCompetitorOptions {
  /** Shopify product id (numeric or GID) — used to look up cached prices. */
  shopifyProductId?: string | null;
  /** SKU fallback for cache lookup. */
  sku?: string | null;
  /** Optional competitor URL to scrape live if no cache hit. */
  competitorUrl?: string | null;
  /** Ignore cache rows older than this many hours (default 48). */
  maxAgeHours?: number;
  /** Minimum confidence_score on the cached row (0–100, default 50). */
  minConfidence?: number;
}

export interface ResolvedCompetitorPrice {
  price: number | null;
  source: "cache" | "scrape" | "none";
  competitorName?: string | null;
  matchedUrl?: string | null;
  matchedTitle?: string | null;
  confidence?: number | null;
  ageHours?: number | null;
  /** Raw scrape payload when source === 'scrape'. */
  scrape?: CompetitorPriceResult | null;
}

const numericId = (id: string) => {
  const idx = id.lastIndexOf("/");
  return idx >= 0 ? id.slice(idx + 1) : id;
};

/**
 * Returns the lowest fresh competitor price for a product, falling back
 * to a live scrape if a URL is supplied.
 */
export async function resolveCompetitorPrice(
  opts: ResolveCompetitorOptions,
): Promise<ResolvedCompetitorPrice> {
  const maxAgeHours = opts.maxAgeHours ?? 48;
  const minConfidence = opts.minConfidence ?? 50;

  // ── 1. Cache lookup ──
  if (opts.shopifyProductId || opts.sku) {
    try {
      // Find the merchant's monitored product row.
      let monitoredQuery = supabase
        .from("competitor_monitored_products")
        .select("id, product_sku, shopify_product_id")
        .limit(1);

      if (opts.shopifyProductId) {
        monitoredQuery = monitoredQuery.eq(
          "shopify_product_id",
          numericId(opts.shopifyProductId),
        );
      } else if (opts.sku) {
        monitoredQuery = monitoredQuery.eq("product_sku", opts.sku);
      }

      const { data: monitored } = await monitoredQuery.maybeSingle();

      if (monitored?.id) {
        const { data: prices } = await supabase
          .from("competitor_prices")
          .select(
            "competitor_price, confidence_score, last_checked, matched_title, matched_url, match_status, competitor_id",
          )
          .eq("monitored_product_id", monitored.id)
          .eq("match_status", "matched")
          .gte("confidence_score", minConfidence)
          .order("competitor_price", { ascending: true });

        const fresh =
          prices?.filter((p) => {
            if (!p.last_checked) return false;
            const ageMs = Date.now() - new Date(p.last_checked).getTime();
            return ageMs <= maxAgeHours * 3_600_000 && p.competitor_price != null;
          }) ?? [];

        if (fresh.length > 0) {
          // Lowest price wins — already sorted ascending.
          const best = fresh[0];
          let competitorName: string | null = null;
          if (best.competitor_id) {
            const { data: comp } = await supabase
              .from("competitors")
              .select("name")
              .eq("id", best.competitor_id)
              .maybeSingle();
            competitorName = comp?.name ?? null;
          }
          const ageHours = best.last_checked
            ? (Date.now() - new Date(best.last_checked).getTime()) / 3_600_000
            : null;

          return {
            price: Number(best.competitor_price),
            source: "cache",
            competitorName,
            matchedUrl: best.matched_url ?? null,
            matchedTitle: best.matched_title ?? null,
            confidence: best.confidence_score ?? null,
            ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
          };
        }
      }
    } catch (err) {
      console.warn("[resolveCompetitorPrice] cache lookup failed", err);
      // Fall through to scrape / none.
    }
  }

  // ── 2. Live scrape (only if a URL was passed) ──
  if (opts.competitorUrl && opts.competitorUrl.trim()) {
    try {
      const scrape = await fetchCompetitorPrice(opts.competitorUrl);
      if (scrape.ok && scrape.price && scrape.price > 0) {
        return {
          price: scrape.price,
          source: "scrape",
          matchedUrl: scrape.url,
          matchedTitle: scrape.title,
          scrape,
        };
      }
      return { price: null, source: "none", scrape };
    } catch (err) {
      console.warn("[resolveCompetitorPrice] live scrape failed", err);
    }
  }

  return { price: null, source: "none" };
}
