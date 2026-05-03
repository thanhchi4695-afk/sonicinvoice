// Fetch a clean product description from supplier/retailer websites
// Uses Lovable AI Gateway (google/gemini-2.5-pro) with web grounding.
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";
import { loadSkillsForTask, asSkillsPreamble } from "../_shared/claude-skills.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  style_name: string;
  style_number?: string;
  brand: string;
  product_type?: string;
}

interface DescriptionPayload {
  description: string | null;
  full_product_name: string | null;
  source_url: string;
  source_name: string;
  source_type: "supplier" | "retailer";
  word_count: number;
  raw_word_count: number;
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You are a retail copy researcher for an Australian boutique fashion retailer.
Your job: find the official product description for a product so it can be imported into Shopify or Lightspeed.

SEARCH ORDER (strict):
1. The official supplier/brand website FIRST (e.g. seafolly.com, baku.com.au, sunseeker.com.au, bondeyeswim.com, jets.com.au, zimmermann.com).
2. If not found on the brand site, search Australian retailers in this order: The Iconic, Surfstitch, City Beach, David Jones, Myer.
3. If still not found, treat as not_found.

EXTRACTION RULES:
- Extract ONLY the marketing/product description text.
- Do NOT include: specs/tech sheets, size guide, reviews, breadcrumbs, FAQs, shipping info.
- Strip HTML tags. Strip any leading repetition of the brand name.
- Remove text containing: "free shipping", "add to cart", "buy now", "in stock", "out of stock", "sale", "% off", "RRP", promotional banners.
- Remove size-guide content — any sentence containing "size 8", "size 10", "fits true to size", "model is wearing", "model wears", measurements like "bust 86cm".
- Strip mentions of competitor brand names (only the searched brand may appear).

FULL PRODUCT NAME RULES:
- Also capture the OFFICIAL FULL product name as displayed on the source page (the H1 / product title).
- This is often longer than the invoice's short name. Example: invoice says "Kokomo Ultra High" but the brand site shows "Kokomo Ultra High Pant" → return "Kokomo Ultra High Pant".
- Title Case. Do NOT include the brand prefix (e.g. return "Kokomo Ultra High Pant", not "Baku Kokomo Ultra High Pant").
- Do NOT include color, size, SKU, price, or promotional words ("NEW", "SALE").
- If the page only shows the same short name as the invoice, return that short name unchanged.
- If no product page is found, set full_product_name to null.

LENGTH RULES:
- If cleaned description is under 20 words → too short, treat as not_found and try the next source.
- Prefer 40–150 words. If a source gives more than 200 words, truncate at the last full sentence before the 150-word mark.
- raw_word_count = original word count BEFORE truncation. word_count = final word count after cleaning + truncation.

PRIORITY:
- ALWAYS prefer the supplier/brand site description over the retailer description, regardless of length (as long as it passes the rules above).

CONFIDENCE:
- "high" = found on the brand's own website.
- "medium" = found on a major Australian retailer (Iconic, Surfstitch, City Beach, David Jones, Myer).
- "low" = found on a secondary source.

OUTPUT:
Return ONLY a JSON object — no preamble, no markdown fences, no commentary:
{
  "description": string | null,
  "full_product_name": string | null,
  "source_url": string,
  "source_name": string,
  "source_type": "supplier" | "retailer",
  "word_count": number,
  "raw_word_count": number,
  "confidence": "high" | "medium" | "low"
}
If nothing usable is found, set description and full_product_name to null and other fields to empty string / 0.`;

function safeJSON(text: string): DescriptionPayload | null {
  if (!text) return null;
  // Strip markdown fences if any model slipped them in
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return obj as DescriptionPayload;
  } catch {
    // Try to find a JSON block inside the text
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as DescriptionPayload;
      } catch {
        return null;
      }
    }
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.style_name || !body.brand) {
    return new Response(
      JSON.stringify({ error: "style_name and brand are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const userPrompt = `Find the official product description for:
Brand: ${body.brand}
Product name: ${body.style_name}
Style number / SKU: ${body.style_number || "(none)"}
Product type: ${body.product_type || "(unknown)"}

Search the brand's official website first, then Australian retailers as instructed.
Return ONLY the JSON object — no other text.`;

  try {
    // Resolve user (best-effort) and load Claude Skills for enrichment.
    let userId: string | null = null;
    try {
      const auth = req.headers.get("Authorization") || "";
      if (auth.startsWith("Bearer ")) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: auth } },
        });
        const { data } = await sb.auth.getUser();
        userId = data.user?.id ?? null;
      }
    } catch { /* ignore */ }
    const skillsMd = await loadSkillsForTask(userId, "enrichment", body.brand);
    const skillsPreamble = asSkillsPreamble(skillsMd, "product description research");

    const aiRes = await callAI({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: skillsPreamble + SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const raw = getContent(aiRes);
    const parsed = safeJSON(raw);

    if (!parsed) {
      console.warn("Could not parse AI response:", raw?.slice(0, 200));
      return new Response(
        JSON.stringify({
          description: null,
          full_product_name: null,
          source_url: "",
          source_name: "",
          source_type: "retailer",
          word_count: 0,
          raw_word_count: 0,
          confidence: "low",
        } satisfies DescriptionPayload),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AIGatewayError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("fetch-product-description error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
