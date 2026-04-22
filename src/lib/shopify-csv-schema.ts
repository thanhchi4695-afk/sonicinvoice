// Shopify CSV Export Schema for Scan Mode
// Maps scanned products into Shopify-compatible CSV rows

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
  sku: string;
  barcode: string;
  price: number;
  quantity: number;
  costPerItem?: number;
}

export function generateShopifyCSV(products: ScannedProductForExport[]): string {
  const handles = generateHandles(products.map(p => p.title));
  // Lazy import to avoid circular deps in some bundlers
  const status = (typeof localStorage !== "undefined" && localStorage.getItem("sonic_invoice_publish_status") === "draft") ? "draft" : "active";

  const rows = products.map((p, i) => {
    const desc = p.description
      ? (p.description.startsWith("<") ? p.description : `<p>${p.description}</p>`)
      : fallbackDescription(p.title, p.type, p.colour);
    const tags = buildTags(p);
    const category = inferCategory(p.type);

    return [
      handles[i],                          // Handle
      p.title,                             // Title
      desc,                                // Body (HTML)
      p.vendor,                            // Vendor
      category,                            // Product Category
      p.type,                              // Type
      tags,                                // Tags
      "TRUE",                              // Published
      "Title",                             // Option1 Name
      "Default Title",                     // Option1 Value
      p.sku,                               // Variant SKU
      p.barcode,                           // Variant Barcode
      p.price.toFixed(2),                  // Variant Price
      p.costPerItem ? p.costPerItem.toFixed(2) : "", // Cost per item
      p.quantity.toString(),               // Variant Inventory Qty
      "shopify",                           // Variant Inventory Tracker
      "deny",                              // Variant Inventory Policy
      "manual",                            // Variant Fulfillment Service
      status,                              // Status
    ];
  });

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  return [
    SHOPIFY_CSV_HEADERS.join(","),
    ...rows.map(r => r.map(escape).join(",")),
  ].join("\n");
}
