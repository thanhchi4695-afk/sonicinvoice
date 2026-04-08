import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { collections, storeName, storeCity, locale, industry } = await req.json();
    // LOVABLE_API_KEY checked by callAI

    if (!Array.isArray(collections) || collections.length === 0) {
      return new Response(JSON.stringify({ error: "No collections provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batch = collections.slice(0, 10);
    const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";

    const systemPrompt = `You are an SEO expert for ${storeName || "a retail store"} in ${storeCity || "Australia"}.
Industry: ${industry || "fashion"}.

TASK: For each Shopify collection, generate SEO-optimized content to make it rank on Google.

OUTPUT PER COLLECTION (JSON):
{
  "intro_text": "2-3 sentence intro paragraph to show ABOVE the product grid. Include primary keyword naturally. HTML with <p> tags.",
  "seo_content": "150-300 word SEO content for BELOW the product grid. Include keyword variations naturally. HTML with <p> and optional <h3> tags. Cover: styles available, occasions, styling ideas.",
  "faq": [{"q": "question", "a": "short answer"}],
  "meta_title": "50-60 chars, include main keyword, readable.",
  "meta_description": "140-160 chars, include keyword, encourage clicks.",
  "primary_keyword": "main keyword",
  "secondary_keywords": ["keyword1", "keyword2", "keyword3"],
  "related_collections": ["related collection 1", "related collection 2", "related collection 3"],
  "confidence_score": 0-100,
  "confidence_reason": "string"
}

SEO RULES:
- ${spelling} spelling throughout
- Primary keyword 2-3 times max across all content
- Include natural variations
- No keyword stuffing
- Clean, modern tone
- No exaggerated claims or fake material claims
- No "premium" or "luxury" unless warranted

META TITLE FORMAT: "{Collection} | {Style Hint} | ${storeName || "Shop"}"
META DESCRIPTION: Start with action verb. Include collection keyword + 1 attribute.

FAQ: Generate 2-3 relevant questions shoppers would ask. Keep answers 1-2 sentences.

RELATED COLLECTIONS: Suggest 3 complementary collection names.

CONFIDENCE:
- High (90-100): Clear collection with products and strong keyword
- Medium (70-89): Identifiable but limited product data
- Low (<70): Vague collection, generic output

RESPOND WITH A JSON ARRAY matching input order.`;

    const userContent = batch.map((c: any, i: number) => {
      const products = (c.products || []).slice(0, 5).map((p: any) => p.title || p).join(", ");
      return `Collection ${i + 1}: title="${c.title || ""}" | type="${c.collection_type || "custom"}" | products="${products}" | tags="${c.tags || ""}" | vendor="${c.vendor || ""}"`;
    }).join("\n");

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
      if (parsed && typeof parsed === "object" && parsed.intro_text) {
        parsed = [parsed];
      } else {
        parsed = batch.map((c: any) => ({
          intro_text: `<p>Explore our ${c.title || "collection"}.</p>`,
          seo_content: `<p>Shop ${c.title || "products"} at ${storeName || "our store"}.</p>`,
          faq: [],
          meta_title: (c.title || "Collection").slice(0, 60),
          meta_description: `Shop ${c.title || "this collection"} online.`.slice(0, 160),
          primary_keyword: c.title?.toLowerCase() || "collection",
          secondary_keywords: [],
          related_collections: [],
          confidence_score: 15,
          confidence_reason: "Could not parse AI response",
        }));
      }
    }

    while (parsed.length < batch.length) {
      const c = batch[parsed.length];
      parsed.push({
        intro_text: `<p>Explore our ${c?.title || "collection"}.</p>`,
        seo_content: `<p>Shop ${c?.title || "products"} online.</p>`,
        faq: [],
        meta_title: (c?.title || "Collection").slice(0, 60),
        meta_description: `Shop ${c?.title || "this collection"} online.`.slice(0, 160),
        primary_keyword: "",
        secondary_keywords: [],
        related_collections: [],
        confidence_score: 15,
        confidence_reason: "No AI result for this item",
      });
    }

    return new Response(JSON.stringify({ results: parsed.slice(0, batch.length) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("collection-seo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
