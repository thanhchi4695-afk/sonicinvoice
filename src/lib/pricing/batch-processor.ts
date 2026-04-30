/**
 * Batch Pricing Processor
 *
 * Pulls all of the merchant's products + their primary variant (price + cost),
 * runs the AI Pricing Orchestrator on each, and aggregates results into a
 * single report the dashboard renders.
 *
 * Triggered manually from the "Refresh Report" button in PricingIntelligence —
 * NOT a cron. The merchant controls when analysis runs.
 *
 * To stay polite to the AI gateway:
 *   - 250ms delay between products by default
 *   - `skipAi` mode available for very large catalogs (uses templated reasons)
 */

import { supabase } from "@/integrations/supabase/client";
import {
  analyzeProduct,
  type PricingRecommendation,
} from "@/lib/ai-pricing-orchestrator";

export interface PricingReportSummary {
  totalProducts: number;
  healthyCount: number;
  atRiskCount: number;
  breachedCount: number;
  /** Sum of (currentPrice - suggestedNewPrice) * 1 unit across all DISCOUNT/DEEP_DISCOUNT recs. Negative = revenue at risk if applied. */
  estimatedRevenueImpact: number;
  /** Count of HOLD vs DISCOUNT vs DEEP_DISCOUNT recs. */
  actionCounts: { HOLD: number; DISCOUNT: number; DEEP_DISCOUNT: number };
  generatedAt: string;
}

export interface PricingReport {
  summary: PricingReportSummary;
  recommendations: (PricingRecommendation & {
    title: string;
    vendor: string | null;
    image_url: string | null;
  })[];
}

export interface BatchProgress {
  processed: number;
  total: number;
  currentTitle: string | null;
}

export interface BatchOptions {
  /** Cap how many products to process (null = all). Useful for big catalogs. */
  limit?: number | null;
  /** Skip the AI reason call and use templates instead (much faster). */
  skipAi?: boolean;
  /** Delay between products in ms (default 250). */
  delayMs?: number;
  /** Progress callback for the UI. */
  onProgress?: (p: BatchProgress) => void;
}

interface RawProductRow {
  id: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  image_url: string | null;
  shopify_product_id: string | null;
  created_at: string;
}

interface RawVariantRow {
  product_id: string;
  sku: string | null;
  cost: number | null;
  retail_price: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

/** Pick the variant with usable price/cost data; fall back to first variant. */
function pickPrimaryVariant(variants: RawVariantRow[]): RawVariantRow | null {
  if (!variants.length) return null;
  const withBoth = variants.find(
    (v) => (v.retail_price ?? 0) > 0 && (v.cost ?? 0) > 0,
  );
  if (withBoth) return withBoth;
  const withPrice = variants.find((v) => (v.retail_price ?? 0) > 0);
  if (withPrice) return withPrice;
  return variants[0];
}

export async function processAllProductsAndGenerateReport(
  opts: BatchOptions = {},
): Promise<PricingReport> {
  const limit = opts.limit ?? null;
  const skipAi = opts.skipAi ?? false;
  const delayMs = opts.delayMs ?? 250;
  const onProgress = opts.onProgress;

  // 1. Load products
  let productQuery = supabase
    .from("products")
    .select(
      "id, title, vendor, product_type, image_url, shopify_product_id, created_at",
    )
    .order("created_at", { ascending: false });
  if (limit) productQuery = productQuery.limit(limit);

  const { data: products, error: prodErr } = await productQuery;
  if (prodErr) throw prodErr;
  const rows = (products ?? []) as RawProductRow[];

  if (rows.length === 0) {
    return {
      summary: {
        totalProducts: 0,
        healthyCount: 0,
        atRiskCount: 0,
        breachedCount: 0,
        estimatedRevenueImpact: 0,
        actionCounts: { HOLD: 0, DISCOUNT: 0, DEEP_DISCOUNT: 0 },
        generatedAt: new Date().toISOString(),
      },
      recommendations: [],
    };
  }

  // 2. Load variants in one shot
  const productIds = rows.map((r) => r.id);
  const { data: variantRows } = await supabase
    .from("variants")
    .select("product_id, sku, cost, retail_price")
    .in("product_id", productIds);

  const variantsByProduct = new Map<string, RawVariantRow[]>();
  for (const v of (variantRows ?? []) as RawVariantRow[]) {
    if (!v.product_id) continue;
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  // 3. Iterate
  const recommendations: PricingReport["recommendations"] = [];
  let i = 0;
  for (const p of rows) {
    i++;
    onProgress?.({ processed: i - 1, total: rows.length, currentTitle: p.title });

    const variants = variantsByProduct.get(p.id) ?? [];
    const primary = pickPrimaryVariant(variants);
    const currentPrice = Number(primary?.retail_price ?? 0);
    const costPrice = primary?.cost != null ? Number(primary.cost) : null;

    // Skip products with no usable price.
    if (!currentPrice || currentPrice <= 0) {
      continue;
    }

    try {
      const rec = await analyzeProduct({
        productId: p.id,
        title: p.title,
        currentPrice,
        costPrice,
        daysInInventory: daysSince(p.created_at),
        shopifyProductId: p.shopify_product_id,
        sku: primary?.sku ?? null,
        vendor: p.vendor,
        collection: p.product_type,
        skipAi,
      });

      recommendations.push({
        ...rec,
        title: p.title,
        vendor: p.vendor,
        image_url: p.image_url,
      });
    } catch (err) {
      console.warn("[batch-processor] analyzeProduct failed", p.id, err);
    }

    if (delayMs > 0 && i < rows.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  onProgress?.({ processed: rows.length, total: rows.length, currentTitle: null });

  // 4. Aggregate
  let healthy = 0;
  let atRisk = 0;
  let breached = 0;
  let revenueImpact = 0;
  const actionCounts = { HOLD: 0, DISCOUNT: 0, DEEP_DISCOUNT: 0 };

  for (const r of recommendations) {
    if (r.analysis.marginStatus === "safe") healthy++;
    else if (r.analysis.marginStatus === "at_risk") atRisk++;
    else if (r.analysis.marginStatus === "breached") breached++;

    actionCounts[r.action]++;

    if (r.suggestedNewPrice != null) {
      revenueImpact += r.suggestedNewPrice - r.analysis.currentPrice;
    }
  }

  return {
    summary: {
      totalProducts: recommendations.length,
      healthyCount: healthy,
      atRiskCount: atRisk,
      breachedCount: breached,
      estimatedRevenueImpact: +revenueImpact.toFixed(2),
      actionCounts,
      generatedAt: new Date().toISOString(),
    },
    recommendations,
  };
}
