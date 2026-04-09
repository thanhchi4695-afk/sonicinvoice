// Invoice Auto-Correct AI Layer
// Classifies, validates, corrects, and scores every parsed invoice row

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
  group_key?: string;
  cost_source?: string;
  _lineTotal?: number;
}

export type CellClassification =
  | "product_title"
  | "vendor"
  | "sku"
  | "variant"
  | "quantity"
  | "unit_price"
  | "total"
  | "ignored_text";

export interface CorrectionDetail {
  field: string;
  from: string;
  to: string;
  reason: string;
}

export interface ConfidenceSignal {
  label: string;
  delta: number;
}

// Source trace bounding box for highlighting invoice regions
export interface SourceBoundingBox {
  page: number;
  x: number;      // normalized 0-1
  y: number;      // normalized 0-1
  width: number;  // normalized 0-1
  height: number; // normalized 0-1
  text: string;
  fieldType?: "title" | "sku" | "colour" | "size" | "quantity" | "cost" | "vendor" | "barcode" | "unknown";
}

// Per-field source trace mapping
export interface FieldSourceTrace {
  field: string;
  value: string;
  page: number;
  boxes: SourceBoundingBox[];
  extractionMethod?: string; // e.g. "grid column", "inline text", "inferred from description"
}

// Full source trace for a product row
export interface SourceTrace {
  page: number;
  fieldTraces: FieldSourceTrace[];
  allBoxes: SourceBoundingBox[];
  approximated?: boolean; // true when exact coords unavailable
}

export interface ValidatedProduct extends RawProduct {
  _rowIndex: number;
  _rawName: string;
  _rawCost: number;
  _confidence: number;
  _confidenceLevel: "high" | "medium" | "low";
  _confidenceReasons: ConfidenceSignal[];
  _issues: string[];
  _corrections: CorrectionDetail[];
  _rejected: boolean;
  _rejectReason?: string;
  _classification: CellClassification;
  _suggestedTitle: string;
  _suggestedPrice: number;
  _suggestedVendor: string;
  _parseNotes?: string;
  _extractionReason?: string;
  _sourceTrace?: SourceTrace;
  _groupKey?: string;
  _costSource?: string;
  _mathCheck?: "pass" | "fail" | "skipped";
}

export interface ParsingPlan {
  document_type?: string;
  layout_type?: string;
  variant_method?: string;
  line_item_zone?: string;
  quantity_field?: string;
  cost_field?: string;
  grouping_required?: boolean;
  grouping_reason?: string;
  expected_review_level?: string;
  review_reason?: string;
  strategy_explanation?: string;
}

export interface ValidationDebugInfo {
  totalRaw: number;
  accepted: number;
  needsReview: number;
  rejected: number;
  rejectedRows: { row: number; name: string; reason: string }[];
  detectedVendor: string;
  corrections: { row: number; field: string; from: string; to: string; reason: string }[];
  parsingPlan?: ParsingPlan;
  rejectedByAI?: { raw_text: string; rejection_reason: string }[];
}

// ── Pattern matchers ──

const NUMERIC_ONLY = /^[\d.,\s$€£¥%]+$/;
const CURRENCY_PATTERN = /^\$?\s?\d{1,6}[.,]\d{2}$/;
const PRICE_LIKE = /^\d+[.,]\d{2}$/;
const MIN_TITLE_LENGTH = 3;
const HAS_ALPHA = /[a-zA-Z]/;

const BOILERPLATE_TERMS = [
  "subtotal", "sub total", "total", "gst", "tax", "freight", "shipping",
  "delivery", "discount", "invoice", "order", "date", "due", "terms",
  "payment", "account", "abn", "acn", "page", "qty", "quantity",
  "unit price", "amount", "description", "item", "ref", "note",
  "balance due", "remittance", "bill to", "ship to", "po number",
  "purchase order", "thank you", "regards",
];

function isNumericOnly(val: string): boolean {
  return NUMERIC_ONLY.test(val.trim());
}

function isCurrencyValue(val: string): boolean {
  const cleaned = val.trim().replace(/[$€£¥,\s]/g, "");
  return CURRENCY_PATTERN.test(val.trim()) || PRICE_LIKE.test(cleaned);
}

function isBoilerplate(val: string): boolean {
  const lower = val.toLowerCase().trim();
  return BOILERPLATE_TERMS.some(t => lower === t || lower.startsWith(t + " ") || lower.endsWith(" " + t));
}

function isValidTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t.length < MIN_TITLE_LENGTH) return false;
  if (!HAS_ALPHA.test(t)) return false;
  if (isNumericOnly(t)) return false;
  if (isCurrencyValue(t)) return false;
  if (isBoilerplate(t)) return false;
  return true;
}

// ── Vendor detection ──

function detectVendor(products: RawProduct[], supplierName: string): string {
  const brandCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.brand?.trim()) {
      const b = p.brand.trim().toUpperCase();
      brandCounts[b] = (brandCounts[b] || 0) + 1;
    }
  }

  // Also check if any "name" field is repeated across many rows (likely vendor, not product)
  const nameCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.name?.trim()) {
      const n = p.name.trim().toUpperCase();
      nameCounts[n] = (nameCounts[n] || 0) + 1;
    }
  }
  // If a name appears in >40% of rows, it's likely the vendor
  const threshold = Math.max(3, products.length * 0.4);
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count >= threshold && !brandCounts[name]) {
      brandCounts[name] = count;
    }
  }

  const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0];
  return topBrand ? topBrand[0] : (supplierName || "Unknown");
}

// ── Cell classification ──

function classifyCell(value: string, vendorName: string): CellClassification {
  const trimmed = value.trim();
  if (!trimmed) return "ignored_text";

  const lower = trimmed.toLowerCase();
  const vendorLower = vendorName.toLowerCase();

  // Vendor match
  if (lower === vendorLower || lower.replace(/\s+(pty|ltd|limited|inc|llc|co)\s*/gi, "").trim() === vendorLower.replace(/\s+(pty|ltd|limited|inc|llc|co)\s*/gi, "").trim()) {
    return "vendor";
  }

  // Pure numeric = price or qty
  if (isNumericOnly(trimmed)) {
    const num = parseFloat(trimmed.replace(/[^0-9.]/g, ""));
    if (num > 0 && num < 50 && Number.isInteger(num)) return "quantity";
    if (isCurrencyValue(trimmed) || num > 1) return "unit_price";
    return "unit_price";
  }

  // Boilerplate
  if (isBoilerplate(trimmed)) return "ignored_text";

  // SKU-like (short alphanumeric code)
  if (/^[A-Z0-9]{2,10}[A-Z]$/i.test(trimmed) && trimmed.length <= 12) return "sku";

  // Size-like
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|OS|\d{1,2}\s*(AU|US|UK))/i.test(trimmed)) return "variant";

  return "product_title";
}

// ── Line item reconstruction ──

function tryMergeFragmentedRows(products: RawProduct[], vendorName: string): RawProduct[] {
  const merged: RawProduct[] = [];
  let i = 0;

  while (i < products.length) {
    const current = { ...products[i] };
    const currentName = (current.name || "").trim();

    // If current row has no valid title but has a price
    if (!isValidTitle(currentName) && isNumericOnly(currentName)) {
      const numVal = parseFloat(currentName.replace(/[^0-9.]/g, ""));

      // Look backward for the nearest valid title row without a price
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        if (prev.cost === 0 && numVal > 0) {
          prev.cost = numVal;
          i++;
          continue;
        }
      }

      // Look forward for descriptive text
      if (i + 1 < products.length) {
        const next = products[i + 1];
        if (isValidTitle((next.name || "").trim())) {
          if (next.cost === 0) next.cost = numVal;
          // Skip this row, next will pick up the price
          i++;
          continue;
        }
      }
    }

    // If current row's name is the vendor name, skip it
    if (currentName.toLowerCase().replace(/\s+/g, " ") === vendorName.toLowerCase().replace(/\s+/g, " ")) {
      i++;
      continue;
    }

    merged.push(current);
    i++;
  }

  return merged;
}

// ── Source trace builder ──

interface AISourceRegion {
  page?: number;
  y_position?: number;
  extraction_method?: string;
}

function buildSourceTrace(
  product: RawProduct & { _sourceRegions?: Record<string, AISourceRegion> | null },
  rowIndex: number,
  totalRows: number,
  rejected: boolean,
): SourceTrace | undefined {
  const regions = product._sourceRegions;
  const fieldMap: Record<string, { field: string; value: string }> = {
    title: { field: "title", value: product.name || "" },
    sku: { field: "sku", value: product.sku || "" },
    colour: { field: "colour", value: product.colour || "" },
    size: { field: "size", value: product.size || "" },
    quantity: { field: "quantity", value: String(product.qty || "") },
    cost: { field: "cost", value: String(product.cost || "") },
  };

  const hasAIRegions = regions && Object.keys(regions).length > 0;

  // Build bounding boxes and field traces
  const allBoxes: SourceBoundingBox[] = [];
  const fieldTraces: FieldSourceTrace[] = [];
  let primaryPage = 1;

  for (const [key, info] of Object.entries(fieldMap)) {
    if (!info.value || info.value === "0") continue;

    let page = 1;
    let yPos: number;
    let method: string;

    if (hasAIRegions && regions[key]) {
      const r = regions[key];
      page = r.page || 1;
      yPos = typeof r.y_position === "number" ? r.y_position : (rowIndex / Math.max(totalRows, 1));
      method = r.extraction_method || "AI detected";
    } else {
      // Approximate: distribute rows evenly across page
      // Assume header takes ~10% and line items fill 10-90%
      yPos = 0.1 + (rowIndex / Math.max(totalRows, 1)) * 0.8;
      method = "approximated from row position";
    }

    // Build a bounding box (approximate width based on field type)
    const widths: Record<string, { x: number; w: number }> = {
      title: { x: 0.15, w: 0.35 },
      sku: { x: 0.02, w: 0.12 },
      colour: { x: 0.52, w: 0.12 },
      size: { x: 0.65, w: 0.08 },
      quantity: { x: 0.74, w: 0.08 },
      cost: { x: 0.83, w: 0.12 },
    };

    const dims = widths[key] || { x: 0.15, w: 0.2 };
    const box: SourceBoundingBox = {
      page,
      x: dims.x,
      y: yPos,
      width: dims.w,
      height: 0.018,
      text: info.value,
      fieldType: key as SourceBoundingBox["fieldType"],
    };

    allBoxes.push(box);
    fieldTraces.push({
      field: key,
      value: info.value,
      page,
      boxes: [box],
      extractionMethod: method,
    });

    if (key === "title") primaryPage = page;
  }

  if (allBoxes.length === 0) return undefined;

  return {
    page: primaryPage,
    fieldTraces,
    allBoxes,
    approximated: !hasAIRegions,
  };
}

// ── Main validator ──

export function validateAndCleanProducts(
  raw: RawProduct[],
  supplierName: string
): { products: ValidatedProduct[]; debug: ValidationDebugInfo } {
  const detectedVendor = detectVendor(raw, supplierName);
  const vendorLower = detectedVendor.toLowerCase().replace(/\s+/g, " ").trim();
  const vendorNormalized = vendorLower.replace(/\s+(pty|ltd|limited|inc|llc|co)\s*/gi, "").trim();

  // Phase 1: Detect repeated names (likely vendor text)
  const nameCounts: Record<string, number> = {};
  for (const p of raw) {
    const n = (p.name || "").trim().toLowerCase();
    if (n) nameCounts[n] = (nameCounts[n] || 0) + 1;
  }
  const repeatedThreshold = Math.max(3, raw.length * 0.3);

  // Phase 2: Merge fragmented rows
  const merged = tryMergeFragmentedRows(raw, detectedVendor);

  const corrections: ValidationDebugInfo["corrections"] = [];
  const rejectedRows: ValidationDebugInfo["rejectedRows"] = [];
  const results: ValidatedProduct[] = [];

  for (let i = 0; i < merged.length; i++) {
    const p = { ...merged[i] };
    const rawName = (p.name || "").trim();
    const rawCost = p.cost;
    const issues: string[] = [];
    const rowCorrections: CorrectionDetail[] = [];
    let rejected = false;
    let rejectReason: string | undefined;

    let name = rawName;

    // ── Classification ──
    const classification = classifyCell(name, detectedVendor);

    // ── Rule 1: Numeric-only title → reassign to price ──
    if (isNumericOnly(name)) {
      const numVal = parseFloat(name.replace(/[^0-9.]/g, ""));
      if (numVal > 0 && p.cost === 0) {
        rowCorrections.push({ field: "cost", from: "0", to: String(numVal), reason: "Numeric-only value reassigned from title to price" });
        corrections.push({ row: i, field: "cost", from: "0", to: String(numVal), reason: "Numeric-only value reassigned from title to price" });
        p.cost = numVal;
      }
      rejected = true;
      rejectReason = `Numeric-only value "${name}" cannot be product title — classified as unit_price`;
      name = "";
    }

    // ── Rule 2: Currency pattern title → reassign to price ──
    if (!rejected && isCurrencyValue(name)) {
      const numVal = parseFloat(name.replace(/[^0-9.]/g, ""));
      if (numVal > 0 && p.cost === 0) {
        rowCorrections.push({ field: "cost", from: "0", to: String(numVal), reason: "Currency value reassigned from title to price" });
        corrections.push({ row: i, field: "cost", from: "0", to: String(numVal), reason: "Currency value reassigned from title to price" });
        p.cost = numVal;
      }
      rejected = true;
      rejectReason = `Currency value "${name}" cannot be product title`;
      name = "";
    }

    // ── Rule 3: Vendor name as title ──
    if (!rejected && name) {
      const nameLower = name.toLowerCase().replace(/\s+/g, " ").trim();
      const nameNormalized = nameLower.replace(/\s+(pty|ltd|limited|inc|llc|co)\s*/gi, "").trim();
      if (nameLower === vendorLower || nameNormalized === vendorNormalized) {
        rejected = true;
        rejectReason = `"${name}" matches vendor name — not a product`;
        issues.push("Title matched vendor name");
        name = "";
      }
    }

    // ── Rule 4: Repeated identical text ──
    if (!rejected && name && (nameCounts[name.toLowerCase()] || 0) >= repeatedThreshold) {
      rejected = true;
      rejectReason = `"${name}" repeated ${nameCounts[name.toLowerCase()]} times — likely vendor/header text`;
      name = "";
    }

    // ── Rule 5: Boilerplate/header/footer text ──
    if (!rejected && isBoilerplate(name)) {
      rejected = true;
      rejectReason = `"${name}" is invoice boilerplate text`;
      name = "";
    }

    // ── Rule 6: Strip vendor prefix from valid titles ──
    if (!rejected && name && vendorLower) {
      const vendorPattern = new RegExp(`^${escapeRegex(detectedVendor)}\\s+`, "i");
      if (vendorPattern.test(name) && name.toLowerCase() !== vendorLower) {
        const cleaned = name.replace(vendorPattern, "").trim();
        if (cleaned.length >= MIN_TITLE_LENGTH && HAS_ALPHA.test(cleaned)) {
          rowCorrections.push({ field: "name", from: name, to: cleaned, reason: "Stripped vendor prefix from title" });
          corrections.push({ row: i, field: "name", from: name, to: cleaned, reason: "Stripped vendor prefix from title" });
          name = cleaned;
        }
      }
    }

    // ── Rule 7: Final title validity ──
    if (!rejected && !isValidTitle(name)) {
      if (p.sku && HAS_ALPHA.test(p.sku) && p.sku.length >= MIN_TITLE_LENGTH) {
        rowCorrections.push({ field: "name", from: name, to: `Product ${p.sku}`, reason: "Used SKU as fallback title" });
        corrections.push({ row: i, field: "name", from: name, to: `Product ${p.sku}`, reason: "Used SKU as fallback title" });
        name = `Product ${p.sku}`;
        issues.push("Used SKU as fallback title");
      } else {
        rejected = true;
        rejectReason = name
          ? `Invalid title: "${name}" (too short or no alpha chars)`
          : "Empty title with no fallback";
      }
    }

    p.name = name;

    // ── Vendor assignment ──
    const suggestedVendor = p.brand?.trim() || detectedVendor;
    if (!p.brand?.trim()) {
      p.brand = detectedVendor;
      rowCorrections.push({ field: "brand", from: "", to: detectedVendor, reason: "Assigned detected vendor" });
      corrections.push({ row: i, field: "brand", from: "", to: detectedVendor, reason: "Assigned detected vendor" });
    }

    // ── Price validation ──
    if (p.cost <= 0 && p.rrp > 0) {
      issues.push("No cost price, using RRP as reference");
    }

    // ── Confidence scoring with positive/negative signals ──
    const signals: ConfidenceSignal[] = [];
    let confidence = 0;

    if (!rejected) {
      // ── Positive signals ──
      if (isValidTitle(p.name) && p.name.length > 5) {
        signals.push({ label: "Valid descriptive title", delta: 20 });
        confidence += 20;
      }
      if (p.cost > 0 && !isNaN(p.cost)) {
        signals.push({ label: "Price detected", delta: 15 });
        confidence += 15;
      }
      if (p.qty > 0) {
        signals.push({ label: "Quantity detected", delta: 10 });
        confidence += 10;
      }
      if (p.brand?.trim()) {
        signals.push({ label: "Vendor assigned", delta: 10 });
        confidence += 10;
      }
      if (p.sku?.trim() || p.barcode?.trim()) {
        signals.push({ label: "SKU / barcode present", delta: 10 });
        confidence += 10;
      }
      if (p.type?.trim()) {
        signals.push({ label: "Product type set", delta: 10 });
        confidence += 10;
      }
      // Brand + product keywords
      const PRODUCT_KEYWORDS = /dress|top|bikini|pant|skirt|shirt|blouse|jacket|coat|short|sandal|shoe|boot|bag|hat/i;
      if (PRODUCT_KEYWORDS.test(p.name)) {
        signals.push({ label: "Title contains product keyword", delta: 5 });
        confidence += 5;
      }
      if (p.rrp > 0) {
        signals.push({ label: "RRP / compare-at price present", delta: 5 });
        confidence += 5;
      }
      if (p.colour?.trim() || p.size?.trim()) {
        signals.push({ label: "Variant data present", delta: 5 });
        confidence += 5;
      }
      // Consistent row (has both title + price)
      if (isValidTitle(p.name) && p.cost > 0) {
        signals.push({ label: "Row structure complete", delta: 10 });
        confidence += 10;
      }

      // ── Negative signals ──
      if (!p.cost || p.cost <= 0) {
        signals.push({ label: "Missing price", delta: -20 });
        confidence -= 20;
      }
      if (p.name.length < 3 && p.name.length > 0) {
        signals.push({ label: "Title too short", delta: -15 });
        confidence -= 15;
      }
      if (rowCorrections.length > 0) {
        signals.push({ label: "Required AI corrections", delta: -10 });
        confidence -= 10;
      }
      // Duplicate-like check within current batch
      const nameKey = p.name.toLowerCase();
      if (nameCounts[nameKey] && nameCounts[nameKey] > 1 && nameCounts[nameKey] < repeatedThreshold) {
        signals.push({ label: "Possible duplicate text", delta: -10 });
        confidence -= 10;
      }
    }

    confidence = Math.max(0, Math.min(100, confidence));

    const confidenceLevel: "high" | "medium" | "low" =
      rejected ? "low" : confidence >= 90 ? "high" : confidence >= 70 ? "medium" : "low";

    if (rejected) {
      signals.push({ label: rejectReason || "Invalid row", delta: -100 });
      rejectedRows.push({ row: i, name: rawName || "(empty)", reason: rejectReason || "Invalid" });
    }

    // Build extraction reason
    const extractionParts: string[] = [];
    if (!rejected) {
      if (isValidTitle(p.name)) extractionParts.push("Valid product title detected");
      if (p.cost > 0) extractionParts.push(`Cost $${p.cost.toFixed(2)} found`);
      if (p.qty > 0) extractionParts.push(`Qty ${p.qty}`);
      if (p.sku?.trim()) extractionParts.push(`SKU: ${p.sku}`);
      if (p.colour?.trim()) extractionParts.push(`Colour: ${p.colour}`);
      if (p.size?.trim()) extractionParts.push(`Size: ${p.size}`);
      if (rowCorrections.length > 0) extractionParts.push(`${rowCorrections.length} auto-correction(s)`);
    }

    // ── Build source trace from AI-provided regions ──
    const sourceTrace = buildSourceTrace(p as any, i, merged.length, rejected);

    results.push({
      ...p,
      _rowIndex: i,
      _rawName: rawName,
      _rawCost: rawCost,
      _confidence: rejected ? 0 : confidence,
      _confidenceLevel: confidenceLevel,
      _confidenceReasons: signals,
      _issues: issues,
      _corrections: rowCorrections,
      _rejected: rejected,
      _rejectReason: rejectReason,
      _classification: classification,
      _suggestedTitle: rejected ? "" : p.name,
      _suggestedPrice: p.cost,
      _suggestedVendor: suggestedVendor,
      _parseNotes: (p as any)._parseNotes || "",
      _extractionReason: rejected
        ? rejectReason || "Invalid row"
        : extractionParts.join(" · ") || "Extracted by AI",
      _sourceTrace: sourceTrace,
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
      p._confidenceLevel = "low";
      p._confidence = 0;
      rejectedRows.push({ row: p._rowIndex, name: p.name, reason: "Duplicate" });
    }
    seen.add(key);
  }

  const accepted = results.filter(p => !p._rejected && p._confidenceLevel === "high");
  const needsReview = results.filter(p => !p._rejected && p._confidenceLevel !== "high");
  const rejectedList = results.filter(p => p._rejected);

  return {
    products: results,
    debug: {
      totalRaw: raw.length,
      accepted: accepted.length,
      needsReview: needsReview.length,
      rejected: rejectedList.length,
      rejectedRows,
      detectedVendor,
      corrections,
    },
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
