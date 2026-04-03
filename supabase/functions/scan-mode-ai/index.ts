import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { input, mode, storeName, storeCity, ocrMode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a retail product identification assistant for ${storeName || "a retail store"} in ${storeCity || "Australia"}.

TASK: Analyze the input and generate a clean, Shopify-ready product draft.

RULES:
- Title: Clean, retail-friendly. Format: Key attributes + Product type. Example: "Blue Floral Midi Dress", "Tan Flat Sandals"
- Do NOT invent brand names unless clearly visible/readable
- Do NOT guess exact materials unless visually obvious
- Do NOT guess price or size
- Use only what is visually supported
- Keep description to 1-2 factual sentences about visible features
- Australian English

PRODUCT TYPES to choose from:
Dresses, Tops, Pants, Shorts, Skirts, Swimwear, Shoes, Sandals, Boots, Bags, Accessories, Jewellery, Hats, Homewares, Gifts, Jackets, Knitwear, Activewear, Sleepwear, Lingerie, General

CONFIDENCE SCORING:
- 90-100: Clear product, obvious category, visible details
- 70-89: Identifiable but some attributes uncertain
- Below 70: Unclear image, folded/packaged item, ambiguous product

RESPOND WITH JSON ONLY:
{
  "product_title": "string",
  "product_type": "string",
  "short_description": "string",
  "tags": ["tag1", "tag2"],
  "colour": "string or empty",
  "pattern": "string or empty",
  "confidence_score": number,
  "confidence_reason": "string explaining the score"
}`;

    const messages: Array<{ role: string; content: any }> = [
      { role: "system", content: systemPrompt },
    ];

    if (mode === "image") {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "Identify this product from the image. Generate a Shopify-ready product draft with confidence score." },
          { type: "image_url", image_url: { url: input } },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: `Generate a Shopify-ready product draft for: "${input}"`,
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: mode === "image" ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview",
        messages,
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

    const tryParse = (str: string) => {
      try { return JSON.parse(str); } catch { return null; }
    };

    let parsed = tryParse(clean);
    if (!parsed) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = tryParse(match[0]);
    }

    if (!parsed) {
      parsed = {
        product_title: input?.substring?.(0, 50) || "Product",
        product_type: "General",
        short_description: "",
        tags: [],
        colour: "",
        pattern: "",
        confidence_score: 30,
        confidence_reason: "Could not parse AI response",
      };
    }

    // Normalize response
    const result = {
      product_title: parsed.product_title || parsed.title || "Product",
      product_type: parsed.product_type || parsed.type || "General",
      short_description: parsed.short_description || parsed.description || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : (parsed.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
      colour: parsed.colour || parsed.color || "",
      pattern: parsed.pattern || "",
      sku: parsed.sku || "",
      barcode: parsed.barcode || "",
      confidence_score: typeof parsed.confidence_score === "number" ? parsed.confidence_score : 50,
      confidence_reason: parsed.confidence_reason || "",
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-mode-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
