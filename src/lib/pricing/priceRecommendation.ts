/**
 * Price Recommendation Service for Google Shopping
 *
 * Pure, synchronous engine that combines five signals to recommend an
 * optimal sale price for a single product. Async data (sell-through
 * velocity, competitor pricing) should be fetched by the caller and
 * passed in via `productData`.
 *
 * Factors considered:
 *   1. Inventory age      — older stock gets deeper discounts.
 *   2. Sell-through       — slow movers discount more, hot sellers less.
 *   3. Competitor pricing — beat by 5% if competitor is >=15% cheaper.
 *   4. Margin floor       — never priced below cost + 10%.
 *   5. Google AI ramp     — auto_pricing_min_price floor for Google's
 *                           automated discount system, ramping the
 *                           allowed discount window from 5% (testing)
 *                           up to 95% (full scale) over 7 days.
 *
 * The output `recommendedSalePrice` always satisfies BOTH the margin
 * floor and the Google AI ramp floor.
 */

// ───────────────────────────── Types ─────────────────────────────

export interface Product {
  id: string;
  /** ISO timestamp from Shopify product.createdAt. */
  createdAt: string;
  /** Current selling price in store currency. */
  currentPrice: number;
  /** Unit cost (COGS). Required for margin floor — pass 0 if unknown. */
  cost: number;
  /** Units sold across the lookback window (default 28 days). */
  unitsSold?: number;
  /** Lookback window length in days, used to derive units/week. */
  salesWindowDays?: number;
  /** Lowest competitor price observed for the same SKU/style. */
  competitorPrice?: number | null;
  /** Days since this product first went live in the Google feed. */
  daysOnGoogleFeed?: number;
  /** Optional pre-computed inventory age (days). Overrides createdAt. */
  inventoryAgeDays?: number;
}

export interface PriceRecommendation {
  currentPrice: number;
  recommendedSalePrice: number;
  discountPercentage: number;
  marginAfterDiscount: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  estimatedDailySalesIncrease: number;
  /** Floor for Google's auto-pricing AI (auto_pricing_min_price). */
  autoPricingMinPrice: number;
}

// ───────────────────────────── Tunables ─────────────────────────────

/** Minimum margin (10%) above cost — hard floor. */
const MIN_MARGIN_RATIO = 0.10;

/** Google AI ramp: testing window then full-scale window. */
const GOOGLE_AI_RAMP_TEST = 0.05;   // first 7 days max discount
const GOOGLE_AI_RAMP_FULL = 0.95;   // post-ramp max discount window
const GOOGLE_AI_RAMP_DAYS = 7;

/** Inventory-age driven base discount targets. */
const AGE_DISCOUNT_TIERS: Array<{ minDays: number; pct: number; phase: string }> = [
  { minDays: 90, pct: 0.60, phase: "Clearance (90d+)" },
  { minDays: 60, pct: 0.45, phase: "Clearance (60d+)" },
  { minDays: 45, pct: 0.30, phase: "Markdown (45d+)" },
  { minDays: 30, pct: 0.15, phase: "First markdown (30d+)" },
  { minDays: 0,  pct: 0.00, phase: "Full price" },
];

/** Velocity bucket thresholds in units/week. */
const VELOCITY_BUCKETS = {
  hot: 25,      // > 25/wk → reduce discount
  ok: 5,        // 5–25/wk → no adjustment
  slow: 1,      // 1–5/wk → small bump
  // < 1/wk → larger bump (covered in code)
};

// ──────────────────────────── Helpers ────────────────────────────

function daysBetween(iso: string, now = new Date()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const diff = now.getTime() - t;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function ageDiscount(days: number): { pct: number; phase: string } {
  for (const tier of AGE_DISCOUNT_TIERS) {
    if (days >= tier.minDays) return { pct: tier.pct, phase: tier.phase };
  }
  return { pct: 0, phase: "Full price" };
}

/**
 * Maximum discount allowed by Google's auto-pricing AI for this product
 * given how long it's been in the feed. Linear ramp 5% → 95% over 7 days.
 */
function googleAiMaxDiscount(daysOnFeed: number | undefined): number {
  const d = Math.max(0, daysOnFeed ?? 0);
  if (d <= 0) return GOOGLE_AI_RAMP_TEST;
  if (d >= GOOGLE_AI_RAMP_DAYS) return GOOGLE_AI_RAMP_FULL;
  const t = d / GOOGLE_AI_RAMP_DAYS;
  return GOOGLE_AI_RAMP_TEST + (GOOGLE_AI_RAMP_FULL - GOOGLE_AI_RAMP_TEST) * t;
}

// ─────────────────────── Main entry point ───────────────────────

export function calculateSaleRecommendation(
  productData: Product,
): PriceRecommendation {
  const currentPrice = Math.max(0, Number(productData.currentPrice) || 0);
  const cost = Math.max(0, Number(productData.cost) || 0);

  // 1. Inventory age
  const ageDays =
    productData.inventoryAgeDays ?? daysBetween(productData.createdAt);
  const { pct: ageBaseDiscount, phase: agePhase } = ageDiscount(ageDays);

  // 2. Sell-through velocity (units / week)
  const windowDays = productData.salesWindowDays ?? 28;
  const unitsSold = Math.max(0, productData.unitsSold ?? 0);
  const unitsPerWeek = windowDays > 0 ? (unitsSold / windowDays) * 7 : 0;

  let velocityAdj = 0;
  let velocityNote = "";
  if (unitsPerWeek >= VELOCITY_BUCKETS.hot) {
    velocityAdj = -0.10;
    velocityNote = `hot seller (${unitsPerWeek.toFixed(1)}/wk)`;
  } else if (unitsPerWeek >= VELOCITY_BUCKETS.ok) {
    velocityAdj = 0;
    velocityNote = `steady (${unitsPerWeek.toFixed(1)}/wk)`;
  } else if (unitsPerWeek >= VELOCITY_BUCKETS.slow) {
    velocityAdj = 0.05;
    velocityNote = `slow (${unitsPerWeek.toFixed(1)}/wk)`;
  } else {
    velocityAdj = 0.10;
    velocityNote = `stalled (${unitsPerWeek.toFixed(1)}/wk)`;
  }

  // High-volume backlog bump (per spec: units > 200 → deeper discount)
  let volumeNote = "";
  if (unitsSold > 200) {
    velocityAdj += 0.05;
    volumeNote = `, large backlog (${unitsSold} units sold/in window)`;
  }

  // 3. Competitor gap
  let competitorAdj = 0;
  let competitorNote = "";
  let competitorTargetPrice: number | null = null;
  const cp = productData.competitorPrice;
  if (cp != null && cp > 0 && currentPrice > 0) {
    const gap = (currentPrice - cp) / currentPrice; // positive => we're more expensive
    if (gap >= 0.15) {
      // Competitor is at least 15% cheaper → match and beat by 5%.
      competitorTargetPrice = round2(cp * 0.95);
      const matchedDiscount = (currentPrice - competitorTargetPrice) / currentPrice;
      competitorAdj = Math.max(0, matchedDiscount - (ageBaseDiscount + velocityAdj));
      competitorNote = `competitor at ${cp.toFixed(2)} (${(gap * 100).toFixed(0)}% lower) — beat by 5%`;
    } else if (gap <= -0.10) {
      // We're already cheaper — no extra discount needed.
      competitorAdj = -0.05;
      competitorNote = `priced ${Math.abs(gap * 100).toFixed(0)}% below competitor`;
    } else {
      competitorNote = `within ${(Math.abs(gap) * 100).toFixed(0)}% of competitor`;
    }
  }

  // Combined target discount before applying floors.
  let targetDiscount = ageBaseDiscount + velocityAdj + competitorAdj;
  targetDiscount = clamp(targetDiscount, 0, 0.95);

  // 4. Margin floor (cost + 10%)
  const marginFloorPrice = cost > 0 ? round2(cost * (1 + MIN_MARGIN_RATIO)) : 0;

  // 5. Google AI ramp floor (auto_pricing_min_price). The "min price" is
  //    the lowest price Google AI is allowed to drop to — which equals
  //    currentPrice * (1 - maxAllowedDiscount).
  const googleMaxDiscount = googleAiMaxDiscount(productData.daysOnGoogleFeed);
  const googleAiFloorPrice = round2(currentPrice * (1 - googleMaxDiscount));

  // The hardest floor wins.
  const hardFloor = Math.max(marginFloorPrice, googleAiFloorPrice);

  // Compute candidate price from target discount, then clamp to floor.
  let candidate = round2(currentPrice * (1 - targetDiscount));
  let floorHit: "margin" | "google" | null = null;
  if (candidate < hardFloor) {
    candidate = hardFloor;
    floorHit =
      marginFloorPrice >= googleAiFloorPrice ? "margin" : "google";
  }

  // Never recommend an INCREASE — cap at currentPrice.
  candidate = Math.min(candidate, currentPrice);

  const recommendedSalePrice = round2(candidate);
  const discountPercentage =
    currentPrice > 0
      ? round2(((currentPrice - recommendedSalePrice) / currentPrice) * 100)
      : 0;

  // Margin after discount: (price - cost) / price.
  const marginAfterDiscount =
    recommendedSalePrice > 0 && cost > 0
      ? round2(((recommendedSalePrice - cost) / recommendedSalePrice) * 100)
      : recommendedSalePrice > 0
        ? 100
        : 0;

  // Confidence — high when we have cost + velocity + competitor data.
  const haveCost = cost > 0;
  const haveVelocity = unitsSold > 0;
  const haveCompetitor = cp != null && cp > 0;
  const signals = [haveCost, haveVelocity, haveCompetitor].filter(Boolean).length;
  const confidence: PriceRecommendation["confidence"] =
    signals >= 3 ? "high" : signals === 2 ? "medium" : "low";

  // Estimated daily sales increase: simple price-elasticity proxy
  // assuming -1.5 elasticity for fashion.
  const elasticity = -1.5;
  const priceChangePct = currentPrice > 0
    ? (recommendedSalePrice - currentPrice) / currentPrice
    : 0;
  const demandChangePct = elasticity * priceChangePct;
  const dailyBaseline = unitsPerWeek / 7;
  const estimatedDailySalesIncrease = round2(
    Math.max(0, dailyBaseline * demandChangePct),
  );

  // Reason string
  const parts = [
    `${agePhase} (age ${ageDays}d)`,
    velocityNote,
  ];
  if (volumeNote) parts.push(volumeNote.replace(/^,\s*/, ""));
  if (competitorNote) parts.push(competitorNote);
  if (floorHit === "margin") parts.push(`margin floor at ${marginFloorPrice.toFixed(2)}`);
  if (floorHit === "google")
    parts.push(
      `Google AI ramp floor (${(googleMaxDiscount * 100).toFixed(0)}% max @ day ${productData.daysOnGoogleFeed ?? 0})`,
    );
  if (competitorTargetPrice != null && floorHit !== "margin")
    parts.push(`competitor target ${competitorTargetPrice.toFixed(2)}`);

  const reason = parts.filter(Boolean).join(" · ");

  return {
    currentPrice: round2(currentPrice),
    recommendedSalePrice,
    discountPercentage,
    marginAfterDiscount,
    confidence,
    reason,
    estimatedDailySalesIncrease,
    autoPricingMinPrice: round2(Math.max(marginFloorPrice, googleAiFloorPrice)),
  };
}

// Re-export under the spec'd name as well.
export default calculateSaleRecommendation;
