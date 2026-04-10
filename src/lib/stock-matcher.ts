// ── Stock Matcher — Invoice Stock Check matching logic ──
// Pure TypeScript — no Shopify API calls. Takes raw data
// and returns a classification for each invoice line item.

export type MatchOutcome =
  | "refill"       // exact variant already exists
  | "new_colour"   // product exists, colour is new
  | "new_product"; // nothing close found

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

// ── Group key for display ──
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

// ── MATCH A SINGLE LINE ITEM ──

export function matchLineItem(
  item: InvoiceLineItem,
  shopifyVariants: ShopifyVariant[]
): MatchResult {
  // STEP 1: Exact barcode match
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

  // STEP 2: Exact SKU match
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

  // STEP 3: Style number prefix match
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

  // STEP 4: Title fuzzy match
  const titleMatches = shopifyVariants
    .map(v => ({ variant: v, score: titleSimilarity(item.styleName, v.product.title) }))
    .filter(m => m.score >= 0.6)
    .sort((a, b) => b.score - a.score);

  if (titleMatches.length > 0) {
    const best = titleMatches[0];
    const product = best.variant.product;
    const vendorScore = vendorMatch(item.brand, product.vendor);
    const colourExists = product.variants.some(v => coloursMatch(v.option1, item.colour));

    if (colourExists && vendorScore > 0.7) {
      return {
        lineItem: item, outcome: "refill",
        confidence: Math.round(best.score * 75),
        matchedVariant: product.variants.find(v =>
          coloursMatch(v.option1, item.colour) && sizesMatch(v.option2, item.size)
        ) || null,
        matchedProduct: product,
        reasons: [
          `Title similarity ${Math.round(best.score * 100)}% with "${product.title}"`,
          `Brand "${item.brand}" matches vendor "${product.vendor}"`,
          `Colour "${item.colour}" already exists in this product`,
        ],
        suggestedAction: `Likely refill — please confirm this is "${product.title}"`,
      };
    }

    if (vendorScore > 0.5) {
      return {
        lineItem: item, outcome: "new_colour",
        confidence: Math.round(best.score * 65),
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

  // STEP 5: No match — new product
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

// ── MATCH ALL LINE ITEMS ──

export function matchAllLineItems(
  items: InvoiceLineItem[],
  variants: ShopifyVariant[]
): MatchResult[] {
  return items.map(item => matchLineItem(item, variants));
}

// ── GROUP BY STYLE + COLOUR ──

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
      // Use lowest confidence in the group
      if (r.confidence < existing.confidence) {
        existing.confidence = r.confidence;
        existing.reasons = r.reasons;
      }
    } else {
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

// ── HELPER FUNCTIONS ──

function normalise(s: string): string {
  return (s || "").trim().toUpperCase().replace(/[-\s_]/g, "");
}

function extractStylePrefix(sku: string): string {
  if (!sku) return "";
  const parts = sku.split(/[-_]/);
  return parts.length > 1 ? parts[0] : "";
}

function coloursMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    (s || "").toLowerCase()
      .replace(/\s+(floral|print|stripe|check|spot|dot|multi)$/i, "")
      .trim().replace(/\s+/g, " ");
  if (norm(a) === norm(b)) return true;
  const na = norm(a), nb = norm(b);
  return na.includes(nb) || nb.includes(na);
}

function sizesMatch(a: string, b: string): boolean {
  return (a || "").trim().toUpperCase() === (b || "").trim().toUpperCase();
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

function vendorMatch(brand: string, vendor: string): number {
  return titleSimilarity(brand, vendor);
}
