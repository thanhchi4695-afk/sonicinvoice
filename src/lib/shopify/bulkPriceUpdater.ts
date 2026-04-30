/**
 * Bulk Price Updater
 *
 * Wraps Shopify `productVariantsBulkUpdate` to apply new prices in
 * chunked, rate-limited calls. Each Shopify product can have many
 * variants but `productVariantsBulkUpdate` requires ONE productId per
 * call, so we group variants by product and chunk variants within each
 * product (≤ 100 per call, well under Shopify's hard limit).
 *
 * Rate limiting: 500 ms between GraphQL calls per project memory.
 * Audit: every successful or failed batch is logged via `addAuditEntry`.
 */

import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

export interface VariantPriceUpdate {
  productId: string;       // gid://shopify/Product/...
  variantId: string;       // gid://shopify/ProductVariant/...
  newPrice: number;
  originalPrice: number;
  sku?: string | null;
  title?: string | null;
  /** Google's auto-pricing minimum (sent as variant metafield). */
  autoPricingMinPrice?: number | null;
}

export interface BulkUpdateResult {
  ok: number;
  failed: number;
  errors: Array<{ variantId: string; message: string }>;
}

const MAX_VARIANTS_PER_CALL = 100;
const REQUEST_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bulkUpdateOneProduct(
  productId: string,
  variants: VariantPriceUpdate[],
): Promise<BulkUpdateResult> {
  const result: BulkUpdateResult = { ok: 0, failed: 0, errors: [] };

  for (let i = 0; i < variants.length; i += MAX_VARIANTS_PER_CALL) {
    const chunk = variants.slice(i, i + MAX_VARIANTS_PER_CALL);
    const variantsInput = chunk.map((v) => ({
      id: v.variantId,
      price: v.newPrice.toFixed(2),
    }));

    const mutation = /* GraphQL */ `
      mutation BulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }
    `;

    try {
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: {
          action: "graphql",
          query: mutation,
          variables: { productId, variants: variantsInput },
        },
      });
      if (error) throw new Error(error.message);
      const errs = data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (errs.length > 0) {
        const msg = errs.map((e: { message: string }) => e.message).join("; ");
        chunk.forEach((v) => {
          result.failed += 1;
          result.errors.push({ variantId: v.variantId, message: msg });
        });
      } else {
        result.ok += chunk.length;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      chunk.forEach((v) => {
        result.failed += 1;
        result.errors.push({ variantId: v.variantId, message });
      });
    }

    await sleep(REQUEST_DELAY_MS);

    // Optional: also push auto_pricing_min_price as a Google metafield per variant.
    const withAutoMin = chunk.filter(
      (v) => v.autoPricingMinPrice != null && v.autoPricingMinPrice > 0,
    );
    if (withAutoMin.length > 0) {
      const metafields = withAutoMin.map((v) => ({
        ownerId: v.variantId,
        namespace: "google",
        key: "auto_pricing_min_price",
        type: "number_decimal",
        value: v.autoPricingMinPrice!.toFixed(2),
      }));
      try {
        await supabase.functions.invoke("shopify-proxy", {
          body: {
            action: "graphql",
            query: `mutation($metafields:[MetafieldsSetInput!]!){
              metafieldsSet(metafields:$metafields){ userErrors{ message } }
            }`,
            variables: { metafields },
          },
        });
      } catch (e) {
        console.warn("[bulkUpdater] auto_pricing_min_price set failed", e);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return result;
}

/**
 * Apply a flat list of variant price updates, grouped by product.
 * Logs an audit entry for every product processed.
 */
export async function applyBulkPriceUpdates(
  updates: VariantPriceUpdate[],
  context: { scheduleName: string; scheduleId?: string; reason: string },
): Promise<BulkUpdateResult> {
  const grouped = new Map<string, VariantPriceUpdate[]>();
  for (const u of updates) {
    const arr = grouped.get(u.productId) ?? [];
    arr.push(u);
    grouped.set(u.productId, arr);
  }

  const total: BulkUpdateResult = { ok: 0, failed: 0, errors: [] };
  let productIndex = 0;
  for (const [productId, variants] of grouped) {
    productIndex += 1;
    const r = await bulkUpdateOneProduct(productId, variants);
    total.ok += r.ok;
    total.failed += r.failed;
    total.errors.push(...r.errors);

    addAuditEntry(
      "bulk_price_update",
      JSON.stringify({
        scheduleId: context.scheduleId ?? null,
        scheduleName: context.scheduleName,
        reason: context.reason,
        productId,
        variantCount: variants.length,
        ok: r.ok,
        failed: r.failed,
        priceRange: {
          min: Math.min(...variants.map((v) => v.newPrice)),
          max: Math.max(...variants.map((v) => v.newPrice)),
        },
      }),
    );

    if (productIndex < grouped.size) await sleep(REQUEST_DELAY_MS);
  }

  return total;
}

/**
 * Revert variants back to their original prices stored in the
 * schedule's `variants_snapshot`.
 */
export async function revertBulkPriceUpdates(
  snapshot: VariantPriceUpdate[],
  context: { scheduleName: string; scheduleId?: string },
): Promise<BulkUpdateResult> {
  const reverts = snapshot.map((s) => ({
    ...s,
    newPrice: s.originalPrice,
    originalPrice: s.newPrice,
  }));
  return applyBulkPriceUpdates(reverts, {
    scheduleName: context.scheduleName,
    scheduleId: context.scheduleId,
    reason: "Auto-revert at end of sale",
  });
}
