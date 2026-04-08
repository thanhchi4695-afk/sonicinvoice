import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title, vendor, type, brandWebsite, storeName, storeCity, customInstructions } = await req.json();
    
    // LOVABLE_API_KEY checked by callAI

    const brandSiteHint = brandWebsite ? `Brand website: ${brandWebsite}` : '';
    const customSection = customInstructions?.trim()
      ? `\nSTORE INSTRUCTIONS:\n${customInstructions}\n`
      : '';

    const prompt = `You are a product content writer for ${storeName || 'My Store'}, a retail store in ${storeCity || 'Australia'}.

TASK: Enrich this product with a description and image.

PRODUCT:
  Title:  ${title}
  Brand:  ${vendor}
  Type:   ${type || 'General'}
  ${brandSiteHint}

STEP 1 — FIND THE PRODUCT PAGE:
Search for this exact product on the brand's website.
Use the brand site if provided. Search query should be:
  "${vendor} ${title} official site"
Find the product page URL. If the brand has an AU site, prefer it.

STEP 2 — EXTRACT FROM THE PAGE:
From the product page, extract:
  a) Product description (the full marketing copy)
  b) All product image URLs (find img src or og:image)
  c) Fabric / material composition (e.g. "80% Nylon, 20% Elastane")
  d) Care instructions (e.g. "Hand wash cold")
  e) Country of origin (e.g. "Made in Australia")

STEP 3 — WRITE A STORE DESCRIPTION:
Rewrite the description in the voice of ${storeName || 'My Store'}.
Rules:
  - 60–120 words
  - Mention key features (underwire, chlorine resistant, cup sizes etc. if present)
  - End with a call to action: "Shop online or visit us in ${storeCity || 'store'}."
  - Australian English
  - Do NOT copy sentences directly from the brand site
  - Do NOT use words: curated, vibrant, tapestry, delve
${customSection}

RESPOND WITH JSON ONLY, no other text:
{
  "description": "HTML description — use <p> tags",
  "imageUrls": ["url1", "url2", "url3"],
  "fabric": "e.g. 80% Nylon, 20% Elastane or empty string",
  "care": "e.g. Hand wash cold or empty string",
  "origin": "e.g. Made in Australia or empty string",
  "productPageUrl": "the brand page URL you found",
  "confidence": "high|medium|low",
  "note": "any issue encountered or empty string"
}`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a product data enrichment assistant. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const rawText = getContent(data);
    
    // Strip markdown code fences if present
    const clean = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    try {
      const parsed = JSON.parse(clean);
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(JSON.stringify(parsed), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch {}
      }
      return new Response(JSON.stringify({
        description: '',
        imageUrls: [],
        fabric: '',
        care: '',
        origin: '',
        productPageUrl: '',
        confidence: 'low',
        note: 'Could not parse AI response',
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("enrich-product error:", e);
    const status = e instanceof AIGatewayError ? e.status : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
