import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProductInput {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string;
  body_html: string;
  existing_seo_title: string;
  existing_seo_desc: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products, storeName, storeCity, industry } = await req.json();

    if (!Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ error: "No products provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batch = products.slice(0, 20) as ProductInput[];

    const systemPrompt = `You are a Shopify SEO specialist for "${storeName || "a retail store"}"${storeCity ? ` in ${storeCity}` : ""}.
Industry: ${industry || "fashion"}.

TASK: Generate SEO Title and SEO Description for each product.

CRITICAL ACCURACY RULES:
- SEO Title MUST match the actual product. Use the real product name as base.
- NEVER hallucinate materials, colors, or features not in the data.
- NEVER reference a different product.
- If product data is vague, keep SEO conservative and factual.

SEO TITLE RULES:
- 50-60 chars optimal, 70 chars HARD CAP
- Include product name + brand/store when space allows
- Natural, readable, commercial intent
- No keyword stuffing
- Format: "{Product Name} - {Key Attribute} | ${storeName || "Shop"}"

SEO DESCRIPTION RULES:
- 140-160 chars, 160 HARD CAP
- Accurately describe the real product
- Start with action verb (Shop, Discover, Explore)
- Include product name naturally
- Mention store brand where appropriate
- No vague filler that could apply to anything

VALIDATION:
- If product title terms don't align with generated SEO → use safe fallback
- Safe fallback title: "{Title} | ${storeName || "Shop"}" truncated to 70 chars
- Safe fallback desc: "Shop {Title} by {Vendor} at ${storeName || "our store"}. Quality {Type} at great value." truncated to 160 chars

CONFIDENCE SCORING:
- 90-100: Clear product with title, type, vendor, tags
- 70-89: Product identified but limited attributes
- <70: Vague input, used safe fallback

RESPOND WITH JSON ARRAY matching input order:
[{
  "seo_title": "string (max 70 chars)",
  "seo_description": "string (max 160 chars)",
  "confidence": number,
  "reason": "string"
}]`;

    const userContent = batch.map((p, i) =>
      `Product ${i + 1}: handle="${p.handle}" | title="${p.title}" | vendor="${p.vendor}" | type="${p.type}" | tags="${p.tags}" | existing_seo="${p.existing_seo_title}"`
    ).join("\n");

    const data = await callAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any = null;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\[[\s\S]*\]/);
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
    }

    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === "object" && parsed.seo_title) {
        parsed = [parsed];
      } else {
        parsed = batch.map((p) => ({
          seo_title: `${p.title} | ${storeName || "Shop"}`.slice(0, 70),
          seo_description: `Shop ${p.title} by ${p.vendor} at ${storeName || "our store"}. Quality ${p.type || "product"}.`.slice(0, 160),
          confidence: 15,
          reason: "Could not parse AI response — used safe fallback",
        }));
      }
    }

    // Pad missing results
    while (parsed.length < batch.length) {
      const p = batch[parsed.length];
      parsed.push({
        seo_title: `${p.title} | ${storeName || "Shop"}`.slice(0, 70),
        seo_description: `Shop ${p.title} at ${storeName || "our store"}.`.slice(0, 160),
        confidence: 15,
        reason: "No AI result — used safe fallback",
      });
    }

    // Enforce hard caps
    for (const r of parsed) {
      if (r.seo_title && r.seo_title.length > 70) r.seo_title = r.seo_title.slice(0, 67) + "...";
      if (r.seo_description && r.seo_description.length > 160) r.seo_description = r.seo_description.slice(0, 157) + "...";
    }

    return new Response(JSON.stringify({ results: parsed.slice(0, batch.length) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("csv-seo-optimize error:", e);
    const status = e instanceof AIGatewayError ? e.status : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
