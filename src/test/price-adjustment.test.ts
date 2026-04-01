import { describe, it, expect } from "vitest";
import {
  adjustProduct, adjustProducts, matchesFilter, applyPriceRounding,
  type ProductForAdjustment, type AdjustmentRule, type AdjustmentFilter,
  DEFAULT_FILTER, DEFAULT_RULE,
} from "@/lib/price-adjustment";

const makeProduct = (overrides: Partial<ProductForAdjustment> = {}): ProductForAdjustment => ({
  handle: "test", title: "Test Product", vendor: "Brand", type: "One Piece",
  tags: ["full_price"], currentPrice: 100, compareAtPrice: null, costPrice: 30,
  ...overrides,
});

describe("Price Adjustment Engine", () => {
  it("applies percentage discount", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 199.95 }), {
      ...DEFAULT_RULE, type: "percent_discount", value: 20, rounding: "none",
    });
    expect(result.newPrice).toBeCloseTo(159.96, 2);
    expect(result.changePercent).toBeCloseTo(-20, 0);
  });

  it("applies percentage markup", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 100 }), {
      ...DEFAULT_RULE, type: "percent_markup", value: 10, rounding: "none",
    });
    expect(result.newPrice).toBe(110);
  });

  it("sets exact price", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 199.95 }), {
      ...DEFAULT_RULE, type: "set_exact", value: 49.95, rounding: "none",
    });
    expect(result.newPrice).toBe(49.95);
  });

  it("multiplies by factor", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 100 }), {
      ...DEFAULT_RULE, type: "multiply_by", value: 2.5, rounding: "none",
    });
    expect(result.newPrice).toBe(250);
  });

  it("applies charm rounding (.95)", () => {
    expect(applyPriceRounding(119.96, "charm_95")).toBe(119.95);
    expect(applyPriceRounding(123.40, "charm_95")).toBe(122.95);
    expect(applyPriceRounding(148.20, "charm_95")).toBe(147.95);
  });

  it("applies price floor", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 29.95 }), {
      ...DEFAULT_RULE, type: "percent_discount", value: 30, rounding: "none", floor: 25,
    });
    expect(result.newPrice).toBe(25);
    expect(result.floorApplied).toBe(true);
  });

  it("applies margin floor", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 100, costPrice: 50 }), {
      ...DEFAULT_RULE, type: "percent_discount", value: 60, rounding: "none", marginFloor: 40,
    });
    // Min price = 50 / (1 - 0.4) = 83.33, discount would give 40
    expect(result.newPrice).toBeGreaterThan(80);
    expect(result.floorApplied).toBe(true);
  });

  it("detects below-cost pricing", () => {
    const result = adjustProduct(makeProduct({ currentPrice: 100, costPrice: 50 }), {
      ...DEFAULT_RULE, type: "percent_discount", value: 60, rounding: "none",
    });
    expect(result.newPrice).toBe(40);
    expect(result.belowCost).toBe(true);
  });

  it("filters by brand", () => {
    const products = [
      makeProduct({ handle: "a", vendor: "Bond Eye" }),
      makeProduct({ handle: "b", vendor: "Seafolly" }),
    ];
    const filter: AdjustmentFilter = { ...DEFAULT_FILTER, scope: "brand", brands: ["Bond Eye"] };
    expect(products.filter(p => matchesFilter(p, filter))).toHaveLength(1);
  });

  it("calculates batch summary", () => {
    const products = [
      makeProduct({ handle: "a", currentPrice: 100 }),
      makeProduct({ handle: "b", currentPrice: 200 }),
    ];
    const { summary } = adjustProducts(products, DEFAULT_FILTER, {
      ...DEFAULT_RULE, type: "percent_discount", value: 20, rounding: "none",
    });
    expect(summary.affected).toBe(2);
    expect(summary.totalBefore).toBe(300);
    expect(summary.totalAfter).toBe(240);
    expect(summary.difference).toBe(-60);
  });
});
