/**
 * Google Shopping Feed Enricher
 *
 * Read/write Google Shopping metafields (namespace: "google") on Shopify
 * products and variants via the Admin GraphQL API. Required apparel keys:
 *   product:  google.gender, google.age_group, google.color, google.category
 *             google.custom_label_0..4
 *   variant:  google.size
 *
 * All calls go through the existing authenticated `shopify-proxy` edge
 * function using a generic `graphql` passthrough action.
 */

import { supabase } from "@/integrations/supabase/client";

// ───────────────────────── Types ─────────────────────────

export interface VariantSize {
  variantId: string; // gid://shopify/ProductVariant/...
  size: string | null;
}

export interface GoogleFeedAttributes {
  productId: string; // gid://shopify/Product/...
  gender: string | null;
  ageGroup: string | null;
  color: string | null;
  googleProductCategory: string | null;
  customLabels: [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
  ];
  variants: VariantSize[];
}

export type AttentionReason =
  | "missing_gender"
  | "missing_age_group"
  | "missing_color"
  | "missing_size"
  | "image_too_small";

export interface AttentionFilter {
  productType?: "apparel" | "all";
  /** Hard cap on rows scanned. Shopify max is 250 per page. */
  limit?: number;
  /** Minimum image edge in px (Google Shopping minimum is 250). */
  minImageEdge?: number;
}

export interface ProductAttention {
  productId: string;
  title: string;
  productType: string | null;
  reasons: AttentionReason[];
  smallestImageEdge: number | null;
}

// ───────────────────── Internal helpers ─────────────────────

const GOOGLE_NS = "google";
const PRODUCT_KEYS = [
  "gender",
  "age_group",
  "color",
  "category",
  "custom_label_0",
  "custom_label_1",
  "custom_label_2",
  "custom_label_3",
  "custom_label_4",
] as const;

class FeedEnricherError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "FeedEnricherError";
  }
}

/**
 * Call the shopify-proxy GraphQL passthrough with a small retry budget for
 * transient 5xx / network errors. Throttle errors are already retried inside
 * the proxy, but we add one more layer here as a safety net.
 */
async function shopifyGraphQL<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  retries = 2,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase.functions.invoke("shopify-proxy", {
      body: { action: "graphql", query, variables },
    });
    if (!error && data && !data.error) return data as T;
    lastErr = error?.message || data?.error || "Unknown GraphQL failure";
    // Retry only on transient-looking errors
    const msg = String(lastErr).toLowerCase();
    const transient =
      msg.includes("throttle") ||
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504");
    if (!transient || attempt === retries) break;
    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
  }
  throw new FeedEnricherError("Shopify GraphQL request failed", lastErr);
}

function toGid(productId: string): string {
  return productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;
}

// ─────────────────────── 1. Read attributes ───────────────────────

export async function getProductFeedAttributes(
  productId: string,
): Promise<GoogleFeedAttributes> {
  const id = toGid(productId);
  const query = /* GraphQL */ `
    query ProductFeedAttrs($id: ID!) {
      product(id: $id) {
        id
        metafields(namespace: "${GOOGLE_NS}", first: 20) {
          edges { node { key value } }
        }
        variants(first: 100) {
          edges {
            node {
              id
              metafield(namespace: "${GOOGLE_NS}", key: "size") { value }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{ product: any | null }>(query, { id });
  if (!data?.product) {
    throw new FeedEnricherError(`Product not found: ${productId}`);
  }

  const mfMap = new Map<string, string>();
  for (const edge of data.product.metafields?.edges ?? []) {
    if (edge.node?.key) mfMap.set(edge.node.key, edge.node.value);
  }

  const variants: VariantSize[] = (data.product.variants?.edges ?? []).map(
    (e: any) => ({
      variantId: e.node.id,
      size: e.node.metafield?.value ?? null,
    }),
  );

  return {
    productId: data.product.id,
    gender: mfMap.get("gender") ?? null,
    ageGroup: mfMap.get("age_group") ?? null,
    color: mfMap.get("color") ?? null,
    googleProductCategory: mfMap.get("category") ?? null,
    customLabels: [
      mfMap.get("custom_label_0") ?? null,
      mfMap.get("custom_label_1") ?? null,
      mfMap.get("custom_label_2") ?? null,
      mfMap.get("custom_label_3") ?? null,
      mfMap.get("custom_label_4") ?? null,
    ],
    variants,
  };
}

// ─────────────────────── 2. Write attributes ───────────────────────

interface MetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

function buildProductMetafields(
  productGid: string,
  attrs: GoogleFeedAttributes,
): MetafieldInput[] {
  const pairs: Array<[string, string | null]> = [
    ["gender", attrs.gender],
    ["age_group", attrs.ageGroup],
    ["color", attrs.color],
    ["category", attrs.googleProductCategory],
    ["custom_label_0", attrs.customLabels[0]],
    ["custom_label_1", attrs.customLabels[1]],
    ["custom_label_2", attrs.customLabels[2]],
    ["custom_label_3", attrs.customLabels[3]],
    ["custom_label_4", attrs.customLabels[4]],
  ];
  return pairs
    .filter(([, v]) => v != null && v !== "")
    .map(([key, value]) => ({
      ownerId: productGid,
      namespace: GOOGLE_NS,
      key,
      type: "single_line_text_field",
      value: String(value),
    }));
}

/**
 * Update product-level Google metafields and variant-level size metafields.
 * Variant updates are batched in groups of 8 (Shopify metafieldsSet limit
 * fits comfortably; we keep parity with the project's batch size).
 */
export async function updateProductFeedAttributes(
  productId: string,
  attributes: GoogleFeedAttributes,
): Promise<void> {
  const productGid = toGid(productId);

  // ── Product-level metafields via metafieldsSet ──
  const productMetafields = buildProductMetafields(productGid, attributes);
  if (productMetafields.length > 0) {
    const setMutation = /* GraphQL */ `
      mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key namespace }
          userErrors { field message code }
        }
      }
    `;
    // Batch in groups of 25 (Shopify hard limit per call)
    for (let i = 0; i < productMetafields.length; i += 25) {
      const slice = productMetafields.slice(i, i + 25);
      const data = await shopifyGraphQL<any>(setMutation, { metafields: slice });
      const errs = data?.metafieldsSet?.userErrors ?? [];
      if (errs.length) {
        throw new FeedEnricherError("metafieldsSet returned userErrors", errs);
      }
    }
  }

  // ── Variant-level sizes via productVariantsBulkUpdate ──
  const sized = attributes.variants.filter((v) => v.size != null && v.size !== "");
  if (sized.length === 0) return;

  const variantMutation = /* GraphQL */ `
    mutation BulkUpdateVariants(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
    ) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message code }
      }
    }
  `;

  // Bulk update accepts up to 250 variants in one call; chunk defensively.
  for (let i = 0; i < sized.length; i += 100) {
    const slice = sized.slice(i, i + 100).map((v) => ({
      id: v.variantId,
      metafields: [
        {
          namespace: GOOGLE_NS,
          key: "size",
          type: "single_line_text_field",
          value: String(v.size),
        },
      ],
    }));
    const data = await shopifyGraphQL<any>(variantMutation, {
      productId: productGid,
      variants: slice,
    });
    const errs = data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (errs.length) {
      throw new FeedEnricherError(
        "productVariantsBulkUpdate returned userErrors",
        errs,
      );
    }
  }
}

// ─────────────────── 3. Find products needing attention ───────────────────

export async function getProductsNeedingAttention(
  filters: AttentionFilter = {},
): Promise<ProductAttention[]> {
  const limit = Math.min(filters.limit ?? 100, 250);
  const minEdge = filters.minImageEdge ?? 250;
  const isApparel = (filters.productType ?? "apparel") === "apparel";

  // Shopify search syntax: filter to apparel via product_type
  const queryString = isApparel ? "product_type:Apparel OR product_type:Clothing" : "";

  const query = /* GraphQL */ `
    query AttentionScan($limit: Int!, $q: String) {
      products(first: $limit, query: $q) {
        edges {
          node {
            id
            title
            productType
            metafields(namespace: "${GOOGLE_NS}", first: 10) {
              edges { node { key value } }
            }
            media(first: 5) {
              edges {
                node {
                  ... on MediaImage {
                    image { width height }
                  }
                }
              }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  metafield(namespace: "${GOOGLE_NS}", key: "size") { value }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{ products: any }>(query, {
    limit,
    q: queryString || null,
  });

  const out: ProductAttention[] = [];
  for (const edge of data.products?.edges ?? []) {
    const node = edge.node;
    const mf = new Map<string, string>();
    for (const m of node.metafields?.edges ?? []) {
      if (m.node?.key) mf.set(m.node.key, m.node.value);
    }
    const reasons: AttentionReason[] = [];
    if (isApparel) {
      if (!mf.get("gender")) reasons.push("missing_gender");
      if (!mf.get("age_group")) reasons.push("missing_age_group");
      if (!mf.get("color")) reasons.push("missing_color");
      const missingSize = (node.variants?.edges ?? []).some(
        (v: any) => !v.node?.metafield?.value,
      );
      if (missingSize) reasons.push("missing_size");
    }

    // Smallest image edge across product media
    let smallest: number | null = null;
    for (const m of node.media?.edges ?? []) {
      const img = m.node?.image;
      if (!img?.width || !img?.height) continue;
      const edgePx = Math.min(img.width, img.height);
      if (smallest === null || edgePx < smallest) smallest = edgePx;
    }
    if (smallest !== null && smallest < minEdge) reasons.push("image_too_small");

    if (reasons.length > 0) {
      out.push({
        productId: node.id,
        title: node.title,
        productType: node.productType ?? null,
        reasons,
        smallestImageEdge: smallest,
      });
    }
  }

  return out;
}
