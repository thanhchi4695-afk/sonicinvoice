// Auto Pricing Strategy Engine — client-side, instant calculations

/* ─── types ─── */
export interface PricingInput {
  costPrice: number;
  productType: string;
  vendor?: string;
  competitorPrice?: number;
}

export interface PricingRules {
  mode: "markup" | "margin";
  value: number; // markup multiplier (e.g. 2.5) or margin % (e.g. 60)
  rounding: "psychological" | "clean" | "none";
  minMarginPercent: number; // floor e.g. 30
}

export interface PricingResult {
  recommended_price: number;
  min_price: number;
  max_price: number;
  margin_percentage: number;
  markup_multiple: number;
  pricing_strategy_used: string;
  confidence_score: number;
  pricing_reason: string;
}

/* ─── category markup ranges ─── */
const CATEGORY_MARKUP: Record<string, { low: number; mid: number; high: number }> = {
  dresses:      { low: 2.2, mid: 2.5, high: 2.8 },
  tops:         { low: 2.0, mid: 2.4, high: 2.8 },
  pants:        { low: 2.0, mid: 2.3, high: 2.6 },
  shorts:       { low: 2.0, mid: 2.3, high: 2.6 },
  skirts:       { low: 2.0, mid: 2.4, high: 2.8 },
  swimwear:     { low: 2.2, mid: 2.4, high: 2.6 },
  shoes:        { low: 2.0, mid: 2.2, high: 2.5 },
  bags:         { low: 2.5, mid: 3.0, high: 3.5 },
  accessories:  { low: 2.5, mid: 3.0, high: 3.5 },
  jewellery:    { low: 2.5, mid: 3.0, high: 3.5 },
  hats:         { low: 2.0, mid: 2.5, high: 3.0 },
  jackets:      { low: 2.0, mid: 2.3, high: 2.6 },
  knitwear:     { low: 2.0, mid: 2.3, high: 2.6 },
  activewear:   { low: 2.0, mid: 2.3, high: 2.6 },
  sleepwear:    { low: 2.0, mid: 2.3, high: 2.6 },
  lingerie:     { low: 2.2, mid: 2.5, high: 2.8 },
  homewares:    { low: 2.0, mid: 2.5, high: 3.0 },
  gifts:        { low: 2.0, mid: 2.5, high: 3.0 },
  general:      { low: 2.0, mid: 2.4, high: 2.8 },
};

function getCategoryMarkup(type: string): { low: number; mid: number; high: number } {
  const key = type.toLowerCase().replace(/\s+/g, "");
  return CATEGORY_MARKUP[key] || CATEGORY_MARKUP.general;
}

/* ─── rounding ─── */
export function roundPsychological(price: number): number {
  if (price <= 0) return 0;
  if (price < 15) return Math.ceil(price) - 0.05;
  if (price < 30) return Math.round(price / 5) * 5 - 0.05;
  if (price < 100) {
    // Target nearest 9.95 tier: 29.95, 39.95, 49.95 etc.
    const tens = Math.round(price / 10) * 10;
    return tens - 0.05;
  }
  if (price < 200) {
    const tens = Math.round(price / 10) * 10;
    return tens - 0.05;
  }
  // 200+ → nearest 10 - 0.05
  const tens = Math.round(price / 10) * 10;
  return tens - 0.05;
}

export function roundClean(price: number): number {
  if (price <= 0) return 0;
  if (price < 20) return Math.round(price);
  if (price < 100) return Math.round(price / 5) * 5;
  return Math.round(price / 10) * 10;
}

function applyRounding(price: number, mode: PricingRules["rounding"]): number {
  if (mode === "psychological") return roundPsychological(price);
  if (mode === "clean") return roundClean(price);
  return Math.round(price * 100) / 100;
}

/* ─── default rules ─── */
const PRICING_RULES_KEY = "pricing_rules_sonic_invoice";

export function getPricingRules(): PricingRules {
  try {
    const stored = JSON.parse(localStorage.getItem(PRICING_RULES_KEY) || "{}");
    return {
      mode: stored.mode || "markup",
      value: stored.value ?? 2.5,
      rounding: stored.rounding || "psychological",
      minMarginPercent: stored.minMarginPercent ?? 30,
    };
  } catch {
    return { mode: "markup", value: 2.5, rounding: "psychological", minMarginPercent: 30 };
  }
}

export function savePricingRules(rules: Partial<PricingRules>) {
  const current = getPricingRules();
  localStorage.setItem(PRICING_RULES_KEY, JSON.stringify({ ...current, ...rules }));
}

/* ─── main calculation ─── */
export function calculatePrice(input: PricingInput, rules?: PricingRules): PricingResult {
  const r = rules || getPricingRules();
  const cost = input.costPrice;

  if (cost <= 0) {
    return {
      recommended_price: 0, min_price: 0, max_price: 0,
      margin_percentage: 0, markup_multiple: 0,
      pricing_strategy_used: "none", confidence_score: 0,
      pricing_reason: "No cost price provided",
    };
  }

  const cat = getCategoryMarkup(input.productType);
  let strategies: string[] = [];
  let rawPrice: number;

  // Step 1: Base price from rules
  if (r.mode === "margin") {
    const marginFrac = r.value / 100;
    rawPrice = cost / (1 - marginFrac);
    strategies.push(`${r.value}% margin target`);
  } else {
    rawPrice = cost * r.value;
    strategies.push(`${r.value}x markup`);
  }

  // Step 2: Category adjustment — nudge toward category mid if significantly off
  const catMidPrice = cost * cat.mid;
  if (rawPrice < cost * cat.low) {
    rawPrice = cost * cat.low;
    strategies.push("category floor applied");
  }

  // Step 3: Competitor adjustment
  if (input.competitorPrice && input.competitorPrice > 0) {
    if (input.competitorPrice > rawPrice * 1.1) {
      // Competitor much higher — can push up slightly
      rawPrice = rawPrice * 1.05;
      strategies.push("premium positioning (competitor higher)");
    } else if (input.competitorPrice < rawPrice * 0.9) {
      // Competitor lower — match if above margin floor
      const competitorMatch = input.competitorPrice * 0.98;
      const minFloor = cost / (1 - r.minMarginPercent / 100);
      if (competitorMatch >= minFloor) {
        rawPrice = competitorMatch;
        strategies.push("competitive match");
      } else {
        rawPrice = minFloor;
        strategies.push("margin floor (competitor too low)");
      }
    }
  }

  // Step 4: Ensure minimum margin
  const minFloor = cost / (1 - r.minMarginPercent / 100);
  if (rawPrice < minFloor) {
    rawPrice = minFloor;
    strategies.push("min margin enforced");
  }

  // Step 5: Apply rounding
  const recommended = applyRounding(rawPrice, r.rounding);
  const minPrice = applyRounding(cost * cat.low, r.rounding);
  const maxPrice = applyRounding(cost * cat.high, r.rounding);

  // Final margin/markup
  const margin = ((recommended - cost) / recommended) * 100;
  const markup = recommended / cost;

  // Confidence
  let confidence = 50;
  const reasons: string[] = [];
  if (cost > 0) { confidence += 25; reasons.push("cost known"); }
  if (input.productType && input.productType !== "General") { confidence += 15; reasons.push("category matched"); }
  if (input.competitorPrice) { confidence += 10; reasons.push("competitor data"); }
  confidence = Math.min(100, confidence);

  return {
    recommended_price: Math.max(recommended, 0),
    min_price: Math.max(minPrice, 0),
    max_price: Math.max(maxPrice, recommended),
    margin_percentage: Math.round(margin * 10) / 10,
    markup_multiple: Math.round(markup * 100) / 100,
    pricing_strategy_used: strategies.join(" + "),
    confidence_score: confidence,
    pricing_reason: `Based on ${reasons.join(", ")}`,
  };
}

/* ─── bulk pricing ─── */
export function calculateBulkPrices(
  items: (PricingInput & { id: string })[],
  rules?: PricingRules,
): Map<string, PricingResult> {
  const results = new Map<string, PricingResult>();
  const r = rules || getPricingRules();
  for (const item of items) {
    results.set(item.id, calculatePrice(item, r));
  }
  return results;
}
