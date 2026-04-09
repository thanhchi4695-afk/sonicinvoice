// ══════════════════════════════════════════════════════════
// Sonic Invoice — Unified Internal Data Model
// All import sources, accounting flows, and reporting modules
// normalize into these shared interfaces.
// ══════════════════════════════════════════════════════════

// ── Source metadata ──────────────────────────────────────

export type SourceType = "invoice" | "wholesale" | "lookbook" | "packing_slip" | "bill" | "manual";
export type SourcePlatform =
  | "joor" | "nuorder" | "brandscope" | "brandboom" | "faire"
  | "xero" | "myob" | "csv" | "shopify" | "lightspeed" | "manual";

export interface SourceMeta {
  sourceType: SourceType;
  sourcePlatform: SourcePlatform;
  sourceDocumentId: string;
  sourceSupplier: string;
  sourceDate: string;        // ISO date
  sourceCurrency: string;    // e.g. "AUD"
  importedAt: string;        // ISO timestamp
}

// ── Product / Variant ────────────────────────────────────

export interface UnifiedVariant {
  styleCode: string;
  sku: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  colour: string;
  colourCode: string;
  size: string;
  barcode: string;
  imageUrl: string;
  retailPrice: number;
  wholesaleCost: number;
  quantity: number;
  tags: string[];
  season: string;
  collection: string;
  fabrication: string;
  source: SourceMeta;
}

// ── Accounting Bill ──────────────────────────────────────

export type BillStatus = "draft" | "pushed" | "confirmed" | "error";

export interface UnifiedBill {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  accountCategory: string;
  accountCode: string;
  gstCode: string;
  status: BillStatus;
  accountingPlatform: SourcePlatform;
  externalId: string;
  externalUrl: string;
  lineItems: UnifiedBillLine[];
  source: SourceMeta;
}

export interface UnifiedBillLine {
  description: string;
  quantity: number;
  unitPrice: number;
  totalExGst: number;
  gstAmount: number;
  accountCategory: string;
  accountCode: string;
  gstCode: string;
}

// ── Expense ──────────────────────────────────────────────

export interface UnifiedExpense {
  id: string;
  category: string;
  subcategory: string;
  amount: number;
  gst: number;
  date: string;
  periodStart: string;
  periodEnd: string;
  sourcePlatform: SourcePlatform;
  linkedSupplier: string;
  description: string;
}

// ── Reporting Period ─────────────────────────────────────

export interface UnifiedPeriodReport {
  periodStart: string;
  periodEnd: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: Record<string, number>;   // category → total
  totalExpenses: number;
  netProfit: number;
}

// ── Grouped Product (display wrapper for multi-size variants) ──

export interface GroupedProduct {
  title: string;
  sku: string;
  barcode: string;
  description: string;
  vendor: string;
  productType: string;
  retailPrice: number;
  wholesaleCost: number;
  colour: string;
  colourCode: string;
  size: string;
  collection: string;
  season: string;
  fabrication: string;
  imageUrl: string;
  brand: string;
  tags: string[];
  arrivalMonth: string;
  sizes: string[];
  barcodes: string[];
  quantities: number[];
  source: SourceMeta;
}

// ── Wholesale Order (already exists, re-exported) ────────

export type { WholesaleOrder, WholesaleLineItem } from "./wholesale-mapper";
