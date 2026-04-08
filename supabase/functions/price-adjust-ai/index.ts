import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { instruction, brands, types, tags, priceMin, priceMax } = await req.json();
    // LOVABLE_API_KEY checked by callAI

    const systemPrompt = `You are a price adjustment interpreter for a retail product management app.
The user describes a price adjustment in plain English. Extract the exact settings needed.

Available data in the current product set:
- Brands: ${(brands || []).join(", ") || "none"}
- Product Types: ${(types || []).join(", ") || "none"}
- Tags: ${(tags || []).join(", ") || "none"}
- Price range: $${priceMin ?? 0} to $${priceMax ?? 999}

Return ONLY valid JSON with these fields:
{
  "filter": {
    "scope": "all" | "brand" | "type" | "tag" | "price_range",
    "brands": [],
    "types": [],
    "tags": [],
    "priceMin": null,
    "priceMax": null
  },
  "field": "price" | "compare_at" | "both" | "cost",
  "type": "percent_discount" | "percent_markup" | "set_exact" | "multiply_by",
  "value": number,
  "rounding": "none" | "nearest_05" | "nearest_1" | "charm_95" | "nearest_5" | "nearest_10",
  "floor": null | number,
  "ceiling": null | number,
  "marginFloor": null | number,
  "explanation": "plain English explanation"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: instruction },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", status, text);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();

    const parsed = JSON.parse(jsonStr);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("price-adjust-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Failed to interpret instruction" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
