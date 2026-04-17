// ══════════════════════════════════════════════════════════════
// Supplier Inference — the "human brain" waterfall.
// Given an invoice's headers + sample rows, work out the most
// likely column mapping by checking learned profiles first, then
// falling back to common-sense rules and Australian retail defaults.
// ══════════════════════════════════════════════════════════════

export interface SupplierProfile {
  id: string;
  supplier_name: string;
  supplier_name_variants?: string[] | null;
  confidence_score?: number | null;
  invoice_count?: number | null;
  currency?: string | null;
  country?: string | null;
  profile_data?: Record<string, unknown> | null;
  invoice_patterns?: InvoicePatternLite[];
}

export interface InvoicePatternLite {
  id?: string;
  format_type?: string | null;
  column_map?: Record<string, string> | null;
  size_system?: string | null;
  price_column_cost?: string | null;
  price_column_rrp?: string | null;
  gst_included_in_cost?: boolean | null;
  gst_included_in_rrp?: boolean | null;
  default_markup_multiplier?: number | null;
  pack_notation_detected?: boolean | null;
  size_matrix_detected?: boolean | null;
  sample_headers?: string[] | null;
}

export type RulesSource =
  | "exact_match"
  | "fuzzy_match"
  | "header_match"
  | "shared_pattern_match"
  | "header_inference"
  | "defaults";

export interface SharedPatternLite {
  format_type?: string | null;
  header_fingerprint?: string | null;
  column_roles?: Record<string, number> | null;
  size_system?: string | null;
  gst_included_in_cost?: boolean | null;
  gst_included_in_rrp?: boolean | null;
  markup_avg?: number | null;
  pack_notation_detected?: boolean | null;
  size_matrix_detected?: boolean | null;
  contributor_count?: number | null;
  avg_confidence?: number | null;
}

export interface InferredRules {
  column_map: Record<string, string>;
  size_system: "AU" | "US" | "EU" | "UK" | "own" | "unknown";
  price_column_cost: string | null;
  price_column_rrp: string | null;
  gst_included_in_cost: boolean;
  gst_included_in_rrp: boolean;
  default_markup_multiplier: number;
  pack_notation_detected: boolean;
  size_matrix_detected: boolean;
  currency: string;
  currency_warning?: string;
  confidence: number; // 0-100
  rules_source: RulesSource;
  matched_supplier_id?: string;
  matched_supplier_name?: string;
  flags: string[];
  notes: string[];
}

// ───────────────────────── helpers ─────────────────────────

const norm = (s: string | null | undefined) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function headerFingerprint(headers: string[]): string {
  return [...headers].map(norm).filter(Boolean).sort().join("|");
}

function patternToRules(
  pattern: InvoicePatternLite,
  source: RulesSource,
  confidence: number,
  profile?: SupplierProfile,
  flags: string[] = [],
): InferredRules {
  return {
    column_map: pattern.column_map || {},
    size_system: (pattern.size_system as InferredRules["size_system"]) || "AU",
    price_column_cost: pattern.price_column_cost ?? null,
    price_column_rrp: pattern.price_column_rrp ?? null,
    gst_included_in_cost: pattern.gst_included_in_cost ?? false,
    gst_included_in_rrp: pattern.gst_included_in_rrp ?? true,
    default_markup_multiplier: pattern.default_markup_multiplier ?? 2.2,
    pack_notation_detected: pattern.pack_notation_detected ?? false,
    size_matrix_detected: pattern.size_matrix_detected ?? false,
    currency: profile?.currency || "AUD",
    confidence,
    rules_source: source,
    matched_supplier_id: profile?.id,
    matched_supplier_name: profile?.supplier_name,
    flags,
    notes: [],
  };
}

// ───────────────────────── steps ─────────────────────────

function step1_exactMatch(
  supplierName: string | undefined,
  profiles: SupplierProfile[],
): InferredRules | null {
  if (!supplierName) return null;
  const target = norm(supplierName);
  for (const p of profiles) {
    if (norm(p.supplier_name) === target && (p.confidence_score ?? 0) >= 70) {
      const pat = p.invoice_patterns?.[0];
      if (pat) {
        return patternToRules(pat, "exact_match", p.confidence_score!, p);
      }
    }
  }
  return null;
}

function step2_fuzzyMatch(
  supplierName: string | undefined,
  profiles: SupplierProfile[],
): InferredRules | null {
  if (!supplierName) return null;
  const target = norm(supplierName);
  for (const p of profiles) {
    const candidates = [p.supplier_name, ...(p.supplier_name_variants || [])];
    for (const c of candidates) {
      const n = norm(c);
      if (!n) continue;
      if (levenshtein(n, target) < 3) {
        const pat = p.invoice_patterns?.[0];
        if (pat) {
          return patternToRules(
            pat,
            "fuzzy_match",
            Math.max(40, (p.confidence_score ?? 50) - 10),
            p,
            ["fuzzy_match"],
          );
        }
      }
    }
  }
  return null;
}

function step3_headerFingerprint(
  headers: string[],
  profiles: SupplierProfile[],
): InferredRules | null {
  const fp = headerFingerprint(headers);
  if (!fp) return null;
  for (const p of profiles) {
    for (const pat of p.invoice_patterns || []) {
      if (!pat.sample_headers?.length) continue;
      if (headerFingerprint(pat.sample_headers) === fp) {
        return patternToRules(
          pat,
          "header_match",
          Math.max(50, (p.confidence_score ?? 60) - 5),
          p,
          ["header_match"],
        );
      }
    }
  }
  return null;
}

function step4_headerInference(
  headers: string[],
  sampleRows: Record<string, unknown>[],
): InferredRules {
  const flags: string[] = [];
  const notes: string[] = [];
  const columnMap: Record<string, string> = {};

  let costCol: string | null = null;
  let rrpCol: string | null = null;
  let skuCol: string | null = null;
  let colourCol: string | null = null;
  let nameCol: string | null = null;

  // Numeric-only headers (size matrix)
  const numericHeaders = headers.filter((h) => /^\d{1,3}$/.test(h.trim()));
  const sizeMatrix = numericHeaders.length >= 3;

  // Pack notation: "1x8", "2x10" etc anywhere in headers
  const packNotation = headers.some((h) => /\b\d+\s*[x×]\s*\d+\b/i.test(h));

  for (const h of headers) {
    const n = h.toLowerCase().trim();
    if (!n) continue;

    if (!costCol && /(wholesale|wsp|buy\s*price|cost\s*price|unit\s*cost|cost(?!ume)|ex\s*gst)/i.test(n)) {
      costCol = h;
      columnMap[h] = "cost";
      continue;
    }
    if (!rrpCol && /(rrp|retail|sell\s*price|recommended)/i.test(n)) {
      rrpCol = h;
      columnMap[h] = "rrp";
      continue;
    }
    if (!skuCol && /(style\s*(no|num|#)?|sku|item\s*code|product\s*code|^code$|^ref$|reference)/i.test(n)) {
      skuCol = h;
      columnMap[h] = "sku";
      continue;
    }
    if (!colourCol && /(colour|color|^col$|colourway|shade)/i.test(n)) {
      colourCol = h;
      columnMap[h] = "colour";
      continue;
    }
    if (!nameCol && /(desc|description|name|product|style\s*name|item)/i.test(n)) {
      nameCol = h;
      columnMap[h] = "product_name";
      continue;
    }
    if (/^(qty|quantity|units?)$/i.test(n)) columnMap[h] = "quantity";
    else if (/^(size|sz)$/i.test(n)) columnMap[h] = "size";
    else if (/^(barcode|ean|gtin|upc)$/i.test(n)) columnMap[h] = "barcode";
  }

  if (sizeMatrix) flags.push("size_matrix_detected");
  if (packNotation) flags.push("pack_notation_detected");

  // Currency / value sanity check from sample rows
  let currency = "AUD";
  let currencyWarning: string | undefined;
  if (costCol && sampleRows.length) {
    const numericCosts: number[] = [];
    let sawDollar = false;
    for (const row of sampleRows) {
      const raw = row?.[costCol as keyof typeof row];
      if (raw == null) continue;
      const str = String(raw);
      if (str.includes("$")) sawDollar = true;
      const num = parseFloat(str.replace(/[^0-9.\-]/g, ""));
      if (!isNaN(num)) numericCosts.push(num);
    }
    if (numericCosts.length) {
      const avg = numericCosts.reduce((a, b) => a + b, 0) / numericCosts.length;
      const noDecimals = numericCosts.every((n) => Number.isInteger(n));
      if (avg > 500 && noDecimals) {
        flags.push("non_aud_currency_suspected");
        currencyWarning = `Costs look unusually high (avg ${avg.toFixed(0)}) and have no decimals — likely JPY or USD. Confirm currency.`;
        notes.push(currencyWarning);
        currency = "UNKNOWN";
      } else if (sawDollar) {
        notes.push("Dollar symbol detected — assuming AUD (Australian default).");
      }
    }
  }

  // Confidence scoring
  let confidence = 30;
  if (costCol) confidence += 15;
  if (rrpCol) confidence += 10;
  if (skuCol) confidence += 10;
  if (nameCol) confidence += 10;
  if (colourCol) confidence += 5;
  if (sizeMatrix || packNotation) confidence += 5;
  confidence = Math.min(85, confidence);

  return {
    column_map: columnMap,
    size_system: "AU",
    price_column_cost: costCol,
    price_column_rrp: rrpCol,
    gst_included_in_cost: false,
    gst_included_in_rrp: true,
    default_markup_multiplier: 2.2,
    pack_notation_detected: packNotation,
    size_matrix_detected: sizeMatrix,
    currency,
    currency_warning: currencyWarning,
    confidence,
    rules_source: "header_inference",
    flags,
    notes,
  };
}

function step5_defaults(category: "fashion" | "accessories" | "basics" = "fashion"): InferredRules {
  const markup = category === "accessories" ? 2.5 : category === "basics" ? 2.0 : 2.2;
  return {
    column_map: {},
    size_system: "AU",
    price_column_cost: null,
    price_column_rrp: null,
    gst_included_in_cost: false,
    gst_included_in_rrp: true,
    default_markup_multiplier: markup,
    pack_notation_detected: false,
    size_matrix_detected: false,
    currency: "AUD",
    confidence: 20,
    rules_source: "defaults",
    flags: ["using_defaults"],
    notes: [
      "No matching supplier or recognisable headers — applying Australian retail defaults.",
      `Cost ex-GST, RRP incl-GST, ${markup}x markup (${category}).`,
    ],
  };
}

// ───────────────────────── public API ─────────────────────────

// Shared-patterns fallback: matches on header fingerprint across the
// anonymised pool. Lower confidence than per-user matches but still
// far better than blind defaults.
function stepShared_sharedPatternMatch(
  headers: string[],
  sharedPatterns: SharedPatternLite[],
): InferredRules | null {
  if (!sharedPatterns?.length) return null;
  const fp = headerFingerprint(headers);
  if (!fp) return null;

  const match = sharedPatterns.find((sp) => sp.header_fingerprint === fp);
  if (!match) return null;

  // Build a synthetic column_map keyed by *header text* using role hints.
  // We can only match the headers we recognise heuristically — the shared
  // pattern only stores roles, not original header text.
  const inferredHeader = step4_headerInference(headers, []);

  const contributors = match.contributor_count ?? 2;
  const baseConf = Math.min(70, 40 + contributors * 5);

  return {
    column_map: inferredHeader.column_map,
    size_system: (match.size_system as InferredRules["size_system"]) || "AU",
    price_column_cost: inferredHeader.price_column_cost,
    price_column_rrp: inferredHeader.price_column_rrp,
    gst_included_in_cost: match.gst_included_in_cost ?? false,
    gst_included_in_rrp: match.gst_included_in_rrp ?? true,
    default_markup_multiplier: match.markup_avg ?? 2.2,
    pack_notation_detected: match.pack_notation_detected ?? false,
    size_matrix_detected: match.size_matrix_detected ?? false,
    currency: "AUD",
    confidence: baseConf,
    rules_source: "shared_pattern_match",
    flags: ["shared_pattern", `contributors_${contributors}`],
    notes: [
      `Matched a format pattern learned from ${contributors} other retailers (anonymised).`,
    ],
  };
}

export function inferSupplierRules(
  headers: string[],
  sampleRows: Record<string, unknown>[],
  userSupplierProfiles: SupplierProfile[],
  supplierName?: string,
  category: "fashion" | "accessories" | "basics" = "fashion",
  sharedPatterns: SharedPatternLite[] = [],
): InferredRules {
  const profiles = userSupplierProfiles || [];

  return (
    step1_exactMatch(supplierName, profiles) ||
    step2_fuzzyMatch(supplierName, profiles) ||
    step3_headerFingerprint(headers, profiles) ||
    stepShared_sharedPatternMatch(headers, sharedPatterns) ||
    (() => {
      const inferred = step4_headerInference(headers, sampleRows);
      // Only fall through to defaults if we found basically nothing
      if (!inferred.price_column_cost && Object.keys(inferred.column_map).length === 0) {
        return step5_defaults(category);
      }
      return inferred;
    })()
  );
}

/**
 * Helper: header fingerprint exposed for callers that need to query
 * shared_patterns by fingerprint before invoking inferSupplierRules.
 */
export function computeHeaderFingerprint(headers: string[]): string {
  return headerFingerprint(headers);
}
