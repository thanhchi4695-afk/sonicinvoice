// ── Legacy Stock Matcher (Stock Check / Invoice flow) ──
// Preserved for InvoiceFlow, StockCheckFlow, WholesaleImportFlow.
// New reconciliation engine lives in src/lib/stock-matcher.ts.

export type MatchOutcome =
  | "refill"
  | "new_colour"
  | "new_product";

export interface InvoiceLineItem {
  styleNumber:  string;
  styleName:    string;
  colour:       string;
  colourCode:   string;
  size:         string;
  barcode:      string;
  sku:          string;
  brand:        string;
  quantityOrdered: number;
  rrp:          number;
  wholesale:    number;
  imageUrl?:    string;
  description?: string;
  productType?: string;
  season?:      string;
  collection?:  string;
}

export interface ShopifyVariant {
  id:              string;
  sku:             string;
  barcode:         string;
  title:           string;
  inventoryItemId: string;
  inventoryQty:    number;
  price:           string;
  option1:         string;
  option2:         string;
  image?:          string;
  product: {
    id:          string;
    title:       string;
    vendor:      string;
    productType: string;
    tags:        string[];
    options:     { name: string; values: string[] }[];
    variants:    ShopifyVariant[];
  };
}

export interface MatchResult {
  lineItem:       InvoiceLineItem;
  outcome:        MatchOutcome;
  confidence:     number;
  matchedVariant: ShopifyVariant | null;
  matchedProduct: ShopifyVariant["product"] | null;
  reasons:        string[];
  suggestedAction:string;
}

export interface GroupedMatch {
  styleNumber: string;
  styleName:   string;
  colour:      string;
  brand:       string;
  outcome:     MatchOutcome;
  confidence:  number;
  matchedProduct: ShopifyVariant["product"] | null;
  reasons:     string[];
  suggestedAction: string;
  imageUrl?:   string;
  platform?:   "shopify" | "lightspeed_x" | "lightspeed_r";
  sizes: { size: string; qty: number; matchedVariant: ShopifyVariant | null; lineItem: InvoiceLineItem }[];
  totalQty:    number;
}

export interface ClassifiedItem {
  original_line: InvoiceLineItem;
  classification: MatchOutcome;
  shopify_match: {
    product_id: string | null;
    variant_id: string | null;
  };
  action: {
    type: "inventory_adjust" | "add_variant" | "create_product";
    details: Record<string, unknown>;
  };
  confidence: number;
  reason: string;
}

export interface ClassificationSummary {
  refills: number;
  new_colours: number;
  new_products: number;
  total_quantity_to_add: number;
}

export interface ClassificationResult {
  classified_items: ClassifiedItem[];
  summary: ClassificationSummary;
}

const COLOUR_ABBREVIATIONS: Record<string, string> = {
  blk: "black", bk: "black", blck: "black",
  wht: "white", wh: "white", wte: "white",
  nvy: "navy", nv: "navy",
  gry: "grey", gr: "grey", gray: "grey",
  brn: "brown", br: "brown",
  grn: "green", gn: "green",
  blu: "blue", bl: "blue",
  pnk: "pink", pk: "pink",
  red: "red", rd: "red",
  org: "orange", orn: "orange",
  ylw: "yellow", yl: "yellow",
  prp: "purple", pur: "purple",
  crm: "cream", cr: "cream",
  tan: "tan", tn: "tan",
  olv: "olive", oliv: "olive",
  brg: "burgundy", burg: "burgundy",
  kha: "khaki", kh: "khaki",
  cor: "coral", crl: "coral",
  rst: "rust", rs: "rust",
  sge: "sage", sg: "sage",
  tl: "teal", tea: "teal",
  lav: "lavender", lv: "lavender",
  mnt: "mint", mn: "mint",
  ivo: "ivory", iv: "ivory",
  chc: "charcoal", char: "charcoal",
  mve: "mauve", mv: "mauve",
  nat: "natural", ntl: "natural",
  snd: "sand", sd: "sand",
  mul: "multi", mlt: "multi",
  dnm: "denim", den: "denim",
  cml: "camel", cam: "camel",
  fch: "fuchsia", fuc: "fuchsia",
  trq: "turquoise", tur: "turquoise",
  mag: "magenta", mgn: "magenta",
  ind: "indigo",
  plt: "platinum",
  slv: "silver", sv: "silver",
  gld: "gold", gl: "gold",
  rse: "rose", ros: "rose",
  sky: "sky blue",
  cob: "cobalt",
  aqm: "aquamarine", aqu: "aqua",
};

const SIZE_ALIASES: Record<string, string> = {
  xxs: "XXS", "2xs": "XXS",
  xs: "XS", "x-small": "XS", "x small": "XS", "extra small": "XS",
  s: "S", sm: "S", sml: "S", small: "S",
  m: "M", md: "M", med: "M", medium: "M",
  l: "L", lg: "L", lrg: "L", large: "L",
  xl: "XL", "x-large": "XL", "x large": "XL", "extra large": "XL",
  xxl: "XXL", "2xl": "XXL", "xx-large": "XXL",
  xxxl: "XXXL", "3xl": "XXXL",
  "0": "0", "00": "00",
  "4": "4", "6": "6", "8": "8", "10": "10", "12": "12",
  "14": "14", "16": "16", "18": "18", "20": "20",
  "one size": "OS", os: "OS", "o/s": "OS", onesize: "OS",
};

function normaliseSizeLegacy(s: string): string {
  const trimmed = (s || "").trim().toLowerCase().replace(/[.\-_]/g, "");
  return SIZE_ALIASES[trimmed] || (s || "").trim().toUpperCase();
}

export function matchLineItem(
  item: InvoiceLineItem,
  shopifyVariants: ShopifyVariant[]
): MatchResult {
  if (item.barcode) {
    const barcodeMatch = shopifyVariants.find(v =>
      normalise(v.barcode) === normalise(item.barcode)
    );
    if (barcodeMatch) {
      return {
        lineItem: item, outcome: "refill", confidence: 99,
        matchedVariant: barcodeMatch, matchedProduct: barcodeMatch.product,
        reasons: [`Barcode ${item.barcode} matched exactly`],
        suggestedAction: `Add ${item.quantityOrdered} units to existing stock`,
      };
    }
  }

  if (item.sku) {
    const skuMatch = shopifyVariants.find(v =>
      normalise(v.sku) === normalise(item.sku)
    );
    if (skuMatch) {
      return {
        lineItem: item, outcome: "refill", confidence: 97,
        matchedVariant: skuMatch, matchedProduct: skuMatch.product,
        reasons: [`SKU "${item.sku}" matched exactly`],
        suggestedAction: `Add ${item.quantityOrdered} units to existing stock`,
      };
    }
  }

  if (item.sku) {
    const fuzzySku = normalise(item.sku);
    const fuzzyMatches = shopifyVariants.filter(v => {
      const vs = normalise(v.sku);
      if (!vs || !fuzzySku) return false;
      return (vs.startsWith(fuzzySku) || fuzzySku.startsWith(vs)) &&
             Math.abs(vs.length - fuzzySku.length) <= 4;
    });
    if (fuzzyMatches.length > 0) {
      const best = fuzzyMatches[0];
      const product = best.product;
      const colourExists = product.variants.some(v => coloursMatch(v.option1, item.colour));
      if (colourExists) {
        const sizeMatch = product.variants.find(v =>
          coloursMatch(v.option1, item.colour) && sizesMatch(v.option2, item.size)
        );
        if (sizeMatch) {
          return {
            lineItem: item, outcome: "refill", confidence: 90,
            matchedVariant: sizeMatch, matchedProduct: product,
            reasons: [`Fuzzy SKU match: "${item.sku}" ≈ "${best.sku}"`, `Colour + size confirmed`],
            suggestedAction: `Add ${item.quantityOrdered} units to existing stock`,
          };
        }
      }
      return {
        lineItem: item, outcome: colourExists ? "refill" : "new_colour",
        confidence: 80,
        matchedVariant: null, matchedProduct: product,
        reasons: [`Fuzzy SKU match: "${item.sku}" ≈ "${best.sku}"`, colourExists ? `Colour exists but size "${item.size}" may be new` : `Colour "${item.colour}" is new`],
        suggestedAction: colourExists
          ? `Verify size variant for "${product.title}"`
          : `Add "${item.colour}" as new colour to "${product.title}"`,
      };
    }
  }

  const stylePrefix = extractStylePrefix(item.styleNumber || item.sku);
  if (stylePrefix) {
    const stylePrefixMatches = shopifyVariants.filter(v =>
      v.sku && v.sku.toUpperCase().startsWith(stylePrefix.toUpperCase())
    );

    if (stylePrefixMatches.length > 0) {
      const product = stylePrefixMatches[0].product;
      const colourAlreadyExists = product.variants.some(v =>
        coloursMatch(v.option1, item.colour)
      );

      if (colourAlreadyExists) {
        const sizeMatch = product.variants.find(v =>
          coloursMatch(v.option1, item.colour) && sizesMatch(v.option2, item.size)
        );
        if (sizeMatch) {
          return {
            lineItem: item, outcome: "refill", confidence: 82,
            matchedVariant: sizeMatch, matchedProduct: product,
            reasons: [
              `Style prefix "${stylePrefix}" found in Shopify`,
              `Colour "${item.colour}" already exists`,
              `Size "${item.size}" already exists`,
              "Matched by style + colour + size (no exact SKU/barcode match)",
            ],
            suggestedAction: `Add ${item.quantityOrdered} units — verify this is the right variant`,
          };
        } else {
          return {
            lineItem: item, outcome: "new_colour", confidence: 78,
            matchedVariant: null, matchedProduct: product,
            reasons: [
              `Style prefix "${stylePrefix}" found in Shopify`,
              `Colour "${item.colour}" already exists`,
              `Size "${item.size}" not found — new size variant`,
            ],
            suggestedAction: `Add size "${item.size}" as new variant to "${product.title}"`,
          };
        }
      } else {
        return {
          lineItem: item, outcome: "new_colour", confidence: 85,
          matchedVariant: null, matchedProduct: product,
          reasons: [
            `Style prefix "${stylePrefix}" found: "${product.title}"`,
            `Colour "${item.colour}" is new for this style`,
            `Existing colours: ${getExistingColours(product.variants).join(", ")}`,
          ],
          suggestedAction: `Add "${item.colour}" as new colour variant to "${product.title}"`,
        };
      }
    }
  }

  const titleMatches = shopifyVariants
    .map(v => ({
      variant: v,
      score: Math.max(
        titleSimilarity(item.styleName, v.product.title),
        bigramSimilarity(item.styleName, v.product.title)
      ),
    }))
    .filter(m => m.score >= 0.55)
    .sort((a, b) => b.score - a.score);

  if (titleMatches.length > 0) {
    const best = titleMatches[0];
    const product = best.variant.product;
    const vendorScore = vendorMatch(item.brand, product.vendor);
    const colourExists = product.variants.some(v => coloursMatch(v.option1, item.colour));

    if (colourExists && vendorScore > 0.6) {
      const sizeMatch = product.variants.find(v =>
        coloursMatch(v.option1, item.colour) && sizesMatch(v.option2, item.size)
      );
      return {
        lineItem: item, outcome: "refill",
        confidence: Math.round(best.score * 80),
        matchedVariant: sizeMatch || null,
        matchedProduct: product,
        reasons: [
          `Title similarity ${Math.round(best.score * 100)}% with "${product.title}"`,
          `Brand "${item.brand}" matches vendor "${product.vendor}"`,
          `Colour "${item.colour}" already exists in this product`,
          ...(sizeMatch ? [`Size "${item.size}" confirmed`] : [`Size "${item.size}" may need adding`]),
        ],
        suggestedAction: `Likely refill — please confirm this is "${product.title}"`,
      };
    }

    if (vendorScore > 0.4 || best.score > 0.75) {
      return {
        lineItem: item, outcome: "new_colour",
        confidence: Math.round(best.score * 70),
        matchedVariant: null, matchedProduct: product,
        reasons: [
          `Title similarity ${Math.round(best.score * 100)}% with "${product.title}"`,
          `Colour "${item.colour}" is new for this product`,
          `Please confirm match before adding variant`,
        ],
        suggestedAction: `Possible new colour for "${product.title}" — review carefully`,
      };
    }
  }

  return {
    lineItem: item, outcome: "new_product", confidence: 95,
    matchedVariant: null, matchedProduct: null,
    reasons: [
      `No SKU, barcode, or title match found in Shopify`,
      `"${item.styleName}" by ${item.brand} appears to be a new product`,
    ],
    suggestedAction: `Create new product "${item.styleName}" with ${item.size} as first variant`,
  };
}

export function matchAllLineItems(
  items: InvoiceLineItem[],
  variants: ShopifyVariant[]
): MatchResult[] {
  return items.map(item => matchLineItem(item, variants));
}

export function classifyAllItems(
  items: InvoiceLineItem[],
  variants: ShopifyVariant[]
): ClassificationResult {
  const results = matchAllLineItems(items, variants);
  const classified: ClassifiedItem[] = results.map(r => ({
    original_line: r.lineItem,
    classification: r.outcome,
    shopify_match: {
      product_id: r.matchedProduct?.id || null,
      variant_id: r.matchedVariant?.id || null,
    },
    action: buildAction(r),
    confidence: r.confidence,
    reason: r.reasons.join("; "),
  }));

  return {
    classified_items: classified,
    summary: {
      refills: classified.filter(c => c.classification === "refill").length,
      new_colours: classified.filter(c => c.classification === "new_colour").length,
      new_products: classified.filter(c => c.classification === "new_product").length,
      total_quantity_to_add: classified.reduce((sum, c) => sum + c.original_line.quantityOrdered, 0),
    },
  };
}

function buildAction(r: MatchResult): ClassifiedItem["action"] {
  switch (r.outcome) {
    case "refill":
      return {
        type: "inventory_adjust",
        details: {
          variant_id: r.matchedVariant?.id || null,
          inventory_item_id: r.matchedVariant?.inventoryItemId || null,
          quantity_to_add: r.lineItem.quantityOrdered,
          current_qty: r.matchedVariant?.inventoryQty ?? null,
          new_qty: r.matchedVariant ? r.matchedVariant.inventoryQty + r.lineItem.quantityOrdered : null,
          unit_cost: r.lineItem.wholesale,
        },
      };
    case "new_colour":
      return {
        type: "add_variant",
        details: {
          product_id: r.matchedProduct?.id || null,
          product_title: r.matchedProduct?.title || r.lineItem.styleName,
          colour: r.lineItem.colour,
          size: r.lineItem.size,
          sku: r.lineItem.sku,
          barcode: r.lineItem.barcode,
          price: r.lineItem.rrp,
          cost: r.lineItem.wholesale,
          quantity: r.lineItem.quantityOrdered,
        },
      };
    case "new_product":
      return {
        type: "create_product",
        details: {
          title: r.lineItem.styleName,
          vendor: r.lineItem.brand,
          product_type: r.lineItem.productType || "",
          tags: [r.lineItem.season, r.lineItem.collection].filter(Boolean),
          image_url: r.lineItem.imageUrl || null,
          variant: {
            colour: r.lineItem.colour,
            size: r.lineItem.size,
            sku: r.lineItem.sku,
            barcode: r.lineItem.barcode,
            price: r.lineItem.rrp,
            cost: r.lineItem.wholesale,
            quantity: r.lineItem.quantityOrdered,
          },
        },
      };
  }
}

export function groupMatchResults(results: MatchResult[]): GroupedMatch[] {
  const groups = new Map<string, GroupedMatch>();

  for (const r of results) {
    const key = `${r.lineItem.styleNumber || r.lineItem.styleName}::${r.lineItem.colour}`;
    const existing = groups.get(key);

    if (existing) {
      existing.sizes.push({
        size: r.lineItem.size,
        qty: r.lineItem.quantityOrdered,
        matchedVariant: r.matchedVariant,
        lineItem: r.lineItem,
      });
      existing.totalQty += r.lineItem.quantityOrdered;
      if (r.confidence < existing.confidence) {
        existing.confidence = r.confidence;
        existing.reasons = r.reasons;
      }
    } else {
      const variantPlatform = (r.matchedVariant as unknown as Record<string, unknown> | null)?._platform as GroupedMatch["platform"] | undefined;
      groups.set(key, {
        styleNumber: r.lineItem.styleNumber,
        styleName: r.lineItem.styleName,
        colour: r.lineItem.colour,
        brand: r.lineItem.brand,
        outcome: r.outcome,
        confidence: r.confidence,
        matchedProduct: r.matchedProduct,
        reasons: r.reasons,
        suggestedAction: r.suggestedAction,
        imageUrl: r.lineItem.imageUrl,
        platform: variantPlatform || (r.matchedVariant ? "shopify" : undefined),
        sizes: [{
          size: r.lineItem.size,
          qty: r.lineItem.quantityOrdered,
          matchedVariant: r.matchedVariant,
          lineItem: r.lineItem,
        }],
        totalQty: r.lineItem.quantityOrdered,
      });
    }
  }

  return Array.from(groups.values());
}

function normalise(s: string): string {
  return (s || "").trim().toUpperCase().replace(/[-\s_]/g, "");
}

function extractStylePrefix(sku: string): string {
  if (!sku) return "";
  const parts = sku.split(/[-_]/);
  return parts.length > 1 ? parts[0] : "";
}

function normaliseColour(s: string): string {
  let c = (s || "").toLowerCase().trim()
    .replace(/\s+(floral|print|stripe|check|spot|dot|multi)$/i, "")
    .replace(/\s+/g, " ");
  const abbr = COLOUR_ABBREVIATIONS[c.replace(/\s/g, "")];
  if (abbr) c = abbr;
  return c;
}

function coloursMatch(a: string, b: string): boolean {
  const na = normaliseColour(a);
  const nb = normaliseColour(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aExpanded = COLOUR_ABBREVIATIONS[na.replace(/\s/g, "")] || na;
  const bExpanded = COLOUR_ABBREVIATIONS[nb.replace(/\s/g, "")] || nb;
  return aExpanded === bExpanded;
}

function sizesMatch(a: string, b: string): boolean {
  return normaliseSizeLegacy(a) === normaliseSizeLegacy(b);
}

function getExistingColours(variants: ShopifyVariant[]): string[] {
  return [...new Set(variants.map(v => v.option1).filter(Boolean))];
}

function titleSimilarity(a: string, b: string): number {
  const tokenise = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const ta = tokenise(a), tb = tokenise(b);
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

function bigramSimilarity(a: string, b: string): number {
  const bigrams = (s: string): string[] => {
    const clean = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const result: string[] = [];
    for (let i = 0; i < clean.length - 1; i++) {
      result.push(clean.slice(i, i + 2));
    }
    return result;
  };
  const ba = bigrams(a), bb = bigrams(b);
  if (ba.length === 0 || bb.length === 0) return 0;
  const setB = new Set(bb);
  const intersection = ba.filter(bg => setB.has(bg)).length;
  return (2 * intersection) / (ba.length + bb.length);
}

function vendorMatch(brand: string, vendor: string): number {
  const jac = titleSimilarity(brand, vendor);
  const big = bigramSimilarity(brand, vendor);
  return Math.max(jac, big);
}
