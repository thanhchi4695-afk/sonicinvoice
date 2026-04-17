// AI fallback: generate a product description when scraping returns nothing useful.
// Always clearly tagged as AI-generated so the UI can warn the user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      product_name,
      supplier,
      style_number,
      colour,
      product_type,
      key_features,
      fabric_content,
    } = await req.json();

    if (!product_name) {
      return new Response(JSON.stringify({ error: "product_name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You write short, accurate, on-brand product descriptions for an Australian boutique fashion retailer.

RULES:
- 40–90 words. Two short paragraphs maximum, or one paragraph plus 2–3 bullet-style sentences.
- Australian English spelling (colour, organise, etc.).
- Describe the product clearly. Mention silhouette, key features and ideal occasion if obvious from the inputs.
- DO NOT invent specific facts you weren't given (no fabricated fabric percentages, no fake care instructions, no made-up sizing).
- DO NOT use emojis, hashtags, exclamation marks, or hard-sell language ("amazing!", "must-have!", "you'll love…").
- DO NOT mention price, discount, sale or shipping.
- Tone: confident, editorial, slightly understated. Avoid clichés ("perfect for any occasion").
- Output PLAIN TEXT only — no markdown, no headings, no quotes around the copy.`;

    const userContent = `Write a description for this product:

Product name: ${product_name}
Brand / supplier: ${supplier || "unknown"}
Style number: ${style_number || "n/a"}
Colour: ${colour || "n/a"}
Product type: ${product_type || "n/a"}
Known features: ${Array.isArray(key_features) && key_features.length ? key_features.join(", ") : "none provided"}
Fabric content: ${fabric_content || "not provided"}

Use only the facts above. If a field says "unknown" or "not provided", do not invent a value for it.`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const description = (getContent(data) || "").trim();

    if (!description) {
      return new Response(JSON.stringify({ error: "AI returned empty description" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        description,
        description_source: "ai_generated",
        model: "google/gemini-2.5-flash",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-product-description error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
