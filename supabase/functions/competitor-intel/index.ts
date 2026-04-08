import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, payload } = await req.json();
    // LOVABLE_API_KEY checked by callAI

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "extract_competitor") {
      const { competitorName, competitorUrl, storeName } = payload;
      systemPrompt = `You are a competitive intelligence analyst for ${storeName || "a swimwear retailer"} in Australia. Return valid JSON only, no markdown.`;
      userPrompt = `TARGET: ${competitorName} (${competitorUrl})

TASK: Extract the complete collection/category structure from this competitor's website.

For each collection found, provide:
1. Collection title (exact text)
2. URL path
3. Estimated product count if visible
4. Collection description text preview (first 150 chars if exists)
5. Category type: product_type | speciality | brand | gender | print | seasonal | age_split | other
6. Navigation level: main | sub | tertiary

PRIORITISE: product type collections, speciality collections (chlorine resistant, tummy control, D-G cup, mastectomy, period, sustainable, modest, plus size/curve), age-split collections, print/story collections.

Return JSON ONLY:
{
  "competitorName": "${competitorName}",
  "totalCollections": 0,
  "collections": [
    {
      "title": "",
      "url": "",
      "categoryType": "product_type",
      "navLevel": "main",
      "productCount": null,
      "hasDescription": false,
      "descriptionPreview": "",
      "metaTitle": "",
      "metaDescription": ""
    }
  ],
  "notableFeatures": []
}`;
    } else if (action === "extract_supplier") {
      const { brandName, brandUrl } = payload;
      systemPrompt = `You are researching ${brandName}'s official website for SEO content intelligence. Return valid JSON only, no markdown.`;
      userPrompt = `BRAND SITE: ${brandUrl}

TASK 1 — PRINT/STORY NAMES: Find current season collection/print names with stories, inspiration, mood, colours.
TASK 2 — STYLING TIPS: Find styling advice, how-to-wear guides, fit tips.
TASK 3 — FAQs: Find FAQ sections (sizing, care, fit, fabric).
TASK 4 — COLLECTION CATEGORIES: List their collections with descriptions.

Return JSON ONLY:
{
  "brandName": "${brandName}",
  "prints": [{"name": "", "story": "", "mood": "", "colours": "", "editorialText": ""}],
  "stylingTips": [{"productType": "", "tip": "", "source": ""}],
  "faqs": [{"question": "", "answer": "", "category": "sizing"}],
  "brandCollections": [{"name": "", "description": "", "url": ""}]
}`;
    } else if (action === "generate_description") {
      const { collection, competitorExamples, stylingTips, faqs, printStory, relatedLinks, storeName, storeCity, storeUrl } = payload;
      systemPrompt = `You are an SEO copywriter for ${storeName || "a swimwear store"} in ${storeCity || "Darwin"}, Australia. Write collection descriptions using competitive intelligence. Australian English. Return valid JSON only.`;
      userPrompt = `COLLECTION: ${collection.title}
Type: ${collection.categoryType}
SEO target: ${collection.seoKeyword || collection.title + " Australia"}
Products stocked: ${collection.productCount || "unknown"}

${printStory ? `PRINT STORY (rewrite in your own words, 2-3 sentences max):
${printStory}` : ""}

${competitorExamples?.length ? `COMPETITOR EXAMPLES (INSPIRATION ONLY — DO NOT COPY):
${competitorExamples.map((ex: any) => `From ${ex.from}: "${ex.text?.slice(0, 300)}..."`).join("\n")}
Learn keyword patterns, structure, word count. DO NOT reproduce sentences.` : ""}

${stylingTips?.length ? `STYLING TIPS (rewrite naturally):
${stylingTips.map((t: any) => `[${t.productType}] ${t.tip}`).join("\n")}` : ""}

${faqs?.length ? `FAQ MATERIAL (rewrite in store voice):
${faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}` : ""}

${relatedLinks?.length ? `INTERNAL LINKS TO WEAVE IN:
${relatedLinks.map((l: any) => `"${l.anchorText}" → ${storeUrl}/collections/${l.handle}`).join("\n")}` : ""}

STRUCTURE:
1. Answer capsule (40-60 words) — what is this collection
2. Body paragraph 1 (70-90 words) — brands, features, print story
3. Body paragraph 2 (60-80 words) — styling tips, internal links
4. FAQ section if FAQs provided — 2-3 Q+As

FORMAT: <p> tags, <h2> for FAQ, <dl><dt><dd> for FAQ pairs. 200-350 words total.
DO NOT use: curated, vibrant, stunning, explore, delve, elevate, seamless, tapestry, journey.

Return JSON:
{
  "description": "<p>...</p>",
  "answerCapsule": "",
  "wordCount": 0,
  "seoTitle": "",
  "seoDescription": "",
  "stylingTipsUsed": 0,
  "faqsIncluded": 0,
  "internalLinksUsed": [],
  "printStoryUsed": false
}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: cleaned, parseError: true };
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("competitor-intel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
