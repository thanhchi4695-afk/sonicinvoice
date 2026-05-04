// Feed Health detection logic — gender, age_group, color extraction

export interface FeedHealthProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  imageUrl: string | null;
  altText?: string | null;
  description?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageId?: number | null;
  googleCategory?: string | null;
  variants: Array<{
    id: number;
    sku: string;
    barcode?: string;
    selectedOptions?: Array<{ name: string; value: string }>;
    option1?: string;
    option2?: string;
    option3?: string;
  }>;
}

export interface DetectedAttributes {
  gender: string;
  genderConf: "high" | "medium" | "low";
  genderReason: string;
  ageGroup: string;
  ageConf: "high" | "medium" | "low";
  ageReason: string;
  color: string | null;
  colorConf: "high" | "medium" | "low";
  colorMethod: string;
}

export interface FeedHealthRow {
  product: FeedHealthProduct;
  detected: DetectedAttributes;
  pushed: boolean;
  edited: boolean;
}

// ── COLOUR ──────────────────────────────────────────

const COLOUR_STOP_WORDS = new Set([
  "womens", "mens", "girls", "boys", "kids", "one", "size",
  "regular", "petite", "plus", "n/a", "na", "see", "image",
  "variety", "pack", "set", "bundle", "pair",
]);

function isValidColour(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/^\d+$/.test(t)) return false;
  if (t.startsWith("#")) return false;
  if (COLOUR_STOP_WORDS.has(t.toLowerCase())) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  return true;
}

export function extractColourFromTitle(title: string): { colour: string | null; method: string; confidence: "high" | "medium" | "low" } {
  // Pattern A: "Brand Style - ColourName, Size"
  const dashComma = title.match(/\s-\s(.+?),\s*(?:\d+[A-Z]?|XS|S|M|L|XL|XXL|One Size)$/i);
  if (dashComma) {
    const c = dashComma[1].trim();
    if (isValidColour(c)) return { colour: c, method: "title_dash", confidence: "high" };
  }

  // Pattern A2: "Brand Style - ColourName" (no size)
  const lastDash = title.match(/\s-\s([^-,]+?)$/);
  if (lastDash) {
    const c = lastDash[1].trim();
    if (isValidColour(c)) return { colour: c, method: "title_dash_nosuffix", confidence: "high" };
  }

  return { colour: null, method: "none", confidence: "low" };
}

export function extractColourFromVariant(variants: FeedHealthProduct["variants"]): string | null {
  const COLOUR_KEYS = new Set(["colour", "color", "print", "colourway", "shade"]);

  for (const variant of variants) {
    if (variant.selectedOptions) {
      for (const opt of variant.selectedOptions) {
        if (COLOUR_KEYS.has(opt.name.toLowerCase()) && isValidColour(opt.value)) return opt.value;
      }
    }
    // Fallback: check option1/option2/option3 names aren't available in REST, but values might be colors
  }
  return null;
}

// ── GENDER ──────────────────────────────────────────

export function detectGender(product: FeedHealthProduct): { value: string; confidence: "high" | "medium" | "low"; reason: string } {
  const title = (product.title || "").toLowerCase();
  const type = (product.productType || "").toLowerCase();
  const tags = product.tags.join(",").toLowerCase();

  if (
    tags.includes("mens") || /\bboys\b/.test(tags) ||
    (type.includes("boardshort") && !tags.includes("womens")) ||
    tags.includes("funky trunks") ||
    title.includes(" men's ") || title.includes(" mens ")
  ) return { value: "male", confidence: "high", reason: "Tag or type indicates male" };

  if (
    tags.includes("unisex") || title.includes("unisex") ||
    (tags.includes("kids") && type.includes("rashie") && !tags.includes("boys") && !tags.includes("girls"))
  ) return { value: "unisex", confidence: "high", reason: "Unisex tag or kids rashie" };

  if (
    tags.includes("womens") || tags.includes("girls") ||
    type.includes("bikini") || type.includes("one piece") ||
    type.includes("swimdress") || type.includes("tankini")
  ) return { value: "female", confidence: "high", reason: "Womens/girls tag or product type" };

  return { value: "female", confidence: "medium", reason: "Defaulted to female (swimwear dominant)" };
}

// ── AGE GROUP ────────────────────────────────────────

export function detectAgeGroup(product: FeedHealthProduct): { value: string; confidence: "high" | "medium" | "low"; reason: string } {
  const title = (product.title || "").toLowerCase();
  const type = (product.productType || "").toLowerCase();
  const tags = product.tags.join(",").toLowerCase();

  if (title.includes("newborn") || tags.includes("newborn") || title.includes("0-3 month"))
    return { value: "newborn", confidence: "high", reason: "Newborn in title or tag" };

  if (title.includes("infant") || tags.includes("infant") || title.includes("baby") || tags.includes("baby"))
    return { value: "infant", confidence: "high", reason: "Infant/baby tag" };

  if (title.includes("toddler") || tags.includes("toddler") || tags.includes("00-7"))
    return { value: "toddler", confidence: "high", reason: "Toddler tag" };

  if (tags.includes("kids") || tags.includes("boys") || tags.includes("girls") || /boys\s*\d/i.test(tags) || /girls\s*\d/i.test(tags) || type.includes("kids") || type.includes("children"))
    return { value: "kids", confidence: "high", reason: "Kids/boys/girls tag" };

  return { value: "adult", confidence: "medium", reason: "Defaulted to adult" };
}

// ── MAIN DETECTION ──────────────────────────────────

export function detectAttributes(product: FeedHealthProduct): DetectedAttributes {
  const gender = detectGender(product);
  const age = detectAgeGroup(product);

  let colourResult = extractColourFromTitle(product.title);
  if (!colourResult.colour && product.variants.length > 0) {
    const variantColour = extractColourFromVariant(product.variants);
    if (variantColour) {
      colourResult = { colour: variantColour, method: "variant_option", confidence: "high" };
    }
  }

  return {
    gender: gender.value,
    genderConf: gender.confidence,
    genderReason: gender.reason,
    ageGroup: age.value,
    ageConf: age.confidence,
    ageReason: age.reason,
    color: colourResult.colour,
    colorConf: colourResult.confidence,
    colorMethod: colourResult.method,
  };
}

// ── SHOPIFY PRODUCT PARSER ──────────────────────────

export function parseShopifyProduct(raw: any): FeedHealthProduct {
  const tags = typeof raw.tags === "string"
    ? raw.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : Array.isArray(raw.tags) ? raw.tags : [];

  const firstImage = raw.images?.[0] || raw.image || null;
  const imageUrl = firstImage?.src || null;
  const altText = firstImage?.alt || null;
  const imageWidth = firstImage?.width || null;
  const imageHeight = firstImage?.height || null;
  const imageId = firstImage?.id || null;

  const variants = (raw.variants || []).map((v: any) => ({
    id: v.id,
    sku: v.sku || "",
    barcode: v.barcode || "",
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
  }));

  return {
    id: `gid://shopify/Product/${raw.id}`,
    title: raw.title || "",
    handle: raw.handle || "",
    vendor: raw.vendor || "",
    productType: raw.product_type || "",
    tags,
    imageUrl,
    altText,
    description: raw.body_html ? String(raw.body_html).replace(/<[^>]*>/g, "").trim() : null,
    imageWidth,
    imageHeight,
    imageId,
    variants,
  };
}
