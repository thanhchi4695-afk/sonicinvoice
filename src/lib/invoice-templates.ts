// Invoice Template Recognition & Memory Engine

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
  | "size_grid"
  | "size_matrix_inline"
  | "size_block"
  | "size_row_below"
  | "colour_size_in_description"
  | "simple_flat"
  | "packing_list"
  | "unknown";

export type ProcessAsMode = "auto" | "invoice" | "packing_slip" | "handwritten" | "supplier_template";

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
  detectedFields?: string[];
  lastLayoutConfidence?: number;
  customInstructions?: string;
}

const STORAGE_KEY = "invoice_format_templates";

// ── Shared AU Swimwear Templates ───────────────────────────
export const SHARED_AU_TEMPLATES: InvoiceTemplate[] = [
  { supplier: "Jantzen", fileType: "xlsx", headerRow: 3, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "F", cost: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_matrix_inline" },
  { supplier: "Seafolly", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F", rrp: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Bond Eye", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_row_below" },
  { supplier: "Sea Level", fileType: "xlsx", headerRow: 2, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "E", cost: "F", rrp: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_row_below" },
  { supplier: "Baku", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Jets", fileType: "xlsx", headerRow: 2, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Speedo AU", fileType: "xlsx", headerRow: 3, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "F", cost: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Funkita", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Sunseeker", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Tigerlily", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "D", size: "C", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_grid" },
  { supplier: "Skye Group", fileType: "pdf", headerRow: 1, columns: { title: "C", sku: "A", colour: "B", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_matrix_inline" },
  { supplier: "Rhythm", fileType: "pdf", headerRow: 1, columns: { title: "C", sku: "B", colour: "D", size: "D", qty: "A", cost: "E" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "size_block" },
  { supplier: "Donna Donna", fileType: "pdf", headerRow: 1, columns: { title: "B", sku: "A", qty: "C", cost: "D" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "colour_size_in_description" },
  { supplier: "OM Designs", fileType: "pdf", headerRow: 1, columns: { title: "B", qty: "A", cost: "C" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "simple_flat" },
  { supplier: "Kung Fu Mary", fileType: "pdf", headerRow: 1, columns: { title: "A", qty: "B" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true, layoutType: "packing_list" },
];

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
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Get all saved templates as a sorted list */
export function getTemplateList(): InvoiceTemplate[] {
  const user = Object.values(getFormatTemplates());
  const shared = SHARED_AU_TEMPLATES.filter(
    s => !user.some(u => u.supplier.toLowerCase() === s.supplier.toLowerCase())
  );
  return [...user, ...shared].sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed);
    return b.successCount - a.successCount;
  });
}

// ── Matching ───────────────────────────────────────────────
export function findTemplate(supplier: string): InvoiceTemplate | null {
  if (!supplier) return null;
  const key = supplier.toLowerCase().trim();

  // Check user-saved templates first
  const all = getFormatTemplates();
  if (all[key]) return all[key];

  // Fuzzy match on user templates
  for (const [k, t] of Object.entries(all)) {
    if (key.includes(k) || k.includes(key)) return t;
  }

  // Check shared AU templates (exact and fuzzy)
  const shared = SHARED_AU_TEMPLATES.find(t => {
    const tKey = t.supplier.toLowerCase();
    return tKey === key || key.includes(tKey) || tKey.includes(key);
  });
  return shared || null;
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
    case "size_grid": return "Size Grid (e.g. Seafolly)";
    case "size_matrix_inline": return "Size Matrix Inline (e.g. Skye Group)";
    case "size_block": return "Size Block (e.g. Rhythm)";
    case "size_row_below": return "Size Row Below (e.g. Sea Level)";
    case "colour_size_in_description": return "Colour+Size in Description (e.g. Donna Donna)";
    case "simple_flat": return "Simple Flat Table (e.g. OM Designs)";
    case "packing_list": return "Packing List / Manifest";
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
