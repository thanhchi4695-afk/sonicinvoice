/**
 * Refill Price Restore
 * ====================
 * When an Exact Refill (or New Variant on an existing product) is processed,
 * automatically restore the parent variant(s) to full RRP if the product is
 * currently on sale, then log every change to `price_changes`.
 *
 * Rules (see /docs prompt):
 *   - "On sale" = compare_at_price > 0 OR price < invoice rrp_incl_gst
 *   - Restore: price := invoice RRP, compare_at_price := null
 *   - Never reduce a non-sale price
 *   - Never set compare_at lower than price
 *   - For new_variant lines: restore on ALL variants of the parent product
 *   - For new product lines: skip
 *   - If invoice RRP is missing or LOWER than current price → skip & warn
 *   - compare_at == price (Shopify quirk) → treat as not on sale
 */

import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationLine } from "./stock-matcher";

export type PriceState =
  | "restored"        // on sale → restore to full RRP
  | "no_change"       // not on sale
  | "calculated"      // RRP not on invoice, used markup
  | "skipped_lower"   // invoice RRP lower than current price → warn
  | "skipped_no_match"// no matched variant
  | "skipped_no_rrp"; // no RRP and no fallback

export interface PricePlanEntry {
  invoice_sku: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  current_price: number | null;
  current_compare_at: number | null;
  invoice_rrp: number | null;
  new_price: number | null;
  new_compare_at: number | null;
  state: PriceState;
  warning?: string;
  /** Sibling variants on the same product also being restored. */
  sibling_variants?: Array<{
    variant_id: string;
    current_price: number;
    current_compare_at: number | null;
    new_price: number;
    new_compare_at: number | null;
  }>;
}

export interface PricePlan {
  /** Keyed by `invoice_sku || invoice_product_name` for UI lookup. */
  byKey: Record<string, PricePlanEntry>;
  summary: {
    restored: number;
    no_change: number;
    calculated: number;
    skipped_lower: number;
    skipped_no_match: number;
    skipped_no_rrp: number;
  };
}

interface ShopifyVariantSnapshot {
  variantId: string;
  productId: string;
  price: number;
  compareAt: number | null;
}

const VARIANT_QUERY = /* GraphQL */ `
  query VariantBatch($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
        compareAtPrice
        sku
        product {
          id
          title
          variants(first: 100) {
            edges {
              node { id price compareAtPrice }
            }
          }
        }
      }
    }
  }
`;

function asGid(prefix: string, id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/${prefix}/${id}`;
}

async function fetchVariantSnapshots(
  variantIds: string[],
): Promise<{ byVariantId: Record<string, ShopifyVariantSnapshot>; productSiblings: Record<string, ShopifyVariantSnapshot[]> }> {
  const byVariantId: Record<string, ShopifyVariantSnapshot> = {};
  const productSiblings: Record<string, ShopifyVariantSnapshot[]> = {};
  if (variantIds.length === 0) return { byVariantId, productSiblings };

  const ids = variantIds.map((v) => asGid("ProductVariant", v));
  // Chunk to stay under cost limits — 25 nodes per request.
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const { data, error } = await supabase.functions.invoke("shopify-proxy", {
      body: { action: "graphql", query: VARIANT_QUERY, variables: { ids: chunk } },
    });
    if (error) {
      console.warn("[refill-price-restore] variant fetch failed", error.message);
      continue;
    }
    const nodes: any[] = data?.nodes ?? data?.data?.nodes ?? [];
    for (const n of nodes) {
      if (!n?.id) continue;
      const snap: ShopifyVariantSnapshot = {
        variantId: n.id,
        productId: n.product?.id ?? "",
        price: parseFloat(n.price ?? "0"),
        compareAt: n.compareAtPrice != null ? parseFloat(n.compareAtPrice) : null,
      };
      byVariantId[n.id] = snap;
      const pid = n.product?.id;
      if (pid && !productSiblings[pid]) {
        productSiblings[pid] = (n.product.variants?.edges ?? []).map((e: any) => ({
          variantId: e.node.id,
          productId: pid,
          price: parseFloat(e.node.price ?? "0"),
          compareAt: e.node.compareAtPrice != null ? parseFloat(e.node.compareAtPrice) : null,
        }));
      }
    }
    await new Promise((r) => setTimeout(r, 500)); // rate-limit per project memory
  }
  return { byVariantId, productSiblings };
}

function isOnSale(snap: ShopifyVariantSnapshot, invoiceRrp: number | null): boolean {
  // compare_at quirk: equal to price → not on sale
  if (snap.compareAt != null && snap.compareAt > 0 && snap.compareAt > snap.price + 0.001) {
    return true;
  }
  if (invoiceRrp != null && invoiceRrp > 0 && snap.price < invoiceRrp - 0.001) {
    return true;
  }
  return false;
}

function lineKey(line: ReconciliationLine): string {
  return (line.invoice_sku || line.invoice_product_name || "").trim();
}

/**
 * Build a price-restore plan for the supplied refill / new_variant lines.
 * Does NOT write to Shopify. Caller decides when to push.
 */
export async function planRefillPriceRestore(
  lines: ReconciliationLine[],
): Promise<PricePlan> {
  const eligible = lines.filter(
    (l) =>
      l.match_type === "exact_refill" ||
      l.match_type === "exact_refill_conflict" ||
      l.match_type === "new_variant" ||
      l.match_type === "new_variant_conflict",
  );

  const variantIds = eligible
    .map((l) => l.matched_variant_id)
    .filter((id): id is string => !!id);

  const { byVariantId, productSiblings } = await fetchVariantSnapshots(variantIds);

  const plan: PricePlan = {
    byKey: {},
    summary: {
      restored: 0,
      no_change: 0,
      calculated: 0,
      skipped_lower: 0,
      skipped_no_match: 0,
      skipped_no_rrp: 0,
    },
  };

  for (const line of eligible) {
    const key = lineKey(line);
    if (!key) continue;

    const variantGid = line.matched_variant_id ? asGid("ProductVariant", line.matched_variant_id) : null;
    const productGid = line.matched_product_id ? asGid("Product", line.matched_product_id) : null;
    const snap = variantGid ? byVariantId[variantGid] : undefined;

    const entry: PricePlanEntry = {
      invoice_sku: line.invoice_sku,
      shopify_product_id: productGid,
      shopify_variant_id: variantGid,
      current_price: snap?.price ?? null,
      current_compare_at: snap?.compareAt ?? null,
      invoice_rrp: line.invoice_rrp,
      new_price: null,
      new_compare_at: null,
      state: "no_change",
    };

    if (!snap) {
      entry.state = "skipped_no_match";
      plan.summary.skipped_no_match++;
      plan.byKey[key] = entry;
      continue;
    }

    if (line.invoice_rrp == null || line.invoice_rrp <= 0) {
      entry.state = "skipped_no_rrp";
      entry.warning = "RRP not on invoice — apply pricing rules separately";
      plan.summary.skipped_no_rrp++;
      plan.byKey[key] = entry;
      continue;
    }

    const onSale = isOnSale(snap, line.invoice_rrp);

    if (!onSale) {
      // Not on sale — never reduce
      if (line.invoice_rrp < snap.price - 0.001) {
        entry.state = "skipped_lower";
        entry.warning = `Invoice RRP $${line.invoice_rrp.toFixed(2)} lower than current $${snap.price.toFixed(2)} — skipped`;
        plan.summary.skipped_lower++;
      } else {
        entry.state = "no_change";
        plan.summary.no_change++;
      }
      plan.byKey[key] = entry;
      continue;
    }

    // Restore — price := invoice RRP, compare_at := null
    entry.new_price = line.invoice_rrp;
    entry.new_compare_at = null;
    entry.state = "restored";
    plan.summary.restored++;

    // Restore on ALL siblings of the parent product (rule: only-some-on-sale case)
    const siblings = snap.productId ? productSiblings[snap.productId] ?? [] : [];
    entry.sibling_variants = siblings
      .filter((sib) => sib.variantId !== snap.variantId)
      .filter((sib) => isOnSale(sib, line.invoice_rrp))
      .map((sib) => ({
        variant_id: sib.variantId,
        current_price: sib.price,
        current_compare_at: sib.compareAt,
        new_price: line.invoice_rrp!,
        new_compare_at: null,
      }));

    plan.byKey[key] = entry;
  }

  return plan;
}

/**
 * Persist the plan to the `price_changes` table. Call this BEFORE pushing
 * to Shopify so we always have a record even on API failure.
 */
export async function logPricePlan(
  plan: PricePlan,
  context: { invoice_number?: string | null; vendor?: string | null; triggered_by?: string },
): Promise<{ inserted: number; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { inserted: 0, error: "Not authenticated" };

  const rows: any[] = [];
  for (const [key, entry] of Object.entries(plan.byKey)) {
    if (entry.state !== "restored" || !entry.shopify_product_id || !entry.shopify_variant_id) continue;
    rows.push({
      user_id: userId,
      shopify_product_id: entry.shopify_product_id,
      shopify_variant_id: entry.shopify_variant_id,
      style_name: key,
      sku: entry.invoice_sku,
      vendor: context.vendor ?? null,
      price_before: entry.current_price,
      compare_at_before: entry.current_compare_at,
      price_after: entry.new_price,
      compare_at_after: entry.new_compare_at,
      reason: "refill_price_restore",
      invoice_number: context.invoice_number ?? null,
      triggered_by: context.triggered_by ?? "refill",
    });
    for (const sib of entry.sibling_variants ?? []) {
      rows.push({
        user_id: userId,
        shopify_product_id: entry.shopify_product_id,
        shopify_variant_id: sib.variant_id,
        style_name: key,
        sku: entry.invoice_sku,
        vendor: context.vendor ?? null,
        price_before: sib.current_price,
        compare_at_before: sib.current_compare_at,
        price_after: sib.new_price,
        compare_at_after: sib.new_compare_at,
        reason: "refill_price_restore_sibling",
        invoice_number: context.invoice_number ?? null,
        triggered_by: context.triggered_by ?? "refill",
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, error: null };

  const { error } = await supabase.from("price_changes").insert(rows);
  if (error) {
    console.error("[refill-price-restore] log insert failed", error);
    return { inserted: 0, error: error.message };
  }
  return { inserted: rows.length, error: null };
}
