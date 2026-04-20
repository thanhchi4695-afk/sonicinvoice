// ── Price Adjustment Engine ──

export type AdjustmentType = "percent_discount" | "percent_markup" | "set_exact" | "multiply_by";
export type AdjustField = "price" | "compare_at" | "both" | "cost";
export type PriceRounding = "none" | "nearest_05" | "nearest_1" | "charm_95" | "nearest_5" | "nearest_10" | "custom";

export interface AdjustmentFilter {
  scope: "all" | "brand" | "type" | "tag" | "price_range" | "selected";
  brands: string[];
  types: string[];
  tags: string[];
  priceMin: number | null;
  priceMax: number | null;
}

export interface AdjustmentRule {
  field: AdjustField;
  type: AdjustmentType;
  value: number;
  rounding: PriceRounding;
  customRoundValue: number;
  floor: number | null;
  ceiling: number | null;
  marginFloor: number | null;
}

export interface AdjustmentTemplate {
  id: string;
  name: string;
  filter: AdjustmentFilter;
  rule: AdjustmentRule;
  createdAt: string;
}

export interface ProductForAdjustment {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string[];
  currentPrice: number;
  compareAtPrice: number | null;
  costPrice: number;
  /** Optional: SKU used for Supabase lookup when persisting */
  sku?: string;
  /** Optional: Shopify variant GID (gid://shopify/ProductVariant/...) */
  shopifyVariantId?: string;
}

export interface AdjustedProduct extends ProductForAdjustment {
  newPrice: number;
  newCompareAt: number | null;
  changePercent: number;
  floorApplied: boolean;
  ceilingApplied: boolean;
  belowCost: boolean;
}

export interface AdjustmentSummary {
  affected: number;
  avgChange: number;
  totalBefore: number;
  totalAfter: number;
  difference: number;
  floored: number;
  belowCost: number;
}

export const DEFAULT_FILTER: AdjustmentFilter = {
  scope: "all", brands: [], types: [], tags: [],
  priceMin: null, priceMax: null,
};

export const DEFAULT_RULE: AdjustmentRule = {
  field: "price", type: "percent_discount", value: 20,
  rounding: "nearest_05", customRoundValue: 1,
  floor: null, ceiling: null, marginFloor: null,
};

// ── Rounding ──

export function applyPriceRounding(price: number, rounding: PriceRounding, customVal = 1): number {
  switch (rounding) {
    case "none": return Math.round(price * 100) / 100;
    case "nearest_05": return Math.round(price * 20) / 20;
    case "nearest_1": return Math.round(price);
    case "nearest_5": return Math.round(price / 5) * 5;
    case "nearest_10": return Math.round(price / 10) * 10;
    case "charm_95": {
      const d = Math.floor(price);
      return price - d >= 0.95 ? d + 0.95 : (d > 0 ? d - 1 + 0.95 : 0.95);
    }
    case "custom": return customVal > 0 ? Math.round(price / customVal) * customVal : Math.round(price * 100) / 100;
    default: return Math.round(price * 100) / 100;
  }
}

// ── Core calculation ──

function calcAdjustedValue(current: number, type: AdjustmentType, value: number): number {
  switch (type) {
    case "percent_discount": return current * (1 - value / 100);
    case "percent_markup": return current * (1 + value / 100);
    case "set_exact": return value;
    case "multiply_by": return current * value;
    default: return current;
  }
}

// ── Filter matching ──

export function matchesFilter(p: ProductForAdjustment, filter: AdjustmentFilter): boolean {
  if (filter.scope === "all") return true;
  if (filter.scope === "brand" && filter.brands.length > 0)
    return filter.brands.some(b => b.toLowerCase() === p.vendor.toLowerCase());
  if (filter.scope === "type" && filter.types.length > 0)
    return filter.types.some(t => t.toLowerCase() === p.type.toLowerCase());
  if (filter.scope === "tag" && filter.tags.length > 0)
    return filter.tags.some(tag => p.tags.some(pt => pt.toLowerCase() === tag.toLowerCase()));
  if (filter.scope === "price_range") {
    if (filter.priceMin !== null && p.currentPrice < filter.priceMin) return false;
    if (filter.priceMax !== null && p.currentPrice > filter.priceMax) return false;
    return true;
  }
  return true;
}

// ── Apply adjustment to a single product ──

export function adjustProduct(p: ProductForAdjustment, rule: AdjustmentRule): AdjustedProduct {
  let newPrice = p.currentPrice;
  let newCompareAt = p.compareAtPrice;

  if (rule.field === "price" || rule.field === "both") {
    newPrice = calcAdjustedValue(p.currentPrice, rule.type, rule.value);
    newPrice = applyPriceRounding(Math.max(newPrice, 0), rule.rounding, rule.customRoundValue);
  }
  if (rule.field === "compare_at" || rule.field === "both") {
    const base = p.compareAtPrice ?? p.currentPrice;
    newCompareAt = calcAdjustedValue(base, rule.type, rule.value);
    newCompareAt = applyPriceRounding(Math.max(newCompareAt, 0), rule.rounding, rule.customRoundValue);
  }

  let floorApplied = false;
  let ceilingApplied = false;

  // Margin floor
  if (rule.marginFloor !== null && p.costPrice > 0) {
    const minFromMargin = p.costPrice / (1 - rule.marginFloor / 100);
    if (newPrice < minFromMargin) {
      newPrice = applyPriceRounding(minFromMargin, rule.rounding, rule.customRoundValue);
      floorApplied = true;
    }
  }

  if (rule.floor !== null && newPrice < rule.floor) {
    newPrice = rule.floor;
    floorApplied = true;
  }
  if (rule.ceiling !== null && newPrice > rule.ceiling) {
    newPrice = rule.ceiling;
    ceilingApplied = true;
  }

  const belowCost = p.costPrice > 0 && newPrice < p.costPrice;
  const changePercent = p.currentPrice > 0 ? ((newPrice - p.currentPrice) / p.currentPrice) * 100 : 0;

  return { ...p, newPrice, newCompareAt, changePercent, floorApplied, ceilingApplied, belowCost };
}

// ── Batch adjust ──

export function adjustProducts(
  products: ProductForAdjustment[],
  filter: AdjustmentFilter,
  rule: AdjustmentRule
): { adjusted: AdjustedProduct[]; summary: AdjustmentSummary } {
  const matched = products.filter(p => matchesFilter(p, filter));
  const adjusted = matched.map(p => adjustProduct(p, rule));

  const totalBefore = adjusted.reduce((s, p) => s + p.currentPrice, 0);
  const totalAfter = adjusted.reduce((s, p) => s + p.newPrice, 0);
  const changes = adjusted.map(p => p.changePercent);
  const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

  return {
    adjusted,
    summary: {
      affected: adjusted.length,
      avgChange: Math.round(avgChange * 10) / 10,
      totalBefore: Math.round(totalBefore * 100) / 100,
      totalAfter: Math.round(totalAfter * 100) / 100,
      difference: Math.round((totalAfter - totalBefore) * 100) / 100,
      floored: adjusted.filter(p => p.floorApplied).length,
      belowCost: adjusted.filter(p => p.belowCost).length,
    },
  };
}

// ── Templates storage ──

const TEMPLATES_KEY = "price_adjustment_templates";

export function loadTemplates(): AdjustmentTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]");
  } catch { return []; }
}

export function saveTemplate(template: AdjustmentTemplate): void {
  const all = loadTemplates();
  all.push(template);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
}

export function deleteTemplate(id: string): void {
  const all = loadTemplates().filter(t => t.id !== id);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
}
