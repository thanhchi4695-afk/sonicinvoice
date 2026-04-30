/**
 * GTIN Fallback Helper
 *
 * Resolves a usable Google Shopping identifier for a product when the
 * `barcode` field is missing or invalid. Implements the documented Google
 * Merchant Center fallback ladder for apparel / strong-identifier categories.
 *
 * Resolution ladder:
 *   STEP 1 — Valid barcode (GTIN-12 or GTIN-13, Luhn check passes) → use it.
 *   STEP 2 — No barcode but product has a brand/vendor → use Shopify product
 *            ID as MPN and emit a brand+MPN identifier.
 *   STEP 3 — No brand and product is custom/handmade → set
 *            `identifier_exists = false` and generate `custom_<productId>`.
 *   STEP 4 — Otherwise → throw, the caller must register a brand or
 *            obtain a real GTIN.
 *
 * Reference: https://support.google.com/merchants/answer/6324461 (GTIN),
 * https://support.google.com/merchants/answer/6324478 (identifier_exists).
 */

// ───────────────────────────── Types ─────────────────────────────

export interface ProductIdentifierInput {
  /** Shopify numeric or GID product id. */
  productId: string;
  /** Raw barcode/GTIN value from Shopify variant (may be null/empty). */
  barcode?: string | null;
  /** Vendor / brand name from Shopify product. */
  brand?: string | null;
  /** Optional manufacturer part number, if known. */
  mpn?: string | null;
  /** Marks the product as handmade / custom (no brand). */
  isCustom?: boolean;
  /** Google product category — used to detect strong-identifier categories. */
  googleProductCategory?: string | null;
}

export type GtinResolutionStep =
  | "valid_barcode"
  | "brand_mpn"
  | "custom_no_identifier"
  | "error";

export interface GtinResolution {
  step: GtinResolutionStep;
  /** GTIN value to send (real, custom_*, or null when identifier_exists=false). */
  gtin: string | null;
  /** Brand to send to GMC, when applicable. */
  brand: string | null;
  /** MPN to send to GMC, when applicable. */
  mpn: string | null;
  /** Whether to emit `identifier_exists = false` at the feed item level. */
  identifierExists: boolean;
  /** Human-readable explanation for logs / UI. */
  reason: string;
}

// ───────────────────────── GTIN validation ─────────────────────────

/**
 * Validates a GTIN using the Mod-10 (a.k.a. GS1 / "Luhn-like") check digit
 * algorithm. Supports GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) and GTIN-14.
 * The task spec only requires 12/13, but accepting all standard lengths
 * prevents false negatives for stores that already store EAN-8 or ITF-14
 * barcodes.
 */
export function validateGTIN(code: string): boolean {
  if (typeof code !== "string") return false;
  const digits = code.trim();
  if (!/^\d+$/.test(digits)) return false;
  if (![8, 12, 13, 14].includes(digits.length)) return false;

  // The check digit is the last digit. Working right-to-left over the
  // remaining digits, every second digit is multiplied by 3.
  const checkDigit = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = digits.length - 2, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) {
    sum += Number(digits[i]) * mult;
  }
  const computed = (10 - (sum % 10)) % 10;
  return computed === checkDigit;
}

// ─────────────────────── Helpers ───────────────────────

/** Categories where Google enforces strong identifiers (brand+MPN or GTIN). */
const STRONG_IDENTIFIER_CATEGORY_KEYWORDS = [
  "apparel",
  "clothing",
  "shoes",
  "footwear",
  "handbag",
  "watches",
  "jewelry",
  "jewellery",
];

export function isStrongIdentifierCategory(
  googleProductCategory: string | null | undefined,
): boolean {
  if (!googleProductCategory) return false;
  const lowered = googleProductCategory.toLowerCase();
  return STRONG_IDENTIFIER_CATEGORY_KEYWORDS.some((kw) => lowered.includes(kw));
}

/** Strip Shopify GID prefix if present, returning just the numeric id. */
function numericProductId(productId: string): string {
  if (!productId) return "";
  const idx = productId.lastIndexOf("/");
  return idx >= 0 ? productId.slice(idx + 1) : productId;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

// ─────────────────────── Main resolver ───────────────────────

export class MissingGtinError extends Error {
  constructor(message: string, public productId: string) {
    super(message);
    this.name = "MissingGtinError";
  }
}

/**
 * Resolve the identifier set to send to Google Shopping for a product.
 * Throws `MissingGtinError` when no acceptable fallback can be produced.
 */
export function resolveProductIdentifier(
  input: ProductIdentifierInput,
): GtinResolution {
  const barcode = nonEmpty(input.barcode);
  const brand = nonEmpty(input.brand);
  const mpn = nonEmpty(input.mpn);
  const productNumeric = numericProductId(input.productId);

  // STEP 1 — Valid barcode wins outright.
  if (barcode && validateGTIN(barcode)) {
    return {
      step: "valid_barcode",
      gtin: barcode,
      brand,
      mpn,
      identifierExists: true,
      reason: "Using validated GTIN from product barcode",
    };
  }

  // STEP 2 — No valid GTIN, but we have a brand → use product id as MPN.
  if (brand) {
    return {
      step: "brand_mpn",
      gtin: null,
      brand,
      mpn: mpn ?? productNumeric,
      identifierExists: true,
      reason: barcode
        ? "Barcode failed GTIN check; falling back to brand + Shopify product id as MPN"
        : "No barcode; using brand + Shopify product id as MPN",
    };
  }

  // STEP 3 — Custom / handmade with no brand → identifier_exists = false.
  if (input.isCustom) {
    return {
      step: "custom_no_identifier",
      gtin: `custom_${productNumeric}`,
      brand: null,
      mpn: null,
      identifierExists: false,
      reason: "Custom/handmade product without brand — identifier_exists set to false",
    };
  }

  // STEP 4 — No path forward.
  throw new MissingGtinError(
    "Missing GTIN – Amazon-style GTIN generator not available unless brand registered",
    input.productId,
  );
}

/**
 * Convenience wrapper that never throws. Returns the resolution or an error
 * payload — useful in batch enrichment loops where one failing product
 * should not abort the whole feed build.
 */
export function tryResolveProductIdentifier(
  input: ProductIdentifierInput,
):
  | { ok: true; resolution: GtinResolution }
  | { ok: false; error: string; step: "error" } {
  try {
    return { ok: true, resolution: resolveProductIdentifier(input) };
  } catch (e) {
    return {
      ok: false,
      step: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
