// Invoice post-processing validator
// Cleans parsed invoice data: rejects bad titles, reassigns numeric values, deduplicates

export interface RawProduct {
  name: string;
  brand: string;
  sku: string;
  barcode: string;
  type: string;
  colour: string;
  size: string;
  qty: number;
  cost: number;
  rrp: number;
}

export interface ValidatedProduct extends RawProduct {
  _confidence: number;
  _confidenceLevel: "high" | "medium" | "low";
  _issues: string[];
  _rejected: boolean;
  _rejectReason?: string;
}

export interface ValidationDebugInfo {
  totalRaw: number;
  accepted: number;
  rejected: number;
  rejectedRows: { row: number; name: string; reason: string }[];
  detectedVendor: string;
  corrections: { row: number; field: string; from: string; to: string }[];
}

const NUMERIC_ONLY = /^[\d.,\s$€£¥%]+$/;
const MIN_TITLE_LENGTH = 3;
const HAS_ALPHA = /[a-zA-Z]/;

function isNumericOnly(val: string): boolean {
  return NUMERIC_ONLY.test(val.trim());
}

function isValidTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t.length < MIN_TITLE_LENGTH) return false;
  if (!HAS_ALPHA.test(t)) return false;
  if (isNumericOnly(t)) return false;
  return true;
}

function normalizeVendor(products: RawProduct[], supplierName: string): string {
  // Detect vendor from: explicit brand fields, repeated text, or supplier name
  const brandCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.brand?.trim()) {
      const b = p.brand.trim().toUpperCase();
      brandCounts[b] = (brandCounts[b] || 0) + 1;
    }
  }
  const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0];
  return topBrand ? topBrand[0] : (supplierName || "Unknown");
}

export function validateAndCleanProducts(
  raw: RawProduct[],
  supplierName: string
): { products: ValidatedProduct[]; debug: ValidationDebugInfo } {
  const detectedVendor = normalizeVendor(raw, supplierName);
  const vendorLower = detectedVendor.toLowerCase();
  const corrections: ValidationDebugInfo["corrections"] = [];
  const rejectedRows: ValidationDebugInfo["rejectedRows"] = [];
  const results: ValidatedProduct[] = [];

  for (let i = 0; i < raw.length; i++) {
    const p = { ...raw[i] };
    const issues: string[] = [];
    let rejected = false;
    let rejectReason: string | undefined;

    // ── Title validation ──
    let name = (p.name || "").trim();

    // If title is numeric-only, try to reassign as price
    if (isNumericOnly(name)) {
      const numVal = parseFloat(name.replace(/[^0-9.]/g, ""));
      if (numVal > 0 && p.cost === 0) {
        corrections.push({ row: i, field: "cost", from: "0", to: String(numVal) });
        p.cost = numVal;
      }
      // Try to find a better title from nearby context
      name = "";
      issues.push("Title was numeric-only, reassigned to price");
    }

    // If title matches vendor name exactly, reject as title
    if (name && name.toLowerCase().replace(/\s+/g, " ").trim() === vendorLower.replace(/\s+/g, " ").trim()) {
      issues.push("Title matched vendor name");
      name = "";
    }

    // If title contains vendor name + "Size" pattern, strip vendor
    if (name && vendorLower) {
      const vendorPattern = new RegExp(`^${escapeRegex(detectedVendor)}\\s+`, "i");
      if (vendorPattern.test(name) && name.toLowerCase() !== vendorLower) {
        const cleaned = name.replace(vendorPattern, "").trim();
        if (cleaned.length >= MIN_TITLE_LENGTH && HAS_ALPHA.test(cleaned)) {
          corrections.push({ row: i, field: "name", from: name, to: cleaned });
          name = cleaned;
        }
      }
    }

    // Final title validity check
    if (!isValidTitle(name)) {
      // If we have a SKU, use it as a fallback title
      if (p.sku && HAS_ALPHA.test(p.sku) && p.sku.length >= MIN_TITLE_LENGTH) {
        corrections.push({ row: i, field: "name", from: name, to: `Product ${p.sku}` });
        name = `Product ${p.sku}`;
        issues.push("Used SKU as fallback title");
      } else {
        rejected = true;
        rejectReason = name
          ? `Invalid title: "${name}" (${isNumericOnly(name) ? "numeric only" : "too short or no alpha chars"})`
          : "Empty title with no fallback";
      }
    }

    p.name = name;

    // ── Price validation ──
    if (p.cost <= 0 && p.rrp > 0) {
      issues.push("No cost price, using RRP as reference");
    }

    // ── Vendor assignment ──
    if (!p.brand?.trim()) {
      p.brand = detectedVendor;
      corrections.push({ row: i, field: "brand", from: "", to: detectedVendor });
    }

    // ── Confidence scoring ──
    let confidence = 0;
    if (isValidTitle(p.name)) confidence += 30;
    if (p.brand?.trim()) confidence += 10;
    if (p.type?.trim()) confidence += 10;
    if (p.sku?.trim()) confidence += 10;
    if (p.barcode?.trim()) confidence += 10;
    if (p.cost > 0) confidence += 15;
    if (p.rrp > 0) confidence += 5;
    if (p.qty > 0) confidence += 5;
    if (p.colour?.trim()) confidence += 3;
    if (p.size?.trim()) confidence += 2;
    confidence = Math.min(100, confidence);

    const confidenceLevel: "high" | "medium" | "low" =
      confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low";

    if (rejected) {
      rejectedRows.push({ row: i, name: raw[i].name || "(empty)", reason: rejectReason || "Invalid" });
    }

    results.push({
      ...p,
      _confidence: confidence,
      _confidenceLevel: confidenceLevel,
      _issues: issues,
      _rejected: rejected,
      _rejectReason: rejectReason,
    });
  }

  // ── Duplicate filtering ──
  const seen = new Set<string>();
  for (const p of results) {
    if (p._rejected) continue;
    const key = `${p.name.toLowerCase()}|${p.cost}|${p.size}|${p.colour}`;
    if (seen.has(key)) {
      p._rejected = true;
      p._rejectReason = "Duplicate row";
      rejectedRows.push({ row: results.indexOf(p), name: p.name, reason: "Duplicate" });
    }
    seen.add(key);
  }

  const accepted = results.filter(p => !p._rejected);

  return {
    products: results,
    debug: {
      totalRaw: raw.length,
      accepted: accepted.length,
      rejected: results.filter(p => p._rejected).length,
      rejectedRows,
      detectedVendor,
      corrections,
    },
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
