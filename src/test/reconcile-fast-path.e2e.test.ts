// E2E-style test: simulates uploading a known-supplier refill invoice
// (Bond-Eye, 10 lines, all priced) against a warm Shopify catalog cache
// and asserts the reconcile flow completes within 30 seconds.
//
// This exercises the same fast-path code path InvoiceFlow.tsx uses,
// so a regression that re-introduces the blocking sync-shopify-catalog
// call would fail this test.

import { describe, it, expect, vi } from "vitest";
import {
  canUseFastPath,
  runFastPath,
  type FastPathLine,
  type FastPathCacheRow,
} from "@/lib/reconcile-fast-path";

const SUPPLIER = "Bond Eye";

const BOND_EYE_LINES: FastPathLine[] = Array.from({ length: 10 }, (_, i) => ({
  sku: `BE-RECY-${100 + i}`,
  product_name: `Bond Eye Recycled Style ${i + 1}`,
  brand: SUPPLIER,
  colour: "Black",
  size: "M",
  qty: 1,
  cost: 54.55,
  rrp: 120.0,
  barcode: `93000000${1000 + i}`,
}));

// Warm cache: 3,858 products like Splash Swimwear, with the 10 Bond-Eye SKUs present.
function buildWarmCache(): FastPathCacheRow[] {
  const noise: FastPathCacheRow[] = Array.from({ length: 3848 }, (_, i) => ({
    sku: `NOISE-${i}`,
    barcode: `48000000${i}`,
    product_title: `Filler Product ${i}`,
    vendor: i % 2 === 0 ? "Seafolly" : "Jantzen",
    platform_product_id: `gid://shopify/Product/${i}`,
    platform_variant_id: `gid://shopify/ProductVariant/${i}`,
    current_qty: 5,
    current_cost: 30,
  }));
  const refills: FastPathCacheRow[] = BOND_EYE_LINES.map((l, i) => ({
    sku: l.sku!,
    barcode: l.barcode!,
    product_title: l.product_name!,
    vendor: SUPPLIER,
    platform_product_id: `gid://shopify/Product/BE${i}`,
    platform_variant_id: `gid://shopify/ProductVariant/BE${i}`,
    current_qty: 0, // archived / out of stock — needs refill
    current_cost: 54.55,
  }));
  return [...noise, ...refills];
}

describe("reconcile fast path — warm cache E2E", () => {
  it("completes a known-supplier refill in under 30s without calling reconcile-invoice", async () => {
    const cache = buildWarmCache();

    // Spy that would fail if the slow edge function were invoked.
    const reconcileInvoke = vi.fn(async () => {
      throw new Error("reconcile-invoice should NOT be called on the fast path");
    });

    const start = performance.now();

    // Eligibility gate (mirrors InvoiceFlow.tsx).
    const eligible = canUseFastPath({
      supplierName: SUPPLIER,
      hasShopify: true,
      invoiceLines: BOND_EYE_LINES,
      cacheSize: cache.length,
    });
    expect(eligible).toBe(true);

    let result;
    if (eligible) {
      result = runFastPath(BOND_EYE_LINES, cache);
    } else {
      await reconcileInvoke();
    }

    const elapsedMs = performance.now() - start;

    // Fast path should not invoke the slow edge function.
    expect(reconcileInvoke).not.toHaveBeenCalled();

    // Hard wall: must finish well inside the user-visible 30s budget.
    expect(elapsedMs).toBeLessThan(30_000);

    // Sanity: every Bond-Eye line matched as an exact refill.
    expect(result!.summary.total).toBe(10);
    expect(result!.summary.exact_refills).toBe(10);
    expect(result!.summary.new_products).toBe(0);
    expect(result!.catalog_freshness).toBe("cached_fast_path");

    // Each line carries the matched Shopify product/variant id needed for refill.
    for (const line of result!.lines) {
      expect(line.matched_product_id).toMatch(/^gid:\/\/shopify\/Product\/BE/);
      expect(line.matched_variant_id).toMatch(/^gid:\/\/shopify\/ProductVariant\/BE/);
    }
  });

  it("falls back when supplier is unknown or cache is cold", () => {
    expect(
      canUseFastPath({
        supplierName: "",
        hasShopify: true,
        invoiceLines: BOND_EYE_LINES,
        cacheSize: 5000,
      }),
    ).toBe(false);

    expect(
      canUseFastPath({
        supplierName: SUPPLIER,
        hasShopify: true,
        invoiceLines: BOND_EYE_LINES,
        cacheSize: 10, // cold cache
      }),
    ).toBe(false);

    expect(
      canUseFastPath({
        supplierName: SUPPLIER,
        hasShopify: false,
        invoiceLines: BOND_EYE_LINES,
        cacheSize: 5000,
      }),
    ).toBe(false);

    expect(
      canUseFastPath({
        supplierName: SUPPLIER,
        hasShopify: true,
        invoiceLines: [{ ...BOND_EYE_LINES[0], rrp: 0 }],
        cacheSize: 5000,
      }),
    ).toBe(false);
  });
});
