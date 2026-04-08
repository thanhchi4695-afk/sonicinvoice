import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products, storeName, storeCity, industry } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap at 20 per request
    const batch = products.slice(0, 20);

    const systemPrompt = `You are a product naming specialist for ${storeName || "a retail store"} in ${storeCity || "Australia"}.
Industry: ${industry || "fashion"}.

TASK: Transform messy product inputs into clean, retail-ready Shopify product titles.

RULES FOR TITLES:
- Title Case
- 3-8 words ideal
- Structure: [Color] + [Key Feature] + [Product Type]
- Remove supplier names, PTY, LTD, RAE, ABN numbers
- Remove invoice noise (sizes as standalone, pure numbers, codes)
- Expand abbreviations: DRS→Dress, BLU→Blue, FLRL→Floral, BLK→Black, WHT→White, GRN→Green, PNK→Pink, RED→Red, YLW→Yellow, SLV→Sleeve, LS→Long Sleeve, SS→Short Sleeve, SZ→Size
- Never invent brands, materials, or unverifiable details
- If input is purely numeric or a vendor name only, return "Unidentified [Type] Item" with low confidence

PRODUCT TYPE NORMALIZATION:
Dress/DRS→Dresses, Top/Shirt/Blouse→Tops, Pant/Trouser→Pants, Short→Shorts, Skirt→Skirts, Swim/Bikini→Swimwear, Shoe/Sandal/Heel/Boot→Shoes, Bag/Clutch/Tote→Bags, Jewellery/Earring/Necklace/Bracelet→Accessories, Hat/Cap→Hats, Jacket/Coat/Blazer→Jackets, Knit/Sweater/Jumper→Knitwear

DESCRIPTION RULES:
- 1-2 factual sentences
- No marketing fluff, no price, no fabric guesses
- Australian English

For each product, return 2-3 title variations. Mark one as recommended.

RESPOND WITH A JSON ARRAY matching the input order:
[{
  "recommended_title": "string",
  "alternative_titles": ["string", "string"],
  "product_type": "string",
  "short_description": "string",
  "tags": ["tag1", "tag2"],
  "confidence_score": number (0-100),
  "confidence_reason": "string"
}]`;

    const userContent = batch.map((p: any, i: number) =>
      `Item ${i + 1}: "${p.title || p.raw || ""}" | vendor_hint: "${p.vendor || ""}" | sku: "${p.sku || ""}" | barcode: "${p.barcode || ""}" | colour: "${p.colour || ""}" | type_hint: "${p.type || ""}"`
    ).join("\n");

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
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI generation failed");
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any = null;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback below */ }
    }

    if (!Array.isArray(parsed)) {
      // Single object fallback
      if (parsed && typeof parsed === "object" && parsed.recommended_title) {
        parsed = [parsed];
      } else {
        parsed = batch.map((p: any) => ({
          recommended_title: p.title || "Unidentified Item",
          alternative_titles: [],
          product_type: p.type || "General",
          short_description: "",
          tags: [],
          confidence_score: 20,
          confidence_reason: "Could not parse AI response",
        }));
      }
    }

    // Ensure array matches input length
    while (parsed.length < batch.length) {
      parsed.push({
        recommended_title: batch[parsed.length]?.title || "Unidentified Item",
        alternative_titles: [],
        product_type: "General",
        short_description: "",
        tags: [],
        confidence_score: 20,
        confidence_reason: "No AI result for this item",
      });
    }

    return new Response(JSON.stringify({ results: parsed.slice(0, batch.length) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("smart-naming error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
