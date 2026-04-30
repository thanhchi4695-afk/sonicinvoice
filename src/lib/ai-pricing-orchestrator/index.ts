/**
 * AI Pricing Orchestrator — client-side
 *
 * Combines deterministic lifecycle/margin logic with an AI-generated
 * `reason` string so the merchant sees a plain-English justification
 * for every recommendation.
 *
 * Flow:
 *   1. Determine lifecycle phase from `daysInInventory`.
 *   2. Resolve cost & enforce margin floor (margin-protection.ts).
 *   3. Resolve competitor average price (resolveCompetitorPrice).
 *   4. Compute suggested action + discount band per phase.
 *   5. Call `ai-pricing-orchestrator` edge fn for natural-language reason.
 *
 * The math is deterministic, the AI is presentational. This guarantees
 * we NEVER recommend a price below the margin floor regardless of what
 * the LLM says.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  calculateFloorPrice,
  enforceFloor,
  getMarginStatus,
  type MarginStatus,
} from "@/lib/pricing/margin-protection";
import { resolveCompetitorPrice } from "@/lib/pricing/resolveCompetitorPrice";

export type LifecyclePhase = "launch" | "mid_life" | "clearance";
export type PricingAction = "HOLD" | "DISCOUNT" | "DEEP_DISCOUNT";

export interface AnalyzeProductInput {
  productId: string;
  title: string;
  currentPrice: number;
  costPrice?: number | null;
  /** Days since the product was first received / created. */
  daysInInventory: number;
  /** Optional Shopify product id (numeric or GID) for competitor cache lookup. */
  shopifyProductId?: string | null;
  sku?: string | null;
  /** Optional URL to live-scrape if no cached competitor price exists. */
  competitorUrl?: string | null;
  collection?: string | null;
  vendor?: string | null;
  /** Skip the AI call (useful for batch runs / tests). Returns a templated reason. */
  skipAi?: boolean;
}

export interface PricingRecommendation {
  productId: string;
  analysis: {
    currentPhase: LifecyclePhase;
    daysInInventory: number;
    currentPrice: number;
    floorPrice: number;
    marginStatus: MarginStatus;
    competitorAveragePrice: number | null;
    competitorPriceGap: number | null; // % — positive = we're more expensive
  };
  action: PricingAction;
  suggestedNewPrice: number | null;
  discountPercentage: number | null;
  /** True when the suggestion was capped at the margin floor. */
  marginFloorEnforced: boolean;
  reason: string;
}

// ── Lifecycle phase detection ───────────────────────────────────
export function getLifecyclePhase(daysInInventory: number): LifecyclePhase {
  if (daysInInventory <= 30) return "launch";
  if (daysInInventory <= 60) return "mid_life";
  return "clearance";
}

// ── Per-phase discount selection ────────────────────────────────
// Returns (action, discountPct as 0–1). DiscountPct of 0 = HOLD.
function chooseAction(
  phase: LifecyclePhase,
  competitorGapPct: number | null,
  marginStatus: MarginStatus,
): { action: PricingAction; discountPct: number } {
  // Margin breached overrides everything: never deepen a discount.
  if (marginStatus === "breached") {
    return { action: "HOLD", discountPct: 0 };
  }

  if (phase === "launch") {
    // Guardian mode: only react if a competitor is materially cheaper.
    if (competitorGapPct != null && competitorGapPct > 15) {
      return { action: "DISCOUNT", discountPct: 0.05 };
    }
    return { action: "HOLD", discountPct: 0 };
  }

  if (phase === "mid_life") {
    // Optimizer mode: 0–20% based on competitor gap.
    if (competitorGapPct == null) {
      return { action: "DISCOUNT", discountPct: 0.10 };
    }
    if (competitorGapPct <= 0) {
      // We're already at-or-below market — small nudge only.
      return { action: "HOLD", discountPct: 0 };
    }
    // Map gap of 0–30% → discount 0–20%
    const pct = Math.min(0.20, (competitorGapPct / 30) * 0.20);
    if (pct < 0.05) return { action: "HOLD", discountPct: 0 };
    return { action: "DISCOUNT", discountPct: +pct.toFixed(2) };
  }

  // clearance — Accelerator mode.
  // Base 30%, plus up to +20% if competitors are cheaper.
  const base = 0.30;
  const competitorBoost =
    competitorGapPct != null && competitorGapPct > 0
      ? Math.min(0.20, (competitorGapPct / 30) * 0.20)
      : 0;
  const pct = +Math.min(0.50, base + competitorBoost).toFixed(2);
  return { action: "DEEP_DISCOUNT", discountPct: pct };
}

// ── Templated fallback reason (no AI) ───────────────────────────
function templateReason(rec: Omit<PricingRecommendation, "reason">): string {
  const { analysis, action, suggestedNewPrice, discountPercentage } = rec;
  if (action === "HOLD") {
    return `This item is in its ${analysis.currentPhase.replace("_", "-")} phase (${analysis.daysInInventory} days in inventory) with a ${analysis.marginStatus} margin. Hold the current price of $${analysis.currentPrice.toFixed(2)}.`;
  }
  const gapText =
    analysis.competitorPriceGap != null
      ? ` We're priced ${analysis.competitorPriceGap.toFixed(1)}% ${analysis.competitorPriceGap > 0 ? "above" : "below"} competitors.`
      : "";
  return `After ${analysis.daysInInventory} days in inventory (${analysis.currentPhase.replace("_", "-")} phase), a ${discountPercentage?.toFixed(1)}% discount to $${suggestedNewPrice?.toFixed(2)} is recommended.${gapText} Floor of $${analysis.floorPrice.toFixed(2)} is protected.`;
}

// ── AI call for natural-language reason ─────────────────────────
async function generateAiReason(payload: {
  productTitle: string;
  collection?: string | null;
  vendor?: string | null;
  currentPhase: LifecyclePhase;
  daysInInventory: number;
  currentPrice: number;
  floorPrice: number;
  marginStatus: MarginStatus;
  competitorAveragePrice: number | null;
  competitorPriceGap: number | null;
  action: PricingAction;
  suggestedNewPrice: number | null;
  discountPercentage: number | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "ai-pricing-orchestrator",
      { body: payload },
    );
    if (error || !data?.reason) {
      console.warn("[ai-pricing-orchestrator] AI reason failed", error);
      return null;
    }
    return String(data.reason);
  } catch (err) {
    console.warn("[ai-pricing-orchestrator] AI invoke threw", err);
    return null;
  }
}

// ── Main entry point ────────────────────────────────────────────
export async function analyzeProduct(
  input: AnalyzeProductInput,
): Promise<PricingRecommendation> {
  // 1. Phase
  const currentPhase = getLifecyclePhase(input.daysInInventory);

  // 2. Margin
  const marginInfo = getMarginStatus({
    currentPrice: input.currentPrice,
    costPrice: input.costPrice ?? null,
  });
  const floorPrice = input.costPrice
    ? calculateFloorPrice(input.costPrice)
    : 0;

  // 3. Competitor price
  let competitorAveragePrice: number | null = null;
  let competitorPriceGap: number | null = null;
  if (input.shopifyProductId || input.sku || input.competitorUrl) {
    try {
      const resolved = await resolveCompetitorPrice({
        shopifyProductId: input.shopifyProductId ?? null,
        sku: input.sku ?? null,
        competitorUrl: input.competitorUrl ?? null,
      });
      if (resolved.price && resolved.price > 0) {
        competitorAveragePrice = resolved.price;
        competitorPriceGap = +(
          ((input.currentPrice - resolved.price) / input.currentPrice) *
          100
        ).toFixed(1);
      }
    } catch (err) {
      console.warn("[analyzeProduct] competitor resolve failed", err);
    }
  }

  // 4. Action selection (deterministic)
  const { action: rawAction, discountPct } = chooseAction(
    currentPhase,
    competitorPriceGap,
    marginInfo.status,
  );

  let suggestedNewPrice: number | null = null;
  let discountPercentage: number | null = null;
  let marginFloorEnforced = false;
  let action = rawAction;

  if (discountPct > 0) {
    const proposed = +(input.currentPrice * (1 - discountPct)).toFixed(2);
    const enforced = enforceFloor(proposed, input.costPrice ?? null);
    suggestedNewPrice = enforced.price;
    marginFloorEnforced = enforced.clamped;
    discountPercentage = +(
      ((input.currentPrice - suggestedNewPrice) / input.currentPrice) *
      100
    ).toFixed(2);
    // If clamping wiped out the entire discount, downgrade to HOLD.
    if (discountPercentage <= 0.5) {
      suggestedNewPrice = null;
      discountPercentage = null;
      action = "HOLD";
    }
  }

  const baseRec: Omit<PricingRecommendation, "reason"> = {
    productId: input.productId,
    analysis: {
      currentPhase,
      daysInInventory: input.daysInInventory,
      currentPrice: input.currentPrice,
      floorPrice,
      marginStatus: marginInfo.status,
      competitorAveragePrice,
      competitorPriceGap,
    },
    action,
    suggestedNewPrice,
    discountPercentage,
    marginFloorEnforced,
  };

  // 5. Reason (AI or template fallback)
  let reason: string;
  if (input.skipAi) {
    reason = templateReason(baseRec);
  } else {
    const aiReason = await generateAiReason({
      productTitle: input.title,
      collection: input.collection,
      vendor: input.vendor,
      currentPhase,
      daysInInventory: input.daysInInventory,
      currentPrice: input.currentPrice,
      floorPrice,
      marginStatus: marginInfo.status,
      competitorAveragePrice,
      competitorPriceGap,
      action,
      suggestedNewPrice,
      discountPercentage,
    });
    reason = aiReason ?? templateReason(baseRec);
  }

  return { ...baseRec, reason };
}

/** Bulk analysis — runs sequentially with a small delay to be polite to the AI gateway. */
export async function analyzeProducts(
  inputs: AnalyzeProductInput[],
  opts: { delayMs?: number; skipAi?: boolean } = {},
): Promise<PricingRecommendation[]> {
  const delay = opts.delayMs ?? 250;
  const out: PricingRecommendation[] = [];
  for (const item of inputs) {
    out.push(await analyzeProduct({ ...item, skipAi: opts.skipAi ?? item.skipAi }));
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return out;
}
