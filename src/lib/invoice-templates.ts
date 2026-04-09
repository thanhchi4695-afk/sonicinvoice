// Invoice Template Learning Engine — stores layout fingerprints and merchant corrections

export interface ColumnMapping {
  title?: string;
  sku?: string;
  colour?: string;
  size?: string;
  qty?: string;
  cost?: string;
  rrp?: string;
  description?: string;
  barcode?: string;
}

export type LayoutType =
  | "row_table"
  | "size_grid"
  | "size_matrix_inline"
  | "product_block"
  | "size_row_below"
  | "description_embedded"
  | "low_structure"
  | "mixed"
  | "unknown";

export type ProcessAsMode = "auto" | "invoice" | "packing_slip" | "handwritten" | "supplier_template";

export interface CorrectionPattern {
  field: string;          // e.g. "colour", "size", "cost", "title", "grouping"
  original: string;       // what the AI extracted
  corrected: string;      // what the merchant changed it to
  rule: string;           // human-readable rule derived from the correction
  timestamp: string;
}

export interface InvoiceTemplate {
  supplier: string;
  fileType: "xlsx" | "csv" | "pdf" | "docx" | "image";
  headerRow: number;
  columns: ColumnMapping;
  successCount: number;
  errorCount: number;
  lastUsed: string;
  createdAt: string;
  notes: string;
  isShared?: boolean;
  // AI layout memory
  layoutType?: LayoutType;
  variantMethod?: string;
  sizeSystem?: string;
  detectedFields?: string[];
  lastLayoutConfidence?: number;
  customInstructions?: string;
  // Correction-based learning
  corrections?: CorrectionPattern[];
}

const STORAGE_KEY = "invoice_format_templates";
const CORRECTIONS_KEY = "invoice_corrections";

// ── CRUD ───────────────────────────────────────────────────
export function getFormatTemplates(): Record<string, InvoiceTemplate> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

export function saveFormatTemplate(template: InvoiceTemplate) {
  const all = getFormatTemplates();
  const key = template.supplier.toLowerCase().trim();
  all[key] = { ...template, lastUsed: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteFormatTemplate(supplier: string) {
  const all = getFormatTemplates();
  delete all[supplier.toLowerCase().trim()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function incrementTemplateUse(supplier: string) {
  const all = getFormatTemplates();
  const key = supplier.toLowerCase().trim();
  if (all[key]) {
    all[key].successCount += 1;
    all[key].lastUsed = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

export function incrementTemplateError(supplier: string) {
  const all = getFormatTemplates();
  const key = supplier.toLowerCase().trim();
  if (all[key]) {
    all[key].errorCount += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

/** Save or update template after a successful parse with layout info from AI */
export function saveLayoutTemplate(
  supplier: string,
  layoutType: LayoutType,
  confidence: number,
  fileType: InvoiceTemplate["fileType"],
  customInstructions?: string,
  variantMethod?: string,
  sizeSystem?: string,
  detectedFields?: string[],
) {
  const all = getFormatTemplates();
  const key = supplier.toLowerCase().trim();
  const existing = all[key];
  if (existing) {
    existing.layoutType = layoutType;
    existing.lastLayoutConfidence = confidence;
    existing.successCount += 1;
    existing.lastUsed = new Date().toISOString();
    if (customInstructions) existing.customInstructions = customInstructions;
    if (variantMethod) existing.variantMethod = variantMethod;
    if (sizeSystem) existing.sizeSystem = sizeSystem;
    if (detectedFields) existing.detectedFields = detectedFields;
    all[key] = existing;
  } else {
    all[key] = {
      supplier,
      fileType,
      headerRow: 1,
      columns: {},
      successCount: 1,
      errorCount: 0,
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: "",
      layoutType,
      lastLayoutConfidence: confidence,
      customInstructions,
      variantMethod,
      sizeSystem,
      detectedFields,
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// ── Correction-based learning ──────────────────────────────

/** Save a merchant correction for a supplier */
export function saveCorrection(supplier: string, correction: CorrectionPattern) {
  const all = getFormatTemplates();
  const key = supplier.toLowerCase().trim();
  if (all[key]) {
    if (!all[key].corrections) all[key].corrections = [];
    // Don't duplicate identical corrections
    const isDup = all[key].corrections!.some(
      c => c.field === correction.field && c.original === correction.original && c.corrected === correction.corrected
    );
    if (!isDup) {
      all[key].corrections!.push(correction);
      // Keep max 50 corrections per supplier
      if (all[key].corrections!.length > 50) {
        all[key].corrections = all[key].corrections!.slice(-50);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

/** Get correction rules as human-readable strings for AI prompt injection */
export function getCorrectionRules(supplier: string): string[] {
  const template = findTemplate(supplier);
  if (!template?.corrections?.length) return [];
  // Deduplicate and return unique rules
  const rules = new Set(template.corrections.map(c => c.rule));
  return Array.from(rules);
}

/** Build a template hint object to pass to the edge function */
export function buildTemplateHint(supplier: string): Record<string, unknown> | null {
  const template = findTemplate(supplier);
  if (!template) return null;
  return {
    layoutType: template.layoutType,
    variantMethod: template.variantMethod,
    sizeSystem: template.sizeSystem,
    detectedFields: template.detectedFields,
    customInstructions: template.customInstructions,
    corrections: getCorrectionRules(supplier),
  };
}

/** Get all saved templates as a sorted list */
export function getTemplateList(): InvoiceTemplate[] {
  const user = Object.values(getFormatTemplates());
  return user.sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed);
    return b.successCount - a.successCount;
  });
}

// ── Matching ───────────────────────────────────────────────
export function findTemplate(supplier: string): InvoiceTemplate | null {
  if (!supplier) return null;
  const key = supplier.toLowerCase().trim();

  const all = getFormatTemplates();
  if (all[key]) return all[key];

  // Fuzzy match
  for (const [k, t] of Object.entries(all)) {
    if (key.includes(k) || k.includes(key)) return t;
  }

  return null;
}

// ── Quality indicator ──────────────────────────────────────
export function getTemplateQuality(t: InvoiceTemplate): { label: string; color: string } {
  const total = t.successCount + t.errorCount;
  if (total === 0) return { label: "New — not yet used", color: "text-muted-foreground" };
  const errorRate = t.errorCount / total;
  if (errorRate === 0) return { label: `Reliable (${t.successCount} uses, 0 errors)`, color: "text-success" };
  if (errorRate < 0.3) return { label: `Good (${t.successCount} uses, ${t.errorCount} corrections)`, color: "text-warning" };
  return { label: `Review (${t.successCount} uses, ${t.errorCount} corrections)`, color: "text-destructive" };
}

export function getLayoutLabel(layout?: LayoutType): string {
  switch (layout) {
    case "row_table": return "Row-based Table";
    case "size_grid": return "Size Grid Matrix";
    case "size_matrix_inline": return "Inline Size Matrix";
    case "product_block": return "Product Blocks with Nested Sizes";
    case "size_row_below": return "Size Breakdown Row";
    case "description_embedded": return "Variants in Description";
    case "low_structure": return "Low Structure / Handwritten";
    case "mixed": return "Mixed Layout";
    case "unknown": return "Unknown Layout";
    default: return "Not detected";
  }
}

// ── Column label helper ────────────────────────────────────
const COLUMN_LABELS: Record<keyof ColumnMapping, string> = {
  title: "Product name",
  sku: "SKU / Style No.",
  colour: "Colour",
  size: "Size",
  qty: "Quantity",
  cost: "Cost price",
  rrp: "RRP / Retail",
  description: "Description",
  barcode: "Barcode / EAN",
};
export { COLUMN_LABELS };
