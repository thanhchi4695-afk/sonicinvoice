// Fast-path stock reconciliation — pure function used by InvoiceFlow when
// the supplier is known, every line is priced, and the catalog cache is warm.
// Extracted so it can be unit/integration tested without mounting the full UI.

export interface FastPathLine {
  sku?: string | null;
  product_name?: string | null;
  brand?: string | null;
  colour?: string | null;
  size?: string | null;
  qty: number;
  cost?: number | null;
  rrp?: number | null;
  barcode?: string | null;
}

export interface FastPathCacheRow {
  sku?: string | null;
  barcode?: string | null;
  product_title?: string | null;
  vendor?: string | null;
  platform_product_id?: string | null;
  platform_variant_id?: string | null;
  current_qty?: number | null;
  current_cost?: number | null;
}

export interface FastPathMatch {
  invoice_sku: string | null;
  invoice_product_name: string | null;
  invoice_colour: string | null;
  invoice_size: string | null;
  invoice_qty: number;
  invoice_cost: number | null;
  invoice_rrp: number | null;
  match_type: "exact_refill" | "new";
  matched_product_id: string | null;
  matched_variant_id: string | null;
  matched_current_qty: number | null;
  matched_current_cost: number | null;
  cost_delta_pct: null;
  conflict_reason: null;
  user_decision: "pending";
}

export interface FastPathResult {
  lines: FastPathMatch[];
  summary: {
    total: number;
    new_products: number;
    exact_refills: number;
    new_variants: 0;
    new_colours: 0;
    conflicts: 0;
  };
  catalog_freshness: "cached_fast_path";
}

/** Returns true when the fast path is eligible for this invoice/connection. */
export function canUseFastPath(args: {
  supplierName?: string | null;
  hasShopify: boolean;
  invoiceLines: FastPathLine[];
  cacheSize: number;
}): boolean {
  const supplierKnown = !!(args.supplierName && args.supplierName.length > 0);
  const allPriced = args.invoiceLines.every(
    (l) => Number(l.cost) > 0 && Number(l.rrp) > 0,
  );
  return supplierKnown && allPriced && args.hasShopify && args.cacheSize > 50;
}

/** Match invoice lines against a cached catalog using SKU/barcode lookup only. */
export function runFastPath(
  invoiceLines: FastPathLine[],
  cache: FastPathCacheRow[],
): FastPathResult {
  const byKey = new Map<string, FastPathCacheRow>();
  for (const c of cache) {
    if (c.sku) byKey.set("s:" + String(c.sku).toLowerCase(), c);
    if (c.barcode) byKey.set("b:" + String(c.barcode).toLowerCase(), c);
  }

  const lines: FastPathMatch[] = invoiceLines.map((l) => {
    const m =
      (l.sku && byKey.get("s:" + String(l.sku).toLowerCase())) ||
      (l.barcode && byKey.get("b:" + String(l.barcode).toLowerCase())) ||
      null;
    return {
      invoice_sku: l.sku ?? null,
      invoice_product_name: l.product_name ?? null,
      invoice_colour: l.colour ?? null,
      invoice_size: l.size ?? null,
      invoice_qty: l.qty,
      invoice_cost: l.cost ?? null,
      invoice_rrp: l.rrp ?? null,
      match_type: m ? "exact_refill" : "new",
      matched_product_id: m?.platform_product_id ?? null,
      matched_variant_id: m?.platform_variant_id ?? null,
      matched_current_qty: m?.current_qty ?? null,
      matched_current_cost: m?.current_cost ?? null,
      cost_delta_pct: null,
      conflict_reason: null,
      user_decision: "pending",
    };
  });

  return {
    lines,
    summary: {
      total: lines.length,
      new_products: lines.filter((l) => l.match_type === "new").length,
      exact_refills: lines.filter((l) => l.match_type === "exact_refill").length,
      new_variants: 0,
      new_colours: 0,
      conflicts: 0,
    },
    catalog_freshness: "cached_fast_path",
  };
}
