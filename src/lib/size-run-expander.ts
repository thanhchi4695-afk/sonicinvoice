// ══════════════════════════════════════════════════════════
// Size-Run Expander
//
// Wholesale invoices often print one row per style with a size
// grid (e.g. "8-16" or "S-L" or "8/10/12/14/16"). Both Shopify
// and Lightspeed need ONE variant row per (style × colour × size)
// with its own SKU, barcode, and quantity.
//
// This module expands a single "range" size value into the list
// of individual sizes it represents, splitting any aggregated
// quantity evenly across the run.
// ══════════════════════════════════════════════════════════

const NUMERIC_AU_LADDER = ["4", "6", "8", "10", "12", "14", "16", "18", "20", "22", "24"];
const NUMERIC_US_LADDER = ["0", "2", "4", "6", "8", "10", "12", "14", "16", "18"];
const ALPHA_LADDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const ALPHA_LADDER_SHORT = ["XS", "S", "M", "L", "XL"];

function pickLadder(start: string, end: string): string[] | null {
  const u = (s: string) => s.toUpperCase().trim();
  const su = u(start);
  const eu = u(end);
  // Numeric ladder
  if (/^\d+$/.test(su) && /^\d+$/.test(eu)) {
    const sNum = parseInt(su, 10);
    const eNum = parseInt(eu, 10);
    if (eNum < sNum) return null;
    // Use AU ladder if values are ≥4, else US
    const ladder = NUMERIC_AU_LADDER.includes(su) ? NUMERIC_AU_LADDER : NUMERIC_US_LADDER;
    const sIdx = ladder.indexOf(su);
    const eIdx = ladder.indexOf(eu);
    if (sIdx === -1 || eIdx === -1) {
      // Fall back to dense numeric range stepping by 2 (AU women's standard)
      const out: string[] = [];
      for (let n = sNum; n <= eNum; n += 2) out.push(String(n));
      return out;
    }
    return ladder.slice(sIdx, eIdx + 1);
  }
  // Alpha ladder
  for (const ladder of [ALPHA_LADDER, ALPHA_LADDER_SHORT]) {
    const sIdx = ladder.indexOf(su);
    const eIdx = ladder.indexOf(eu);
    if (sIdx !== -1 && eIdx !== -1 && eIdx >= sIdx) {
      return ladder.slice(sIdx, eIdx + 1);
    }
  }
  return null;
}

/**
 * Expand a size value into one-or-more discrete sizes.
 * Examples:
 *   "8-16"        -> ["8","10","12","14","16"]
 *   "S-L"         -> ["S","M","L"]
 *   "8/10/12"     -> ["8","10","12"]
 *   "8,10,12"     -> ["8","10","12"]
 *   "10"          -> ["10"]
 *   "One Size"    -> ["One Size"]
 *   ""            -> [""]   (caller decides whether to skip)
 */
export function expandSizeValue(raw: string): string[] {
  const value = (raw || "").trim();
  if (!value) return [""];

  // Explicit list separators take precedence over range
  if (/[\/,;|]/.test(value)) {
    return value.split(/[\/,;|]/).map(s => s.trim()).filter(Boolean);
  }

  // Range with hyphen / en-dash / em-dash — but only if it looks like a size range,
  // not a composite SKU like "8-RED-2026". Require both sides to be short tokens
  // (≤4 chars) AND alphanumeric.
  const rangeMatch = value.match(/^([A-Z0-9]{1,4})\s*[-–—]\s*([A-Z0-9]{1,4})$/i);
  if (rangeMatch) {
    const ladder = pickLadder(rangeMatch[1], rangeMatch[2]);
    if (ladder && ladder.length >= 2) return ladder;
  }

  // Single value — return as-is
  return [value];
}

/**
 * Detect whether a size value represents a multi-size run.
 */
export function isSizeRun(raw: string): boolean {
  return expandSizeValue(raw).length > 1;
}

/**
 * Expand a generic line item that has a size range into N child lines —
 * one per individual size — splitting the quantity evenly across the run.
 *
 * Behaviour:
 *  - Quantity is divided by the number of sizes (rounded down). Remainder
 *    is added to the first size so totals stay correct.
 *  - SKU is suffixed with "-<size>" so each variant is unique.
 *  - Barcode is preserved on every row IF the original barcode looked like
 *    a single GTIN (12-14 digits). Otherwise barcode is cleared on the
 *    children — most wholesale invoices issue one barcode per size, so a
 *    shared GTIN would create duplicate-barcode errors on import.
 */
export function expandLineBySize<T extends {
  sku?: string;
  barcode?: string;
  size?: string;
  qty?: number;
  quantity?: number;
}>(line: T): T[] {
  const sizes = expandSizeValue(line.size || "");
  if (sizes.length <= 1) return [line];

  const totalQty = (line.qty ?? line.quantity ?? 0) | 0;
  const perSize = Math.floor(totalQty / sizes.length);
  const remainder = totalQty - perSize * sizes.length;

  const looksLikeSingleGtin = !!line.barcode && /^\d{12,14}$/.test(line.barcode);

  return sizes.map((size, idx) => {
    const qty = perSize + (idx === 0 ? remainder : 0);
    const out: T = {
      ...line,
      size,
      sku: line.sku ? `${line.sku}-${size}`.replace(/\s+/g, "") : line.sku,
      barcode: looksLikeSingleGtin ? "" : line.barcode,
    };
    if ("qty" in line) (out as { qty?: number }).qty = qty;
    if ("quantity" in line) (out as { quantity?: number }).quantity = qty;
    return out;
  });
}
