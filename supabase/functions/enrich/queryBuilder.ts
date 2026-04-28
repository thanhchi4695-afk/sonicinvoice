// ───────────────────────────────────────────────────────────────
// Query Builder
// Builds an ordered array of search queries for product enrichment,
// prioritising rich product attributes before low-signal SKU fallbacks.
// ───────────────────────────────────────────────────────────────

export interface ProductQueryInput {
  brand?: string | null;
  vendor?: string | null;
  product_name?: string | null;
  name?: string | null;
  sku?: string | null;
  style_code?: string | null;
  colour?: string | null;
  color?: string | null;
  material?: string | null;
  fabric?: string | null;
  category?: string | null;
  type?: string | null;
  [key: string]: unknown;
}

/**
 * Join non-empty parts with single spaces, trimming whitespace.
 */
function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build an ordered list of search queries for a product, from most
 * specific to most general. Empty/undefined fields are skipped, and
 * any query string that ends up empty is removed. Duplicate queries
 * are de-duplicated while preserving order.
 */
export function buildProductQuery(productData: ProductQueryInput): string[] {
  if (!productData || typeof productData !== "object") return [];

  const brand =
    (productData.brand as string | undefined) ||
    (productData.vendor as string | undefined) ||
    "";
  const productName =
    (productData.product_name as string | undefined) ||
    (productData.name as string | undefined) ||
    "";
  const sku =
    (productData.sku as string | undefined) ||
    (productData.style_code as string | undefined) ||
    "";
  const colour =
    (productData.colour as string | undefined) ||
    (productData.color as string | undefined) ||
    "";
  const material =
    (productData.material as string | undefined) ||
    (productData.fabric as string | undefined) ||
    "";
  const category =
    (productData.category as string | undefined) ||
    (productData.type as string | undefined) ||
    "";

  const queries: string[] = [];

  // 1. Best match rate: brand + product name + colour + material
  const richAttributeQuery = joinParts([brand, productName, colour, material]);
  if (richAttributeQuery) queries.push(richAttributeQuery);

  // 2. Brand + product name + category
  const categoryQuery = joinParts([brand, productName, category]);
  if (categoryQuery) queries.push(categoryQuery);

  // 3. Product name + brand fallback
  const nameBrandQuery = joinParts([productName, brand]);
  if (nameBrandQuery) queries.push(nameBrandQuery);

  // 4. SKU fallback last — useful, but lower match rate than structured attributes
  if (sku) {
    const skuQuery = joinParts([brand, sku]);
    if (skuQuery) queries.push(skuQuery);
  }

  // De-duplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of queries) {
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(q);
    }
  }

  return unique;
}
