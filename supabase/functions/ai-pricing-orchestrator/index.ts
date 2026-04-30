/**
 * AI Pricing Orchestrator — edge function
 *
 * Generates the natural-language `reason` string for a pricing recommendation.
 * All deterministic math (lifecycle phase, floor price, suggested discount band,
 * floor enforcement) is done in the client orchestrator BEFORE this function
 * is called — we just ask the LLM to explain the proposed action in
 * merchant-friendly language.
 *
 * This keeps the AI cheap, deterministic-by-default, and avoids the model
 * inventing prices that would breach the margin floor.
 */

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ReasonRequest {
  productTitle: string;
  collection?: string | null;
  vendor?: string | null;
  currentPhase: "launch" | "mid_life" | "clearance";
  daysInInventory: number;
  currentPrice: number;
  floorPrice: number;
  marginStatus: "safe" | "at_risk" | "breached";
  competitorAveragePrice: number | null;
  competitorPriceGap: number | null; // % — positive = we're more expensive
  action: "HOLD" | "DISCOUNT" | "DEEP_DISCOUNT";
  suggestedNewPrice: number | null;
  discountPercentage: number | null;
}

function buildPrompt(req: ReasonRequest): string {
  const lines: string[] = [];
  lines.push(`Product: "${req.productTitle}"`);
  if (req.collection) lines.push(`Collection: ${req.collection}`);
  if (req.vendor) lines.push(`Brand: ${req.vendor}`);
  lines.push(`Lifecycle phase: ${req.currentPhase} (${req.daysInInventory} days in inventory)`);
  lines.push(`Current price: $${req.currentPrice.toFixed(2)}`);
  lines.push(`Margin floor: $${req.floorPrice.toFixed(2)} (cost + 5% fee buffer)`);
  lines.push(`Margin status: ${req.marginStatus}`);
  if (req.competitorAveragePrice != null) {
    lines.push(`Competitor average: $${req.competitorAveragePrice.toFixed(2)}`);
    if (req.competitorPriceGap != null) {
      const gap = req.competitorPriceGap;
      lines.push(
        gap > 0
          ? `We are priced ${gap.toFixed(1)}% ABOVE competitors.`
          : `We are priced ${Math.abs(gap).toFixed(1)}% BELOW competitors.`,
      );
    }
  } else {
    lines.push(`Competitor data: none available.`);
  }
  lines.push(`Recommended action: ${req.action}`);
  if (req.suggestedNewPrice != null && req.discountPercentage != null) {
    lines.push(
      `Recommended new price: $${req.suggestedNewPrice.toFixed(2)} (${req.discountPercentage.toFixed(1)}% off)`,
    );
  }
  return lines.join("\n");
}

const SYSTEM = `You are a retail pricing analyst writing for a boutique fashion merchant.
Given a product's pricing snapshot and a recommended action, write ONE concise paragraph
(2–3 sentences, max 60 words) explaining WHY this action is being recommended.

Rules:
- Speak directly to the merchant ("you", "your store"). No corporate jargon.
- Reference the lifecycle phase, competitor gap, and margin floor when relevant.
- Never suggest a different price than the one provided.
- Never recommend going below the margin floor.
- For HOLD: reassure the merchant the product is performing within expectations.
- For DISCOUNT: justify the size of the discount with the data points given.
- For DEEP_DISCOUNT: emphasise stock liquidation and freed cash flow.
- Output PLAIN TEXT only. No markdown, no bullet points, no quotes.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ReasonRequest;

    if (!body || typeof body.productTitle !== "string" || !body.action) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = buildPrompt(body);

    const ai = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 200,
    });

    const reason = getContent(ai).trim().replace(/^["']|["']$/g, "");

    return new Response(JSON.stringify({ reason }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ai-pricing-orchestrator] error", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
