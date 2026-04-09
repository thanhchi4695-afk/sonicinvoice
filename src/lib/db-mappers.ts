// ══════════════════════════════════════════════════════════
// Mappers: convert existing in-memory types → DB insert types
// ══════════════════════════════════════════════════════════

import type {
  DbProductInsert,
  DbVariantInsert,
  DbSupplierInsert,
  DbDocumentInsert,
  DbDocumentLineInsert,
  DbExpenseInsert,
  DocumentSourceType,
} from "./db-schema-types";
import type { UnifiedVariant, UnifiedBill, UnifiedBillLine, UnifiedExpense } from "./unified-types";
import type { GroupedProduct } from "./unified-types";

// ── UnifiedVariant → Product + Variant inserts ───────────

export function unifiedVariantToDbProduct(
  v: UnifiedVariant,
  userId: string
): DbProductInsert {
  return {
    user_id: userId,
    title: v.title,
    vendor: v.vendor || null,
    product_type: v.productType || null,
    description: v.description || null,
    image_url: v.imageUrl || null,
    shopify_product_id: null,
  };
}

export function unifiedVariantToDbVariant(
  v: UnifiedVariant,
  userId: string,
  productId: string
): DbVariantInsert {
  return {
    user_id: userId,
    product_id: productId,
    sku: v.sku || null,
    barcode: v.barcode || null,
    color: v.colour || null,
    size: v.size || null,
    quantity: v.quantity,
    cost: v.wholesaleCost,
    retail_price: v.retailPrice,
    shopify_variant_id: null,
  };
}

// ── GroupedProduct → Product + Variant inserts ───────────

export function groupedProductToDbProduct(
  p: GroupedProduct,
  userId: string
): DbProductInsert {
  return {
    user_id: userId,
    title: p.title,
    vendor: p.vendor || p.brand || null,
    product_type: p.productType || null,
    description: p.description || null,
    image_url: p.imageUrl || null,
    shopify_product_id: null,
  };
}

export function groupedProductToDbVariants(
  p: GroupedProduct,
  userId: string,
  productId: string
): DbVariantInsert[] {
  return p.sizes.map((size, i) => ({
    user_id: userId,
    product_id: productId,
    sku: p.sku || null,
    barcode: p.barcodes[i] || null,
    color: p.colour || null,
    size,
    quantity: p.quantities[i] || 0,
    cost: p.wholesaleCost,
    retail_price: p.retailPrice,
    shopify_variant_id: null,
  }));
}

// ── UnifiedBill → Document + DocumentLine inserts ────────

export function unifiedBillToDbDocument(
  bill: UnifiedBill,
  userId: string
): DbDocumentInsert {
  const sourceMap: Record<string, DocumentSourceType> = {
    invoice: "invoice",
    wholesale: "wholesale",
    packing_slip: "packing_slip",
    lookbook: "lookbook",
    bill: "bill",
  };
  return {
    user_id: userId,
    source_type: sourceMap[bill.source?.sourceType] || "invoice",
    supplier_id: null,
    supplier_name: bill.supplierName || null,
    document_number: bill.invoiceNumber || null,
    date: bill.invoiceDate || null,
    due_date: bill.dueDate || null,
    currency: bill.source?.sourceCurrency || "AUD",
    subtotal: bill.subtotalExGst,
    gst: bill.gstAmount,
    total: bill.totalIncGst,
    status: bill.status === "pushed" ? "pushed" : "draft",
    accounting_category: bill.accountCategory || null,
    accounting_code: bill.accountCode || null,
    external_id: bill.externalId || null,
    external_url: bill.externalUrl || null,
  };
}

export function unifiedBillLineToDbDocumentLine(
  line: UnifiedBillLine,
  userId: string,
  documentId: string
): DbDocumentLineInsert {
  return {
    user_id: userId,
    document_id: documentId,
    product_title: line.description || null,
    sku: null,
    color: null,
    size: null,
    quantity: line.quantity,
    unit_cost: line.unitPrice,
    total_cost: line.totalExGst,
    gst: line.gstAmount,
    confidence: null,
    parse_strategy: null,
    accounting_category: line.accountCategory || null,
    accounting_code: line.accountCode || null,
  };
}

// ── UnifiedExpense → DbExpense insert ────────────────────

export function unifiedExpenseToDb(
  exp: UnifiedExpense,
  userId: string
): DbExpenseInsert {
  return {
    user_id: userId,
    category: exp.category,
    subcategory: exp.subcategory || null,
    amount: exp.amount,
    gst: exp.gst,
    date: exp.date,
    period_start: exp.periodStart || null,
    period_end: exp.periodEnd || null,
    supplier_id: null,
    supplier_name: exp.linkedSupplier || null,
    description: exp.description || null,
    document_id: null,
  };
}

// ── Supplier dedup helper ────────────────────────────────

export function buildSupplierInsert(
  name: string,
  userId: string,
  currency = "AUD"
): DbSupplierInsert {
  return {
    user_id: userId,
    name,
    contact_info: {},
    currency,
    notes: null,
    total_spend: 0,
    avg_margin: null,
  };
}
