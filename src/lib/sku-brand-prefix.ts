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
  /** Canonical brand name to inject as the line's vendor. */
  brand: string;
}

const RULES: PrefixRule[] = [
  { prefix: "JA", brand: "Jantzen" },
  { prefix: "SS", brand: "Sunseeker" },
  { prefix: "OB", brand: "Olga Berg" },
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
    if (cleaned.startsWith(rule.prefix)) return rule.brand;
  }
  return null;
}
