// ══════════════════════════════════════════════════════════
// Mappers: convert existing data formats → unified types
// ══════════════════════════════════════════════════════════

import type {
  UnifiedVariant,
  UnifiedBill,
  UnifiedBillLine,
  UnifiedExpense,
  UnifiedPeriodReport,
  SourceMeta,
  SourcePlatform,
} from "./unified-types";
import type { WholesaleOrder, WholesaleLineItem } from "./wholesale-mapper";
import type { InventoryVariant } from "./inventory-parser";

// ── Wholesale → Unified Variant ──────────────────────────

export function wholesaleLineToUnified(
  li: WholesaleLineItem,
  order: WholesaleOrder
): UnifiedVariant {
  return {
    styleCode: li.styleNumber,
    sku: `${li.styleNumber}-${li.colourCode || li.colour}-${li.size}`
      .toUpperCase().replace(/\s+/g, "-"),
    title: li.styleName,
    description: li.description,
    vendor: li.brand,
    productType: li.productType,
    colour: li.colour,
    colourCode: li.colourCode,
    size: li.size,
    barcode: li.barcode,
    imageUrl: li.imageUrl,
    retailPrice: li.rrp,
    wholesaleCost: li.wholesale,
    quantity: li.quantityOrdered,
    tags: [li.brand, li.colour, li.collection, "full_price", "new"].filter(Boolean),
    season: li.season,
    collection: li.collection,
    fabrication: li.fabrication,
    source: {
      sourceType: "wholesale",
      sourcePlatform: order.platform as SourcePlatform,
      sourceDocumentId: order.orderId,
      sourceSupplier: order.brandName,
      sourceDate: order.importedAt,
      sourceCurrency: order.currency,
      importedAt: order.importedAt,
    },
  };
}

export function wholesaleOrderToUnified(order: WholesaleOrder): UnifiedVariant[] {
  return order.lineItems.map((li) => wholesaleLineToUnified(li, order));
}

// ── Inventory parser → Unified Variant ───────────────────

export function inventoryVariantToUnified(
  v: InventoryVariant,
  platform: SourcePlatform = "shopify"
): UnifiedVariant {
  return {
    styleCode: v.productId,
    sku: v.sku,
    title: v.productName,
    description: "",
    vendor: v.brand,
    productType: v.productType,
    colour: v.colourValue,
    colourCode: "",
    size: v.sizeValue,
    barcode: "",
    imageUrl: "",
    retailPrice: v.price,
    wholesaleCost: v.costPrice,
    quantity: v.qty,
    tags: [],
    season: "",
    collection: "",
    fabrication: "",
    source: {
      sourceType: "manual",
      sourcePlatform: platform,
      sourceDocumentId: "",
      sourceSupplier: v.brand,
      sourceDate: new Date().toISOString(),
      sourceCurrency: "AUD",
      importedAt: new Date().toISOString(),
    },
  };
}

// ── Invoice parsed data → Unified Bill ───────────────────

export interface RawInvoiceData {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  subtotal: number;
  gst: number;
  total: number;
  category?: string;
  accountCode?: string;
  lineItems?: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    total: number;
    gst: number;
    category?: string;
    accountCode?: string;
  }>;
}

export function invoiceToUnifiedBill(
  raw: RawInvoiceData,
  platform: SourcePlatform = "manual"
): UnifiedBill {
  const lines: UnifiedBillLine[] = (raw.lineItems || []).map((li) => ({
    description: li.description,
    quantity: li.qty,
    unitPrice: li.unitPrice,
    totalExGst: li.total - (li.gst || 0),
    gstAmount: li.gst || 0,
    accountCategory: li.category || raw.category || "",
    accountCode: li.accountCode || raw.accountCode || "",
    gstCode: li.gst ? "GST" : "BAS Excluded",
  }));

  return {
    id: `bill-${Date.now()}`,
    supplierName: raw.supplierName,
    invoiceNumber: raw.invoiceNumber,
    invoiceDate: raw.invoiceDate,
    dueDate: raw.dueDate || "",
    subtotalExGst: raw.subtotal,
    gstAmount: raw.gst,
    totalIncGst: raw.total,
    accountCategory: raw.category || "",
    accountCode: raw.accountCode || "",
    gstCode: raw.gst ? "GST on Expenses" : "BAS Excluded",
    status: "draft",
    accountingPlatform: platform,
    externalId: "",
    externalUrl: "",
    lineItems: lines,
    source: {
      sourceType: "invoice",
      sourcePlatform: platform,
      sourceDocumentId: raw.invoiceNumber,
      sourceSupplier: raw.supplierName,
      sourceDate: raw.invoiceDate,
      sourceCurrency: "AUD",
      importedAt: new Date().toISOString(),
    },
  };
}

// ── Expense classification → Unified Expense ─────────────

export function toUnifiedExpense(input: {
  category: string;
  subcategory?: string;
  amount: number;
  gst?: number;
  date: string;
  periodStart?: string;
  periodEnd?: string;
  supplier?: string;
  platform?: SourcePlatform;
  description?: string;
}): UnifiedExpense {
  return {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category: input.category,
    subcategory: input.subcategory || "",
    amount: input.amount,
    gst: input.gst || 0,
    date: input.date,
    periodStart: input.periodStart || input.date,
    periodEnd: input.periodEnd || input.date,
    sourcePlatform: input.platform || "manual",
    linkedSupplier: input.supplier || "",
    description: input.description || "",
  };
}

// ── Period aggregation → Unified Report ──────────────────

export function buildPeriodReport(
  periodStart: string,
  periodEnd: string,
  revenue: number,
  cogs: number,
  expenses: UnifiedExpense[]
): UnifiedPeriodReport {
  const grouped: Record<string, number> = {};
  let totalExp = 0;
  for (const e of expenses) {
    grouped[e.category] = (grouped[e.category] || 0) + e.amount;
    totalExp += e.amount;
  }
  return {
    periodStart,
    periodEnd,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    expenses: grouped,
    totalExpenses: totalExp,
    netProfit: revenue - cogs - totalExp,
  };
}
