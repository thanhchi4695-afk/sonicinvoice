// ══════════════════════════════════════════════════════════════
// SKU-prefix → brand mapping
//
// Some umbrella vendors (e.g. Skye Group invoices billed for both
// Jantzen and Sunseeker) ship multi-brand invoices where the cover
// page vendor is meaningless for per-line price/website lookups.
// This module brand-detects each line by its SKU prefix so the
// downstream registry / website lookup uses the correct brand.
//
// Mappings are intentionally small and hand-curated. Add a new
// entry here whenever a real-world invoice surfaces the issue.
// ══════════════════════════════════════════════════════════════

interface PrefixRule {
  /** Uppercase prefix to match at the start of the SKU (after trimming non-alphanumerics). */
  prefix: string;
  /** Optional uppercase suffix to require somewhere AFTER the prefix in the SKU.
   *  Lets us disambiguate co-prefixed brands (e.g. AT…ND vs AT…GA from Bond-Eye). */
  contains?: string;
  /** Canonical brand name to inject as the line's vendor. */
  brand: string;
}

// Order matters: rules with a `contains` constraint must be evaluated
// before the bare-prefix fallbacks for the same prefix.
const RULES: PrefixRule[] = [
  // Skye Group — Jantzen + Sunseeker
  { prefix: "JA", brand: "Jantzen" },
  { prefix: "SS", brand: "Sunseeker" },
  // Olga Berg
  { prefix: "OB", brand: "Olga Berg" },
  // Bond-Eye Australia umbrella → Sea Level / Bond Eye Aria / Artesands / Bond Eye
  { prefix: "SL", brand: "Sea Level" },
  { prefix: "AT", contains: "ND", brand: "Artesands" },
  { prefix: "AT", contains: "GA", brand: "Bond Eye Aria" },
  { prefix: "BOUND", brand: "Bond Eye" },
  // Sunshades Eyewear umbrella
  { prefix: "LSP", brand: "Le Specs" },
  // Roadtrip Essential umbrella → Smelly Balls + Chern'ee Sutton collab
  { prefix: "CSSB", brand: "Chern'ee Sutton" },
  { prefix: "SBS", brand: "Smelly Balls" },
  { prefix: "SBO", brand: "Smelly Balls" },
  { prefix: "MOSP", brand: "Smelly Balls" },
  // Ambra Corporation umbrella
  { prefix: "LLSW", brand: "Love Luna" },
  { prefix: "AMUW", brand: "Ambra" },
];

/**
 * Returns the canonical brand name if the SKU prefix matches a known
 * mapping, or `null` if no rule applies (callers should keep the
 * cover-page vendor in that case).
 */
export function detectBrandFromSku(sku?: string | null): string | null {
  if (!sku) return null;
  const cleaned = String(sku).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 3) return null;
  for (const rule of RULES) {
    if (!cleaned.startsWith(rule.prefix)) continue;
    if (rule.contains && !cleaned.slice(rule.prefix.length).includes(rule.contains)) continue;
    return rule.brand;
  }
  return null;
}
