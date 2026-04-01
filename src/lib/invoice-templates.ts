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
  isShared?: boolean; // AU shared template
}

const STORAGE_KEY = "invoice_format_templates";

// ── Shared AU Swimwear Templates ───────────────────────────
export const SHARED_AU_TEMPLATES: InvoiceTemplate[] = [
  { supplier: "Jantzen", fileType: "xlsx", headerRow: 3, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "F", cost: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Seafolly", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F", rrp: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Bond Eye", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Sea Level", fileType: "xlsx", headerRow: 2, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "E", cost: "F", rrp: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Baku", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Jets", fileType: "xlsx", headerRow: 2, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Speedo AU", fileType: "xlsx", headerRow: 3, columns: { title: "B", sku: "A", colour: "C", size: "D", qty: "F", cost: "G" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Funkita", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Sunseeker", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
  { supplier: "Tigerlily", fileType: "pdf", headerRow: 1, columns: { title: "A", sku: "B", colour: "D", size: "C", qty: "E", cost: "F" }, successCount: 0, errorCount: 0, lastUsed: "", createdAt: "2025-01-01", notes: "", isShared: true },
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

// ── Matching ───────────────────────────────────────────────
export function findTemplate(supplier: string): InvoiceTemplate | null {
  if (!supplier) return null;
  const key = supplier.toLowerCase().trim();

  // Check user-saved templates first
  const all = getFormatTemplates();
  if (all[key]) return all[key];

  // Check shared AU templates
  const shared = SHARED_AU_TEMPLATES.find(t => t.supplier.toLowerCase() === key);
  return shared || null;
}

// ── Quality indicator ──────────────────────────────────────
export function getTemplateQuality(t: InvoiceTemplate): { label: string; color: string } {
  const total = t.successCount + t.errorCount;
  if (total === 0) return { label: "New — not yet used", color: "text-muted-foreground" };
  const errorRate = t.errorCount / total;
  if (errorRate === 0) return { label: `Reliable (${t.successCount} uses, 0 errors)`, color: "text-green-600" };
  if (errorRate < 0.3) return { label: `Good (${t.successCount} uses, ${t.errorCount} corrections)`, color: "text-yellow-500" };
  return { label: `Review (${t.successCount} uses, ${t.errorCount} corrections)`, color: "text-destructive" };
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
