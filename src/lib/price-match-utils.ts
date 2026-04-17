// Shared mapping helpers for Price Match + Product Descriptions.
// Both panels accept the same line-item shape so we keep one source of truth.

export interface PriceMatchLineItem {
  style_name: string;
  style_number: string;
  brand: string;
  cost_ex_gst: number;
  rrp_incl_gst: number;
  barcode?: string;
  product_type?: string;
}

// Loose shape of an InvoiceFlow productGroup — kept permissive on purpose so
// we don't have to import the whole InvoiceFlow types graph.
interface InvoiceProductGroup {
  name?: string;
  vendorCode?: string;
  brand?: string;
  price?: number;
  rrp?: number;
  barcode?: string;
  product_type?: string;
  type?: string;
  variants?: Array<{ sku?: string }>;
}

/**
 * Map invoice productGroups into the shared PriceMatchLineItem shape.
 * Used by both PriceMatchPanel and ProductDescriptionPanel.
 */
export function mapInvoiceItemsToPriceMatch(
  productGroups: InvoiceProductGroup[],
): PriceMatchLineItem[] {
  return (productGroups || []).map((g) => ({
    style_name: g.name || "",
    style_number: g.vendorCode || g.variants?.[0]?.sku || "",
    brand: g.brand || "",
    cost_ex_gst: g.price || 0,
    rrp_incl_gst: g.rrp || 0,
    barcode: g.barcode || undefined,
    product_type: g.product_type || g.type || undefined,
  }));
}
