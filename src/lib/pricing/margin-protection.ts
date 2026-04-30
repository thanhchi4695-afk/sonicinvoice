/**
 * Margin Protection — Pure Functions (Phase 1)
 *
 * Hard, non-negotiable business rules used by the AI Pricing Orchestrator.
 * These are intentionally side-effect-free so they can be unit-tested and
 * called from both the client and edge functions (Deno-safe).
 *
 * Rule: floor price = costPrice * 1.05  (covers transaction fees).
 * No recommendation may ever drop the sell price below the floor.
 *
 * NOTE: this is distinct from `src/lib/margin-protection.ts`, which is the
 * UI-level (localStorage-backed) margin settings + audit-log layer.
 * This module owns only the math.
 */

export const FEE_BUFFER = 0.05; // 5% above cost — transaction fees

export type MarginStatus = "safe" | "at_risk" | "breached";

export interface MarginStatusResult {
  status: MarginStatus;
  costPrice: number | null;
  currentPrice: number;
  floorPrice: number | null;
  marginPct: number | null; // gross margin %, null when cost unknown
  reason: string;
}

export interface MarginProductInput {
  currentPrice: number;
  costPrice?: number | null;
}

/** Absolute minimum sell price a product is allowed to be discounted to. */
export function calculateFloorPrice(costPrice: number): number {
  if (!costPrice || costPrice <= 0 || !Number.isFinite(costPrice)) return 0;
  return +(costPrice * (1 + FEE_BUFFER)).toFixed(2);
}

/** True if currentPrice is at or above the floor. False when cost is unknown. */
export function isMarginProtected(currentPrice: number, costPrice: number): boolean {
  if (!costPrice || costPrice <= 0) return false;
  return currentPrice >= calculateFloorPrice(costPrice);
}

/** Gross margin percentage (0–100). null if price/cost missing. */
export function calculateMarginPct(currentPrice: number, costPrice: number): number | null {
  if (!currentPrice || currentPrice <= 0) return null;
  if (!costPrice || costPrice <= 0) return null;
  return +(((currentPrice - costPrice) / currentPrice) * 100).toFixed(2);
}

/**
 * Classify a product's margin health.
 *  - breached : current price < floor (selling at/under cost+fees)
 *  - at_risk  : within 3% of the floor
 *  - safe     : comfortably above floor
 *  - at_risk  : also returned when no cost data exists, so the UI can flag it
 */
export function getMarginStatus(product: MarginProductInput): MarginStatusResult {
  const { currentPrice } = product;
  const costPrice = product.costPrice ?? null;

  if (!costPrice || costPrice <= 0) {
    return {
      status: "at_risk",
      costPrice: null,
      currentPrice,
      floorPrice: null,
      marginPct: null,
      reason: "No cost price on file — margin cannot be verified.",
    };
  }

  const floorPrice = calculateFloorPrice(costPrice);
  const marginPct = calculateMarginPct(currentPrice, costPrice);

  if (currentPrice < floorPrice) {
    return {
      status: "breached",
      costPrice,
      currentPrice,
      floorPrice,
      marginPct,
      reason: `Selling at $${currentPrice.toFixed(2)} — below floor of $${floorPrice.toFixed(2)} (cost + ${(FEE_BUFFER * 100).toFixed(0)}% fees).`,
    };
  }

  // Within 3% of floor → at risk.
  const cushion = (currentPrice - floorPrice) / floorPrice;
  if (cushion < 0.03) {
    return {
      status: "at_risk",
      costPrice,
      currentPrice,
      floorPrice,
      marginPct,
      reason: `Only $${(currentPrice - floorPrice).toFixed(2)} above floor — discounting room is minimal.`,
    };
  }

  return {
    status: "safe",
    costPrice,
    currentPrice,
    floorPrice,
    marginPct,
    reason: `Margin is healthy (${marginPct?.toFixed(1)}% gross, $${(currentPrice - floorPrice).toFixed(2)} above floor).`,
  };
}

/**
 * Clamp a proposed sale price so it never falls below the floor.
 * Returns the clamped price and a flag indicating whether clamping occurred.
 */
export function enforceFloor(
  proposedPrice: number,
  costPrice: number | null | undefined,
): { price: number; clamped: boolean; floorPrice: number | null } {
  if (!costPrice || costPrice <= 0) {
    return { price: proposedPrice, clamped: false, floorPrice: null };
  }
  const floorPrice = calculateFloorPrice(costPrice);
  if (proposedPrice < floorPrice) {
    return { price: floorPrice, clamped: true, floorPrice };
  }
  return { price: proposedPrice, clamped: false, floorPrice };
}
