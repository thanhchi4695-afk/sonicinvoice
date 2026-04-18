// ── Stock Matcher — Reconciliation Engine ──
// Matches invoice line items against the cached product catalog
// (product_catalog_cache) and classifies each line as new,
// exact_refill, new_variant, new_colour, or conflict.

// Re-export legacy stock-check engine for InvoiceFlow / StockCheckFlow / WholesaleImportFlow
export type {
  MatchOutcome,
  InvoiceLineItem,
  ShopifyVariant,
  MatchResult,
  GroupedMatch,
  ClassifiedItem,
  ClassificationSummary,
  ClassificationResult,
} from "./stock-matcher-legacy";
export {
  matchLineItem,
  matchAllLineItems,
  classifyAllItems,
  groupMatchResults,
} from "./stock-matcher-legacy";

export interface InvoiceLine {
  sku?: string;
  product_name?: string;
  brand?: string;
  colour?: string;
  size?: string;
  qty: number;
  cost?: number;
  rrp?: number;
  barcode?: string;
}

export interface ProductCatalogItem {
  platform_product_id: string;
  platform_variant_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  colour?: string | null;
  size?: string | null;
  current_qty?: number | null;
  current_cost?: number | null;
  current_price?: number | null;
  vendor?: string | null;
}

export interface MatchOptions {
  skuMatchWeight?: number;
  nameMatchWeight?: number;
  fuzzyThreshold?: number;
  priceDeltaThreshold?: number;
  platform: "shopify" | "lightspeed";
}

export type MatchType =
  | "new"
  | "exact_refill"
  | "new_variant"
  | "new_colour"
  | "exact_refill_conflict"
  | "new_variant_conflict"
  | "new_colour_conflict";

export interface ReconciliationLine {
  invoice_sku: string | null;
  invoice_product_name: string | null;
  invoice_colour: string | null;
  invoice_size: string | null;
  invoice_qty: number;
  invoice_cost: number | null;
  invoice_rrp: number | null;
  match_type: MatchType;
  matched_product_id: string | null;
  matched_variant_id: string | null;
  matched_current_qty: number | null;
  matched_current_cost: number | null;
  cost_delta_pct: number | null;
  conflict_reason: string | null;
  confidence: number;
  match_signal: "sku" | "barcode" | "fuzzy_sku" | "name" | "none";
  fuzzy_match: boolean;
  name_match: boolean;
  notes: string[];
}

const DEFAULTS = {
  skuMatchWeight: 0.9,
  nameMatchWeight: 0.7,
  fuzzyThreshold: 0.8,
  priceDeltaThreshold: 0.1,
};

// ── COLOUR SYNONYMS ──
const COLOUR_SYNONYMS: Record<string, string> = {
  "navy blue": "navy",
  "jet black": "black",
  onyx: "black",
};
const NEAR_WHITE = new Set(["white", "ivory", "cream", "off-white", "off white"]);

const STOPWORDS = new Set(["the", "a", "an", "by", "with", "for", "of", "and", "in"]);

// ── PUBLIC: matchInvoiceLines ──
export function matchInvoiceLines(
  invoiceLines: InvoiceLine[],
  catalog: ProductCatalogItem[],
  options: MatchOptions,
): ReconciliationLine[] {
  const opts = { ...DEFAULTS, ...options };
  return invoiceLines.map((line) => matchOne(line, catalog, opts));
}

function matchOne(
  line: InvoiceLine,
  catalog: ProductCatalogItem[],
  opts: Required<Omit<MatchOptions, "platform">> & MatchOptions,
): ReconciliationLine {
  const base: ReconciliationLine = {
    invoice_sku: line.sku ?? null,
    invoice_product_name: line.product_name ?? null,
    invoice_colour: line.colour ?? null,
    invoice_size: line.size ?? null,
    invoice_qty: line.qty,
    invoice_cost: line.cost ?? null,
    invoice_rrp: line.rrp ?? null,
    match_type: "new",
    matched_product_id: null,
    matched_variant_id: null,
    matched_current_qty: null,
    matched_current_cost: null,
    cost_delta_pct: null,
    conflict_reason: null,
    confidence: 0,
    match_signal: "none",
    fuzzy_match: false,
    name_match: false,
    notes: [],
  };

  const invSku = (line.sku ?? "").trim().toLowerCase();
  let matched: ProductCatalogItem | null = null;
  let signal: ReconciliationLine["match_signal"] = "none";
  let confidence = 0;

  // LEVEL 1 — Exact SKU
  if (invSku) {
    matched = catalog.find((c) => (c.sku ?? "").trim().toLowerCase() === invSku) ?? null;
    if (matched) {
      signal = "sku";
      confidence = 1.0;
    }
  }

  // LEVEL 2 — Barcode
  if (!matched && invSku) {
    matched = catalog.find((c) => (c.barcode ?? "").trim().toLowerCase() === invSku) ?? null;
    if (matched) {
      signal = "barcode";
      confidence = 0.98;
    }
  }
  if (!matched && line.barcode) {
    const bc = line.barcode.trim().toLowerCase();
    matched = catalog.find((c) => (c.barcode ?? "").trim().toLowerCase() === bc) ?? null;
    if (matched) {
      signal = "barcode";
      confidence = 0.98;
    }
  }

  // LEVEL 3 — Fuzzy SKU
  if (!matched && invSku) {
    let best: { item: ProductCatalogItem; score: number } | null = null;
    for (const c of catalog) {
      const s = (c.sku ?? "").trim().toLowerCase();
      if (!s) continue;
      const score = fuzzyMatch(invSku, s);
      if (score > opts.fuzzyThreshold && (!best || score > best.score)) {
        best = { item: c, score };
      }
    }
    if (best) {
      matched = best.item;
      signal = "fuzzy_sku";
      confidence = 0.85;
      base.fuzzy_match = true;
      base.notes.push(`Fuzzy SKU match (${Math.round(best.score * 100)}%)`);
    }
  }

  // LEVEL 4 — Name + brand
  if (!matched && line.product_name) {
    const invName = normaliseName(line.product_name);
    const invBrand = (line.brand ?? "").trim().toLowerCase();
    let best: { item: ProductCatalogItem; score: number } | null = null;
    for (const c of catalog) {
      const cName = normaliseName(c.product_title ?? "");
      if (!cName) continue;
      const score = jaroWinkler(invName, cName);
      if (score < 0.85) continue;
      if (invBrand) {
        const cVendor = (c.vendor ?? "").trim().toLowerCase();
        if (cVendor && cVendor !== invBrand) continue;
      }
      if (!best || score > best.score) best = { item: c, score };
    }
    if (best) {
      matched = best.item;
      signal = "name";
      confidence = 0.75;
      base.name_match = true;
      base.notes.push(`Name match (${Math.round(best.score * 100)}%)`);
    }
  }

  base.match_signal = signal;
  base.confidence = confidence;

  // LEVEL 5 — No match
  if (!matched) {
    base.match_type = "new";
    return base;
  }

  // ── VARIANT CHECK ──
  base.matched_product_id = matched.platform_product_id;

  // Find all variants belonging to this matched product
  const productVariants = catalog.filter(
    (c) => c.platform_product_id === matched!.platform_product_id,
  );

  const invColour = line.colour ?? "";
  const invSize = line.size ?? "";

  const exact = productVariants.find(
    (v) =>
      coloursEqual(v.colour ?? "", invColour) && sizesEqual(v.size ?? "", invSize),
  );

  let baseType: "exact_refill" | "new_variant" | "new_colour" = "new_variant";

  if (exact) {
    baseType = "exact_refill";
    base.matched_variant_id = exact.platform_variant_id ?? null;
    base.matched_current_qty = exact.current_qty ?? null;
    base.matched_current_cost = exact.current_cost ?? null;
  } else {
    const colourExists = productVariants.some((v) => coloursEqual(v.colour ?? "", invColour));
    const sizeExistsForColour = productVariants.some(
      (v) => coloursEqual(v.colour ?? "", invColour) && sizesEqual(v.size ?? "", invSize),
    );

    if (colourExists && !sizeExistsForColour) {
      baseType = "new_variant";
      base.notes.push(`Size "${invSize}" not in system for this product`);
    } else if (!colourExists) {
      // Check if size already exists under any colour
      const sizeAnywhere = productVariants.some((v) => sizesEqual(v.size ?? "", invSize));
      if (!sizeAnywhere && invSize) {
        baseType = "new_variant";
        base.notes.push(`New "${invColour}" / "${invSize}" combination`);
      } else {
        baseType = "new_colour";
        base.notes.push(`Colour "${invColour}" not in system for this product`);
      }
    }

    // Use product-level info for cost delta where available
    const sameColour = productVariants.find((v) => coloursEqual(v.colour ?? "", invColour));
    const reference = sameColour ?? productVariants[0] ?? matched;
    base.matched_current_qty = reference.current_qty ?? null;
    base.matched_current_cost = reference.current_cost ?? null;
  }

  // Fuzzy colour flag (only if not exact match)
  if (invColour && !exact) {
    for (const v of productVariants) {
      const cv = v.colour ?? "";
      if (!cv) continue;
      const dist = levenshtein(normaliseColour(invColour), normaliseColour(cv));
      if (dist > 0 && dist <= 2) {
        base.notes.push(`Colour "${invColour}" similar to existing "${cv}" — review`);
        break;
      }
    }
  }

  // ── PRICE DELTA CHECK ──
  if (
    line.cost != null &&
    base.matched_current_cost != null &&
    base.matched_current_cost > 0
  ) {
    const delta = (line.cost - base.matched_current_cost) / base.matched_current_cost;
    base.cost_delta_pct = delta;
    if (Math.abs(delta) > opts.priceDeltaThreshold) {
      const sign = delta > 0 ? "+" : "";
      base.conflict_reason = `Cost changed from $${base.matched_current_cost.toFixed(2)} to $${line.cost.toFixed(2)} (${sign}${(delta * 100).toFixed(1)}%)`;
      base.match_type = `${baseType}_conflict` as MatchType;
      return base;
    }
  }

  base.match_type = baseType;
  return base;
}

// ── HELPER: normalise name ──
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ")
    .trim();
}

// ── HELPER: normaliseSize ──
export function normaliseSize(size: string): string {
  if (!size) return "";
  let s = size.trim().toLowerCase();
  s = s.replace(/^au\s*/i, "").replace(/^size\s+/i, "").replace(/^sz\s*/i, "");
  s = s.trim();
  // Letter sizes
  const letterMatch = s.match(/^(xxs|xs|s|m|l|xl|xxl|xxxl)$/i);
  if (letterMatch) return letterMatch[1].toUpperCase();
  // Numeric (handle .0 → integer, keep half sizes distinct)
  const num = parseFloat(s);
  if (!isNaN(num) && /^[\d.]+$/.test(s)) {
    return Number.isInteger(num) ? String(num) : String(num);
  }
  return s.toUpperCase();
}

// ── HELPER: normaliseColour ──
export function normaliseColour(colour: string): string {
  if (!colour) return "";
  let c = colour.trim().toLowerCase();
  if (COLOUR_SYNONYMS[c]) c = COLOUR_SYNONYMS[c];
  return c;
}

function coloursEqual(a: string, b: string): boolean {
  const na = normaliseColour(a);
  const nb = normaliseColour(b);
  if (!na && !nb) return true;
  if (na === nb) return true;
  // Near-white group: similar but kept distinct — only equal when exact normalised match
  return false;
}

function sizesEqual(a: string, b: string): boolean {
  const na = normaliseSize(a);
  const nb = normaliseSize(b);
  if (!na && !nb) return true;
  return na === nb;
}

// ── HELPER: fuzzyMatch (0–1, based on levenshtein) ──
export function fuzzyMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

// ── HELPER: levenshtein ──
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// ── HELPER: jaroWinkler ──
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  // Winkler prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}
