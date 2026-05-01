// Shopify CSV Export Schema for Scan Mode
// Maps scanned products into Shopify-compatible CSV rows

import { expandLineBySize } from "./size-run-expander";

export const SHOPIFY_CSV_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Variant SKU",
  "Variant Barcode",
  "Variant Price",
  "Cost per item",
  "Variant Inventory Qty",
  "Variant Inventory Tracker",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Status",
] as const;

// Product type → Shopify Product Category mapping
const CATEGORY_MAP: Record<string, string> = {
  dresses: "Apparel & Accessories > Clothing > Dresses",
  dress: "Apparel & Accessories > Clothing > Dresses",
  tops: "Apparel & Accessories > Clothing > Shirts & Tops",
  top: "Apparel & Accessories > Clothing > Shirts & Tops",
  pants: "Apparel & Accessories > Clothing > Pants",
  pant: "Apparel & Accessories > Clothing > Pants",
  shorts: "Apparel & Accessories > Clothing > Shorts",
  skirts: "Apparel & Accessories > Clothing > Skirts",
  skirt: "Apparel & Accessories > Clothing > Skirts",
  swimwear: "Apparel & Accessories > Clothing > Swimwear",
  "one piece": "Apparel & Accessories > Clothing > Swimwear",
  "bikini tops": "Apparel & Accessories > Clothing > Swimwear",
  "bikini bottoms": "Apparel & Accessories > Clothing > Swimwear",
  "swim dresses": "Apparel & Accessories > Clothing > Swimwear",
  shoes: "Apparel & Accessories > Shoes",
  sandals: "Apparel & Accessories > Shoes",
  boots: "Apparel & Accessories > Shoes",
  bags: "Apparel & Accessories > Handbags, Wallets & Cases",
  bag: "Apparel & Accessories > Handbags, Wallets & Cases",
  accessories: "Apparel & Accessories > Clothing Accessories",
  jewellery: "Apparel & Accessories > Jewelry",
  jewelry: "Apparel & Accessories > Jewelry",
  hats: "Apparel & Accessories > Clothing Accessories > Hats",
  hat: "Apparel & Accessories > Clothing Accessories > Hats",
  jackets: "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets",
  jacket: "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets",
  knitwear: "Apparel & Accessories > Clothing > Shirts & Tops",
  activewear: "Apparel & Accessories > Clothing > Activewear",
  sleepwear: "Apparel & Accessories > Clothing > Sleepwear & Loungewear",
  lingerie: "Apparel & Accessories > Clothing > Underwear & Socks",
  homewares: "Home & Garden",
  gifts: "Home & Garden",
};

export function inferCategory(type: string): string {
  if (!type) return "";
  return CATEGORY_MAP[type.toLowerCase().trim()] || "";
}

// Generate a Shopify-safe handle from title, with deduplication
export function generateHandles(titles: string[]): string[] {
  const counts: Record<string, number> = {};
  return titles.map(title => {
    let handle = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!handle) handle = "product";
    if (counts[handle] !== undefined) {
      counts[handle]++;
      handle = `${handle}-${counts[handle]}`;
    } else {
      counts[handle] = 1;
    }
    return handle;
  });
}

// Generate a fallback description if missing
export function fallbackDescription(title: string, type: string, colour: string): string {
  const parts: string[] = [];
  if (colour) parts.push(colour.toLowerCase());
  if (type && type !== "General") parts.push(type.toLowerCase());
  if (parts.length > 0) {
    return `<p>A ${parts.join(" ")} product. ${title}.</p>`;
  }
  return `<p>${title}.</p>`;
}

// Build tags string from available data
export function buildTags(product: { type: string; colour: string; tags: string; vendor: string }): string {
  const tagSet = new Set<string>();
  // Existing tags
  if (product.tags) {
    product.tags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
  }
  // Add type
  if (product.type && product.type !== "General") tagSet.add(product.type);
  // Add colour
  if (product.colour) tagSet.add(product.colour);
  // Source tag
  tagSet.add("scan-mode");
  return Array.from(tagSet).join(", ");
}

export interface ExportValidation {
  valid: boolean;
  issues: string[];
}

export function validateForExport(product: { title: string; type: string; price: number; quantity: number }): ExportValidation {
  const issues: string[] = [];
  if (!product.title || product.title === "Unidentified Product") issues.push("Missing or placeholder title");
  if (!product.type) issues.push("Missing product type");
  if (!product.price || product.price <= 0) issues.push("Price is required");
  if (product.quantity < 0) issues.push("Invalid quantity");
  return { valid: issues.length === 0, issues };
}

export interface ScannedProductForExport {
  title: string;
  type: string;
  vendor: string;
  description: string;
  tags: string;
  colour: string;
  /** Optional size; populated when expandLineBySize splits a size run. */
  size?: string;
  sku: string;
  barcode: string;
  price: number;
  quantity: number;
  costPerItem?: number;
}

/** Strip size and known colour tokens from a title so variants share the same base. */
function baseTitleFor(title: string): string {
  return (title || "")
    .replace(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|\d{1,3})\b/gi, "")
    .replace(/[·\-,|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slugify a title into a Shopify handle (no per-title dedup — variants share the handle). */
function slugifyHandle(title: string): string {
  const h = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return h || "product";
}

export function generateShopifyCSV(products: ScannedProductForExport[]): string {
  // Expand size runs ("8-16", "S-L") into one row per size — splits qty evenly.
  const expanded: ScannedProductForExport[] = products.flatMap((p) =>
    expandLineBySize({ ...p, qty: p.quantity }).map((x) => ({
      ...x,
      quantity: (x as { qty?: number }).qty ?? p.quantity,
    } as ScannedProductForExport))
  );

  const status = (typeof localStorage !== "undefined" && localStorage.getItem("sonic_invoice_publish_status") === "draft") ? "draft" : "active";

  // ── Group variants under one product per (vendor + base title). ──
  // B4-12 fix: previously every row got a unique -2/-3 handle so Shopify saw
  // N single-variant products instead of one product with N variants.
  type Group = { base: ScannedProductForExport; variants: ScannedProductForExport[] };
  const groups = new Map<string, Group>();
  for (const p of expanded) {
    const baseTitle = baseTitleFor(p.title) || p.title;
    const key = `${(p.vendor || "").toLowerCase()}::${baseTitle.toLowerCase()}::${(p.type || "").toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.variants.push(p);
    else groups.set(key, { base: { ...p, title: baseTitle }, variants: [p] });
  }

  // Ensure handles are unique across DIFFERENT products (not across variants).
  const handleCounts: Record<string, number> = {};
  const groupHandles = new Map<string, string>();
  for (const [key, g] of groups) {
    let h = slugifyHandle(g.base.title);
    if (handleCounts[h] !== undefined) {
      handleCounts[h]++;
      h = `${h}-${handleCounts[h]}`;
    } else {
      handleCounts[h] = 1;
    }
    groupHandles.set(key, h);
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  const allRows: string[][] = [];

  for (const [key, g] of groups) {
    const handle = groupHandles.get(key)!;
    const hasColour = g.variants.some((v) => !!v.colour);
    const hasSize = g.variants.some((v) => !!v.size);

    // Per project rule: Colour first, Size second.
    const option1Name = hasColour ? "Colour" : hasSize ? "Size" : "Title";
    const option2Name = hasColour && hasSize ? "Size" : "";

    // Dedupe variants on the (option1, option2) pair Shopify actually keys on.
    const seen = new Set<string>();
    const rowsForGroup: ScannedProductForExport[] = [];
    for (const v of g.variants) {
      const o1 = hasColour ? (v.colour || "Default") : hasSize ? (v.size || "One Size") : "Default Title";
      const o2 = option2Name ? (v.size || "One Size") : "";
      const k = `${o1}||${o2}`.toLowerCase();
      if (seen.has(k)) {
        const existing = rowsForGroup.find((r) => {
          const ro1 = hasColour ? (r.colour || "Default") : hasSize ? (r.size || "One Size") : "Default Title";
          const ro2 = option2Name ? (r.size || "One Size") : "";
          return `${ro1}||${ro2}`.toLowerCase() === k;
        });
        if (existing) existing.quantity = (existing.quantity ?? 0) + (v.quantity ?? 0);
        continue;
      }
      seen.add(k);
      rowsForGroup.push({ ...v });
    }

    const baseDesc = g.base.description
      ? (g.base.description.startsWith("<") ? g.base.description : `<p>${g.base.description}</p>`)
      : fallbackDescription(g.base.title, g.base.type, g.base.colour);
    const baseTags = buildTags(g.base);
    const baseCategory = inferCategory(g.base.type);

    rowsForGroup.forEach((v, idx) => {
      const isFirst = idx === 0;
      const o1Value = hasColour ? (v.colour || "Default") : hasSize ? (v.size || "One Size") : "Default Title";
      const o2Value = option2Name ? (v.size || "One Size") : "";

      // Shopify convention: product-level columns (Title/Body/Vendor/Type/Tags/Category/Published)
      // populate ONLY on the first row of each handle. Subsequent variant rows leave them blank.
      allRows.push([
        handle,                                                    // Handle
        isFirst ? g.base.title : "",                               // Title
        isFirst ? baseDesc : "",                                   // Body (HTML)
        isFirst ? (g.base.vendor || "") : "",                      // Vendor
        isFirst ? baseCategory : "",                               // Product Category
        isFirst ? (g.base.type || "") : "",                        // Type
        isFirst ? baseTags : "",                                   // Tags
        isFirst ? "TRUE" : "",                                     // Published
        isFirst ? option1Name : "",                                // Option1 Name
        o1Value,                                                   // Option1 Value
        isFirst ? option2Name : "",                                // Option2 Name
        o2Value,                                                   // Option2 Value
        v.sku || "",                                               // Variant SKU
        v.barcode || "",                                           // Variant Barcode
        (v.price ?? 0).toFixed(2),                                 // Variant Price
        v.costPerItem ? v.costPerItem.toFixed(2) : "",             // Cost per item
        String(v.quantity ?? 0),                                   // Variant Inventory Qty
        "shopify",                                                 // Variant Inventory Tracker
        "deny",                                                    // Variant Inventory Policy
        "manual",                                                  // Variant Fulfillment Service
        isFirst ? status : "",                                     // Status
      ]);
    });
  }

  return [
    SHOPIFY_CSV_HEADERS.join(","),
    ...allRows.map((r) => r.map(escape).join(",")),
  ].join("\n");
}
