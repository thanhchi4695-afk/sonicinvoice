import { describe, it, expect, vi } from "vitest";

// Stub the supabase client so the module loads cleanly under jsdom.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: { nodes: [] }, error: null })) },
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    from: vi.fn(),
  },
}));

import { planRefillPriceRestore } from "@/lib/refill-price-restore";
import type { ReconciliationLine, MatchType } from "@/lib/stock-matcher";

const PROD = "gid://shopify/Product/100";
const V_BLACK = "gid://shopify/ProductVariant/1"; // on sale
const V_NAVY = "gid://shopify/ProductVariant/2";  // on sale (sibling)
const V_WHITE = "gid://shopify/ProductVariant/3"; // not on sale

function line(over: Partial<ReconciliationLine> & { match_type: MatchType }): ReconciliationLine {
  return {
    invoice_sku: "BE-001",
    invoice_product_name: "Bond Eye One Piece",
    invoice_colour: "Black",
    invoice_size: "M",
    invoice_qty: 1,
    invoice_cost: 50,
    invoice_rrp: 120,
    matched_product_id: PROD,
    matched_variant_id: V_BLACK,
    matched_current_qty: 0,
    matched_current_cost: 50,
    cost_delta_pct: null,
    conflict_reason: null,
    confidence: 95,
    match_signal: "sku",
    fuzzy_match: false,
    name_match: false,
    notes: [],
    ...over,
  };
}

const stubFetcher = vi.fn(async (_productIds: string[]) => {
  const sibs = [
    { variantId: V_BLACK, productId: PROD, price: 90, compareAt: 120 }, // on sale (compare_at)
    { variantId: V_NAVY,  productId: PROD, price: 100, compareAt: null }, // on sale (price < rrp)
    { variantId: V_WHITE, productId: PROD, price: 120, compareAt: null }, // not on sale
  ];
  return {
    byVariantId: Object.fromEntries(sibs.map((s) => [s.variantId, s])),
    productSiblings: { [PROD]: sibs },
  };
});

describe("planRefillPriceRestore", () => {
  it("restores the matched refill variant and cascades to on-sale siblings only once", async () => {
    const lines = [
      line({ match_type: "exact_refill", invoice_sku: "BE-001-BLK", matched_variant_id: V_BLACK }),
      // Same product, different size (also a refill) — should NOT re-emit siblings
      line({ match_type: "exact_refill", invoice_sku: "BE-001-NAV", matched_variant_id: V_NAVY }),
    ];

    const plan = await planRefillPriceRestore(lines, stubFetcher);

    expect(stubFetcher).toHaveBeenCalledWith([PROD, PROD]);
    // Both matched variants restored
    expect(plan.summary.restored).toBe(2);
    const black = plan.byKey["BE-001-BLK"];
    const navy = plan.byKey["BE-001-NAV"];
    expect(black.state).toBe("restored");
    expect(black.new_price).toBe(120);
    expect(black.new_compare_at).toBeNull();
    // Siblings cascaded only on the FIRST line (productHandled set)
    const sibIds = (black.sibling_variants ?? []).map((s) => s.variant_id);
    expect(sibIds).toContain(V_NAVY);
    expect(sibIds).not.toContain(V_WHITE); // not on sale
    expect(navy.sibling_variants).toEqual([]); // already handled
  });

  it("handles new_variant lines (no variant id) by cascading to on-sale siblings", async () => {
    const plan = await planRefillPriceRestore(
      [line({ match_type: "new_variant", matched_variant_id: null, invoice_sku: "BE-001-XL" })],
      stubFetcher,
    );

    const entry = plan.byKey["BE-001-XL"];
    expect(entry.state).toBe("no_change"); // the new variant itself doesn't exist yet
    const sibs = (entry.sibling_variants ?? []).map((s) => s.variant_id).sort();
    // Both on-sale variants of the parent product cascade
    expect(sibs).toEqual([V_BLACK, V_NAVY].sort());
  });

  it("skips lines with missing product, missing RRP, or RRP lower than current price", async () => {
    const lines = [
      line({ match_type: "exact_refill", matched_product_id: null, matched_variant_id: null, invoice_sku: "NO-PROD" }),
      line({ match_type: "exact_refill", invoice_rrp: null, invoice_sku: "NO-RRP" }),
      // Current price 90, invoice RRP 80 → must NOT reduce
      line({ match_type: "exact_refill", invoice_rrp: 80, matched_variant_id: V_WHITE, invoice_sku: "LOWER" }),
    ];
    const plan = await planRefillPriceRestore(lines, stubFetcher);
    expect(plan.byKey["NO-PROD"].state).toBe("skipped_no_match");
    expect(plan.byKey["NO-RRP"].state).toBe("skipped_no_rrp");
    expect(plan.byKey["LOWER"].state).toBe("skipped_lower");
  });
});
