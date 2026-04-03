import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products, storeName, storeCity, locale, industry, freeShippingThreshold } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batch = products.slice(0, 15);
    const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";
    const shippingLine = freeShippingThreshold ? `Mention free shipping over ${freeShippingThreshold} if relevant.` : "";

    const systemPrompt = `You are an SEO copywriter for ${storeName || "a retail store"} in ${storeCity || "Australia"}.
Industry: ${industry || "fashion"}.

TASK: For each product, generate SEO-optimized content for Shopify.

OUTPUT PER PRODUCT (JSON):
{
  "seo_description": "2-3 paragraph HTML product description (use <p> tags). Para 1: introduce product with primary keyword. Para 2: highlight features with secondary keywords. Optional: bullet list of key features. Final line: soft CTA.",
  "short_description": "1-2 sentence plain text summary.",
  "meta_title": "50-60 chars, include main keyword, readable.",
  "meta_description": "140-160 chars, include keyword, encourage clicks.",
  "keywords": ["primary keyword", "secondary1", "secondary2", "related1"],
  "confidence_score": 0-100,
  "confidence_reason": "string"
}

SEO WRITING RULES:
- ${spelling} spelling throughout
- Natural language — no keyword stuffing
- Primary keyword appears 1-2 times in description
- No fake fabric claims, no certifications, no "premium" or "luxury" unless vendor is known luxury
- No price mentions in description
- Keep tone clean, modern, informative
- ${shippingLine}

PRODUCT TYPE TAILORING:
- Dresses: mention silhouette, occasion, season
- Shoes: mention comfort, style, versatility
- Swimwear: mention fit, coverage, beach/pool
- Accessories: mention styling, versatility
- Tops: mention cut, layering potential
- For unknown types: keep generic and factual

META TITLE FORMAT: "{Product Name} – {Category or Style Hint} | ${storeName || "Shop"}"
META DESCRIPTION: Start with action verb (Shop, Discover, Explore). Include product + 1 key attribute.

CONFIDENCE:
- High (90-100): Clear product with type, color, and attributes
- Medium (70-89): Product identified but limited attributes
- Low (<70): Vague input, generic output

RESPOND WITH A JSON ARRAY matching input order.`;

    const userContent = batch.map((p: any, i: number) =>
      `Item ${i + 1}: title="${p.title || ""}" | type="${p.type || ""}" | vendor="${p.vendor || ""}" | colour="${p.colour || ""}" | tags="${p.tags || ""}" | pattern="${p.pattern || ""}"`
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
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
    }

    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === "object" && parsed.seo_description) {
        parsed = [parsed];
      } else {
        parsed = batch.map((p: any) => ({
          seo_description: `<p>${p.title || "Product"} available now.</p>`,
          short_description: p.title || "Product",
          meta_title: (p.title || "Product").slice(0, 60),
          meta_description: `Shop ${p.title || "this product"} online. Quality ${p.type || "item"} at great value.`.slice(0, 160),
          keywords: [p.title?.toLowerCase() || "product"],
          confidence_score: 15,
          confidence_reason: "Could not parse AI response",
        }));
      }
    }

    while (parsed.length < batch.length) {
      const p = batch[parsed.length];
      parsed.push({
        seo_description: `<p>${p?.title || "Product"} available now.</p>`,
        short_description: p?.title || "Product",
        meta_title: (p?.title || "Product").slice(0, 60),
        meta_description: `Shop ${p?.title || "this product"} online.`.slice(0, 160),
        keywords: [],
        confidence_score: 15,
        confidence_reason: "No AI result for this item",
      });
    }

    return new Response(JSON.stringify({ results: parsed.slice(0, batch.length) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("seo-description error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
