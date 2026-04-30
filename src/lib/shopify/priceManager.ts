/**
 * Price Manager
 *
 * Applies AI-recommended price changes to Shopify via the
 * `productVariantsBulkUpdate` GraphQL mutation, one product at a time,
 * with the project-wide 500ms inter-call delay.
 *
 * Every successful or failed update is recorded in the local Audit Log
 * with the AI's `reason` so merchants can trace why a price moved.
 */

import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

export interface RecommendedPriceChange {
  /** Internal product UUID (matches `products.id`). */
  productId: string;
  title: string;
  /** AI-suggested new retail price (already floor-enforced). */
  newPrice: number;
  /** Existing retail price, used as the new compareAtPrice for "on-sale" badges. */
  originalPrice: number;
  /** Natural-language explanation from the AI orchestrator. */
  reason: string;
  /** Optional discount % for the audit message. */
  discountPercentage?: number | null;
}

export interface ApplyResult {
  productId: string;
  title: string;
  ok: boolean;
  variantsUpdated: number;
  error?: string;
}

export interface ApplyProgress {
  index: number;
  total: number;
  currentTitle: string;
}

const REQUEST_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MUTATION = /* GraphQL */ `
  mutation BulkPriceUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface VariantRow {
  id: string;
  shopify_variant_id: string | null;
}

interface ProductRow {
  id: string;
  shopify_product_id: string | null;
}

/**
 * Apply recommended price changes to Shopify, one product at a time.
 *
 * @param changes  list of products + new prices to push
 * @param onProgress  optional UI progress callback
 */
export async function applyRecommendedPriceChanges(
  changes: RecommendedPriceChange[],
  onProgress?: (p: ApplyProgress) => void,
): Promise<ApplyResult[]> {
  if (changes.length === 0) return [];

  const productIds = changes.map((c) => c.productId);

  // Fetch shopify_product_id for the selected products
  const { data: productRows, error: prodErr } = await supabase
    .from("products")
    .select("id, shopify_product_id")
    .in("id", productIds);
  if (prodErr) throw prodErr;
  const productById = new Map<string, ProductRow>(
    (productRows ?? []).map((p) => [p.id, p as ProductRow]),
  );

  // Fetch all variants for those products
  const { data: variantRows, error: varErr } = await supabase
    .from("variants")
    .select("id, product_id, shopify_variant_id")
    .in("product_id", productIds);
  if (varErr) throw varErr;
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variantRows ?? []) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push({ id: v.id, shopify_variant_id: v.shopify_variant_id });
    variantsByProduct.set(v.product_id, arr);
  }

  const results: ApplyResult[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    onProgress?.({ index: i, total: changes.length, currentTitle: change.title });

    const product = productById.get(change.productId);
    const variants = (variantsByProduct.get(change.productId) ?? []).filter(
      (v) => v.shopify_variant_id,
    );

    if (!product?.shopify_product_id || variants.length === 0) {
      const msg = !product?.shopify_product_id
        ? "Product not synced to Shopify"
        : "No Shopify variants found";
      results.push({
        productId: change.productId,
        title: change.title,
        ok: false,
        variantsUpdated: 0,
        error: msg,
      });
      addAuditEntry(
        "pricing.apply.skipped",
        `${change.title}: ${msg}`,
      );
      continue;
    }

    const variantsInput = variants.map((v) => ({
      id: v.shopify_variant_id,
      price: change.newPrice.toFixed(2),
      compareAtPrice: change.originalPrice.toFixed(2),
    }));

    try {
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: {
          action: "graphql",
          query: MUTATION,
          variables: {
            productId: product.shopify_product_id,
            variants: variantsInput,
          },
        },
      });
      if (error) throw new Error(error.message);

      const userErrors =
        data?.productVariantsBulkUpdate?.userErrors ??
        data?.data?.productVariantsBulkUpdate?.userErrors ??
        [];

      if (userErrors.length > 0) {
        const msg = userErrors
          .map((e: { message: string }) => e.message)
          .join("; ");
        results.push({
          productId: change.productId,
          title: change.title,
          ok: false,
          variantsUpdated: 0,
          error: msg,
        });
        addAuditEntry(
          "pricing.apply.failed",
          `${change.title}: ${msg}`,
        );
      } else {
        // Mirror the new price back to our DB so the dashboard reflects reality
        await supabase
          .from("variants")
          .update({ retail_price: change.newPrice })
          .in(
            "id",
            variants.map((v) => v.id),
          );

        results.push({
          productId: change.productId,
          title: change.title,
          ok: true,
          variantsUpdated: variants.length,
        });

        const pctText =
          change.discountPercentage != null
            ? ` (${change.discountPercentage.toFixed(1)}% off)`
            : "";
        addAuditEntry(
          "pricing.apply.success",
          `${change.title}: $${change.originalPrice.toFixed(2)} → $${change.newPrice.toFixed(2)}${pctText}. Reason: ${change.reason}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        productId: change.productId,
        title: change.title,
        ok: false,
        variantsUpdated: 0,
        error: msg,
      });
      addAuditEntry(
        "pricing.apply.failed",
        `${change.title}: ${msg}`,
      );
    }

    if (i < changes.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  onProgress?.({
    index: changes.length,
    total: changes.length,
    currentTitle: "",
  });

  return results;
}
