/**
 * Competitive Pricing Engine — Lifecycle & Scoring (Phase 1, MVP)
 *
 * Pure functions only. No I/O, no side effects. Easy to unit test.
 *
 * Industry coverage at launch: swimwear & fashion.
 * Output: a Recommendation object the UI can render.
 *
 * Lifecycle Phases (days_in_inventory):
 *   1. Launch          (0–13)    → no discount, alert only
 *   2. First Mark      (14–29)   → 5–10% discount
 *   3. Performance     (30–44)   → hold + monitor
 *   4. Clearance       (45–59)   → 30–60% discount
 *   5. Cleanse         (60+)     → 70%+ "last chance"
 *
 * Discount Score (0–100):
 *   0.40 * lifecyclePressure
 * + 0.30 * competitorGap
 * + 0.20 * velocityPressure
 * + 0.10 * marginHeadroom
 *
 * Margin floor is a hard cap — recommended price never drops below it.
 */

export type LifecyclePhase = 1 | 2 | 3 | 4 | 5;

export interface PricingInput {
  /** Current Shopify selling price (the price customers pay today). */
  currentPrice: number;
  /** Unit cost (COGS). Used to enforce margin floor. */
  unitCost: number;
  /** Days the product has been live / in inventory. */
  daysInInventory: number;
  /** Average units sold per week, last 30 days. Optional — placeholder used when missing. */
  avgWeeklySales?: number;
  /** Units currently on hand. Used by what-if simulator. */
  stockOnHand?: number;
  /** Optional competitor reference price (from competitorScraper). */
  competitorPrice?: number;
  /** Minimum gross margin merchant is willing to accept (0.20 = 20%). Default 0.15. */
  minMarginPct?: number;
}

export interface Recommendation {
  phase: LifecyclePhase;
  phaseName: string;
  recommendedDiscountPct: number; // 0–1
  recommendedPrice: number;
  marginFloorPrice: number;
  blockedByMarginFloor: boolean;
  score: number; // 0–100
  reasons: string[];
  competitorGapPct: number | null; // negative = we're more expensive
  alertOnly: boolean;
}

const PHASE_NAMES: Record<LifecyclePhase, string> = {
  1: "Launch",
  2: "First Mark",
  3: "Performance Check",
  4: "Clearance Push",
  5: "Final Cleanse",
};

/** Per-phase suggested discount band: [min, max]. */
const PHASE_BANDS: Record<LifecyclePhase, [number, number]> = {
  1: [0, 0],
  2: [0.05, 0.10],
  3: [0, 0.05],
  4: [0.30, 0.60],
  5: [0.70, 0.85],
};

export function getPhase(daysInInventory: number): LifecyclePhase {
  if (daysInInventory < 14) return 1;
  if (daysInInventory < 30) return 2;
  if (daysInInventory < 45) return 3;
  if (daysInInventory < 60) return 4;
  return 5;
}

/** Returns 0–1 pressure based on how deep into the lifecycle we are. */
function lifecyclePressure(phase: LifecyclePhase): number {
  return { 1: 0.0, 2: 0.25, 3: 0.4, 4: 0.75, 5: 1.0 }[phase];
}

/** Returns 0–1 — higher when competitor is materially cheaper than us. */
function competitorPressure(currentPrice: number, competitorPrice?: number): number {
  if (!competitorPrice || competitorPrice <= 0) return 0;
  const gap = (currentPrice - competitorPrice) / currentPrice; // positive = we're more expensive
  if (gap <= 0) return 0;
  // Cap at 30% gap = full pressure
  return Math.min(1, gap / 0.30);
}

/** Returns 0–1 — higher when sales are slow vs. inventory. */
function velocityPressure(input: PricingInput): number {
  const v = input.avgWeeklySales ?? 0;
  const stock = input.stockOnHand ?? 0;
  if (v <= 0 && stock > 0) return 1; // zero sales but stock exists
  if (v <= 0) return 0.5; // no data — neutral-leaning
  const weeksOfCover = stock / v;
  if (weeksOfCover <= 4) return 0;
  if (weeksOfCover >= 16) return 1;
  return (weeksOfCover - 4) / 12;
}

/** Returns 0–1 — how much room we have above margin floor. */
function marginHeadroom(currentPrice: number, unitCost: number, minMarginPct: number): number {
  const floor = unitCost / (1 - minMarginPct);
  if (currentPrice <= floor) return 0;
  return Math.min(1, (currentPrice - floor) / currentPrice);
}

export function recommendPrice(input: PricingInput): Recommendation {
  const minMarginPct = input.minMarginPct ?? 0.15;
  const phase = getPhase(input.daysInInventory);
  const phaseName = PHASE_NAMES[phase];

  const marginFloorPrice = +(input.unitCost / (1 - minMarginPct)).toFixed(2);

  const lp = lifecyclePressure(phase);
  const cp = competitorPressure(input.currentPrice, input.competitorPrice);
  const vp = velocityPressure(input);
  const mh = marginHeadroom(input.currentPrice, input.unitCost, minMarginPct);

  const score = Math.round((0.4 * lp + 0.3 * cp + 0.2 * vp + 0.1 * mh) * 100);

  // Pick discount within phase band, modulated by competitor + velocity pressure.
  const [bandMin, bandMax] = PHASE_BANDS[phase];
  const pressureBlend = (cp + vp) / 2; // 0–1
  let suggestedDiscount = bandMin + (bandMax - bandMin) * pressureBlend;

  // Phase 1 — alert-only mode: never auto-discount.
  const alertOnly = phase === 1;
  if (alertOnly) suggestedDiscount = 0;

  let recommendedPrice = +(input.currentPrice * (1 - suggestedDiscount)).toFixed(2);
  let blockedByMarginFloor = false;
  if (recommendedPrice < marginFloorPrice) {
    recommendedPrice = marginFloorPrice;
    blockedByMarginFloor = true;
    suggestedDiscount = +(1 - marginFloorPrice / input.currentPrice).toFixed(2);
    if (suggestedDiscount < 0) suggestedDiscount = 0;
  }

  const competitorGapPct =
    input.competitorPrice && input.competitorPrice > 0
      ? +(((input.competitorPrice - input.currentPrice) / input.currentPrice) * 100).toFixed(1)
      : null;

  const reasons: string[] = [];
  reasons.push(`Phase ${phase}: ${phaseName} — ${input.daysInInventory} days in inventory.`);
  if (cp > 0 && competitorGapPct !== null) {
    reasons.push(
      competitorGapPct < 0
        ? `Competitor is ${Math.abs(competitorGapPct)}% cheaper.`
        : `We are competitively priced (${competitorGapPct}% above competitor).`,
    );
  }
  if (vp >= 0.6) reasons.push("Sell-through is slow vs. stock on hand.");
  if (blockedByMarginFloor) reasons.push(`Capped at margin floor (${(minMarginPct * 100).toFixed(0)}% gross).`);
  if (alertOnly) reasons.push("Launch phase — monitoring only, no discount applied.");

  return {
    phase,
    phaseName,
    recommendedDiscountPct: +suggestedDiscount.toFixed(3),
    recommendedPrice,
    marginFloorPrice,
    blockedByMarginFloor,
    score,
    reasons,
    competitorGapPct,
    alertOnly,
  };
}

/* ──────────────────────────────────────────────────────────────────
 * What-if simulator (Option B from the plan)
 *
 *   projected_weekly_sales =
 *     avg_weekly_sales * (1 + elasticity * discount_pct)
 *
 * Default elasticity = 2.0 (every 10% off → +20% units).
 * ────────────────────────────────────────────────────────────────── */

export interface WhatIfInput {
  currentPrice: number;
  unitCost: number;
  avgWeeklySales: number;
  stockOnHand: number;
  discountPct: number; // 0–1
  elasticity?: number; // default 2.0
  horizonDays?: number; // default 7
}

export interface WhatIfResult {
  newPrice: number;
  projectedUnitsInHorizon: number;
  projectedRevenue: number;
  projectedGrossMargin: number;
  projectedSellThroughPct: number; // of stock on hand
  weeksToClear: number | null;
}

export function simulateWhatIf(input: WhatIfInput): WhatIfResult {
  const elasticity = input.elasticity ?? 2.0;
  const horizonDays = input.horizonDays ?? 7;
  const discount = Math.max(0, Math.min(1, input.discountPct));

  const newPrice = +(input.currentPrice * (1 - discount)).toFixed(2);
  const weeklyMultiplier = Math.max(0, 1 + elasticity * discount);
  const projectedWeekly = input.avgWeeklySales * weeklyMultiplier;
  const horizonWeeks = horizonDays / 7;
  const rawProjected = projectedWeekly * horizonWeeks;
  const projectedUnits = Math.min(input.stockOnHand, +rawProjected.toFixed(2));

  const projectedRevenue = +(projectedUnits * newPrice).toFixed(2);
  const projectedMargin = +(projectedUnits * (newPrice - input.unitCost)).toFixed(2);
  const sellThroughPct =
    input.stockOnHand > 0 ? +((projectedUnits / input.stockOnHand) * 100).toFixed(1) : 0;
  const weeksToClear =
    projectedWeekly > 0 ? +(input.stockOnHand / projectedWeekly).toFixed(1) : null;

  return {
    newPrice,
    projectedUnitsInHorizon: projectedUnits,
    projectedRevenue,
    projectedGrossMargin: projectedMargin,
    projectedSellThroughPct: sellThroughPct,
    weeksToClear,
  };
}
