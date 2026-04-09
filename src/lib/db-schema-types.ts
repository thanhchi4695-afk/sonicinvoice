// ══════════════════════════════════════════════════════════
// Sonic Invoice — Database-backed Shared Data Model Types
// Maps to the public.products, variants, suppliers,
// documents, document_lines, inventory, expenses tables.
// ══════════════════════════════════════════════════════════

export interface DbProduct {
  id: string;
  user_id: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  description: string | null;
  image_url: string | null;
  shopify_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbVariant {
  id: string;
  user_id: string;
  product_id: string;
  sku: string | null;
  barcode: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  cost: number;
  retail_price: number;
  shopify_variant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSupplier {
  id: string;
  user_id: string;
  name: string;
  contact_info: Record<string, string>;
  currency: string;
  notes: string | null;
  total_spend: number;
  avg_margin: number | null;
  created_at: string;
  updated_at: string;
}

export type DocumentSourceType = "invoice" | "wholesale" | "packing_slip" | "lookbook" | "bill";
export type DocumentStatus = "draft" | "reviewed" | "pushed" | "confirmed" | "error";

export interface DbDocument {
  id: string;
  user_id: string;
  source_type: DocumentSourceType;
  supplier_id: string | null;
  supplier_name: string | null;
  document_number: string | null;
  date: string | null;
  due_date: string | null;
  currency: string;
  subtotal: number;
  gst: number;
  total: number;
  status: DocumentStatus;
  accounting_category: string | null;
  accounting_code: string | null;
  external_id: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbDocumentLine {
  id: string;
  user_id: string;
  document_id: string;
  product_title: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  gst: number;
  confidence: number | null;
  parse_strategy: string | null;
  accounting_category: string | null;
  accounting_code: string | null;
  created_at: string;
}

export interface DbInventory {
  id: string;
  user_id: string;
  variant_id: string;
  location: string;
  quantity: number;
  last_updated: string;
}

export interface DbExpense {
  id: string;
  user_id: string;
  category: string;
  subcategory: string | null;
  amount: number;
  gst: number;
  date: string;
  period_start: string | null;
  period_end: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  description: string | null;
  document_id: string | null;
  created_at: string;
}

// ── Insert types (omit server-generated fields) ──────────

export type DbProductInsert = Omit<DbProduct, "id" | "created_at" | "updated_at">;
export type DbVariantInsert = Omit<DbVariant, "id" | "created_at" | "updated_at">;
export type DbSupplierInsert = Omit<DbSupplier, "id" | "created_at" | "updated_at">;
export type DbDocumentInsert = Omit<DbDocument, "id" | "created_at" | "updated_at">;
export type DbDocumentLineInsert = Omit<DbDocumentLine, "id" | "created_at">;
export type DbInventoryInsert = Omit<DbInventory, "id" | "last_updated">;
export type DbExpenseInsert = Omit<DbExpense, "id" | "created_at">;
