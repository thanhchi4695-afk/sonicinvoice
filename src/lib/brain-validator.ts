// ─────────────────────────────────────────────────────────────
// Stage 5 — VALIDATION PASS  (client-side, deterministic)
// Runs on the Stage 3+4 product output and produces an array of
// human-readable flag reasons per product. The Review screen
// renders these as amber badges.
// ─────────────────────────────────────────────────────────────

export type BrainFlagSeverity = "info" | "warn" | "error";

export interface BrainFlag {
  /** stable code, e.g. "low_margin", "missing_rrp" */
  code: string;
  /** human-readable amber-badge message */
  message: string;
  severity: BrainFlagSeverity;
}

export interface BrainVariant {
  size: string;
  quantity: number;
  sku?: string;
  barcode?: string;
}

export interface BrainProduct {
  product_name: string;
  style_code: string;
  colour: string;
  barcode?: string;
  description?: string;
  cost_ex_gst: number;
  cost_inc_gst: number;
  rrp_ex_gst: number;
  rrp_inc_gst: number;
  variants: BrainVariant[];
  source_rows?: number[];
  /** populated by validateBrainProducts */
  _flags?: BrainFlag[];
  /** flags the user has dismissed in the Review screen */
  _dismissed?: string[];
}

export interface BrainValidationSummary {
  total: number;
  flagged: number;
  byCode: Record<string, number>;
}

/**
 * Run the four CHECK passes from the Brain Mode spec.
 * Mutates each product's `_flags`. Returns a summary for the banner.
 */
export function validateBrainProducts(products: BrainProduct[]): BrainValidationSummary {
  const summary: BrainValidationSummary = { total: products.length, flagged: 0, byCode: {} };

  // CHECK 3 prep — count style_code occurrences for duplicate detection.
  const styleCounts = new Map<string, number>();
  for (const p of products) {
    const key = (p.style_code || "").trim().toLowerCase();
    if (key) styleCounts.set(key, (styleCounts.get(key) || 0) + 1);
  }

  for (const p of products) {
    const flags: BrainFlag[] = [];

    // CHECK 1 — Margin sanity
    const cost = Number(p.cost_ex_gst) || 0;
    const rrp = Number(p.rrp_inc_gst) || 0;
    if (cost > 0 && rrp > 0) {
      const margin = (rrp - cost * 1.1) / rrp;
      if (margin < 0.10) {
        flags.push({ code: "cost_exceeds_rrp", severity: "error",
          message: `Cost (${cost.toFixed(2)}) is close to or above RRP (${rrp.toFixed(2)}) — verify` });
      } else if (margin < 0.30) {
        flags.push({ code: "low_margin", severity: "warn",
          message: `Low margin (${(margin * 100).toFixed(0)}%) — verify cost or RRP` });
      } else if (margin > 0.90) {
        flags.push({ code: "high_margin", severity: "warn",
          message: `Margin unusually high (${(margin * 100).toFixed(0)}%) — verify cost` });
      }
    }

    // CHECK 2 — Required fields
    if (!p.product_name?.trim()) {
      flags.push({ code: "missing_name", severity: "error", message: "Missing product name" });
    }
    if (!rrp) {
      flags.push({ code: "missing_rrp", severity: "warn", message: "Missing RRP" });
    }
    if (!cost) {
      flags.push({ code: "missing_cost", severity: "warn", message: "Missing cost" });
    }
    const totalQty = (p.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
    if (!p.variants?.length || totalQty === 0) {
      flags.push({ code: "zero_qty", severity: "warn", message: "All variants have zero quantity" });
    }

    // CHECK 3 — Duplicate detection
    const styleKey = (p.style_code || "").trim().toLowerCase();
    if (styleKey && (styleCounts.get(styleKey) || 0) > 1) {
      flags.push({ code: "duplicate_style", severity: "warn",
        message: "Possible duplicate — another product shares this style code" });
    }

    // CHECK 4 — Quantity sanity
    if ((p.variants || []).some(v => !Number.isInteger(Number(v.quantity)))) {
      flags.push({ code: "fractional_qty", severity: "warn", message: "Fractional quantity detected" });
    }
    if (totalQty > 500) {
      flags.push({ code: "large_order", severity: "info",
        message: `Unusually large order (${totalQty} units) — confirm` });
    }

    if (flags.length) summary.flagged += 1;
    for (const f of flags) summary.byCode[f.code] = (summary.byCode[f.code] || 0) + 1;

    p._flags = flags;
    p._dismissed = p._dismissed || [];
  }

  return summary;
}

/** Visible flags = flags that haven't been dismissed by the user. */
export function visibleFlags(p: BrainProduct): BrainFlag[] {
  if (!p._flags?.length) return [];
  const dismissed = new Set(p._dismissed || []);
  return p._flags.filter(f => !dismissed.has(f.code));
}
