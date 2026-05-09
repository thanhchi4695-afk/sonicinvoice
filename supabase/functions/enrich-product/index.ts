import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getContent, AIGatewayError } from "../_shared/ai-gateway.ts";
import { callAIForJob } from "../_shared/model-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Real-image fetch pipeline (mirrors the URL Product Extractor):
 *   1. find-product-url  → resolve the supplier's product page
 *   2. product-extract   → JSON-LD / DOM / LLM cascade + image-pipeline
 *
 * Returns { imageUrls, productPageUrl, description, source } or null on failure.
 * Always best-effort — never throws to the caller.
 */
async function fetchRealImagesViaCascade(opts: {
  vendor: string;
  title: string;
  styleNumber?: string | null;
  brandWebsite?: string | null;
}): Promise<
  | {
      imageUrls: string[];
      productPageUrl: string;
      description: string | null;
      source: "cascade";
      strategy: string | null;
    }
  | null
> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!opts.brandWebsite || !opts.brandWebsite.trim()) return null;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  };

  // Step 1 — find the product page URL on the brand site
  let pageUrl: string | null = null;
  try {
    const findRes = await fetch(`${SUPABASE_URL}/functions/v1/find-product-url`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brand_website: opts.brandWebsite,
        product_name: opts.title,
        style_number: opts.styleNumber || undefined,
        vendor: opts.vendor,
      }),
    });
    if (findRes.ok) {
      const j = await findRes.json();
      pageUrl = typeof j?.url === "string" ? j.url : null;
      console.log(`[enrich-product] find-product-url → ${pageUrl ?? "(not found)"} (${j?.strategy_used ?? "n/a"})`);
    } else {
      console.warn("[enrich-product] find-product-url HTTP", findRes.status);
    }
  } catch (e) {
    console.warn("[enrich-product] find-product-url failed:", (e as Error).message);
  }

  if (!pageUrl) return null;

  // Step 2 — extract real images via the same cascade as URL importer
  try {
    const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/product-extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!extractRes.ok) {
      console.warn("[enrich-product] product-extract HTTP", extractRes.status);
      return null;
    }
    const j = await extractRes.json();
    const product = j?.product;
    if (!product || !Array.isArray(product.images)) return null;

    const imageUrls: string[] = product.images
      .map((img: { storedUrl?: string }) => img?.storedUrl)
      .filter((u: unknown): u is string => typeof u === "string" && u.length > 0);

    console.log(
      `[enrich-product] product-extract → ${imageUrls.length} real image(s) via "${product.strategyUsed}"`,
    );

    return {
      imageUrls,
      productPageUrl: pageUrl,
      description: typeof product.description === "string" ? product.description : null,
      source: "cascade",
      strategy: product.strategyUsed ?? null,
    };
  } catch (e) {
    console.warn("[enrich-product] product-extract failed:", (e as Error).message);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      title,
      vendor,
      type,
      brandWebsite,
      styleNumber,
      storeName,
      storeCity,
      customInstructions,
    } = await req.json();

    // ── Step A: Real image fetch via find-product-url → product-extract cascade.
    // Runs in parallel with the LLM description call below for speed.
    const cascadePromise = fetchRealImagesViaCascade({
      vendor: vendor || "",
      title: title || "",
      styleNumber: styleNumber || null,
      brandWebsite: brandWebsite || null,
    });

    const brandSiteHint = brandWebsite ? `Brand website: ${brandWebsite}` : '';
    const customSection = customInstructions?.trim()
      ? `\nSTORE INSTRUCTIONS:\n${customInstructions}\n`
      : '';

    const prompt = `You are a product content writer for ${storeName || 'My Store'}, a retail store in ${storeCity || 'Australia'}.

TASK: Enrich this product with a description.

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
  b) Fabric / material composition (e.g. "80% Nylon, 20% Elastane")
  c) Care instructions (e.g. "Hand wash cold")
  d) Country of origin (e.g. "Made in Australia")

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
  "fabric": "e.g. 80% Nylon, 20% Elastane or empty string",
  "care": "e.g. Hand wash cold or empty string",
  "origin": "e.g. Made in Australia or empty string",
  "productPageUrl": "the brand page URL you found",
  "confidence": "high|medium|low",
  "note": "any issue encountered or empty string"
}`;

    const data = await callAIForJob("product.enrich", {
      messages: [
        { role: "system", content: "You are a product data enrichment assistant. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const rawText = getContent(data);
    const clean = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* leave parsed empty */ }
      }
    }

    // ── Step B: merge cascade results — REAL images take precedence over
    // any LLM-hallucinated URLs, and the on-page description (if any) is
    // used as the source-of-truth for the rewrite when LLM didn't return one.
    const cascade = await cascadePromise;
    let imageSource: "cascade" | "llm" | "none" = "none";
    let imageUrls: string[] = [];

    if (cascade && cascade.imageUrls.length > 0) {
      imageUrls = cascade.imageUrls;
      imageSource = "cascade";
    } else if (Array.isArray(parsed.imageUrls)) {
      // Backwards-compat: fall back to whatever the LLM produced (often unreliable).
      imageUrls = (parsed.imageUrls as unknown[]).filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
      );
      if (imageUrls.length > 0) imageSource = "llm";
    }

    const result = {
      description: parsed.description || '',
      imageUrls,
      fabric: parsed.fabric || '',
      care: parsed.care || '',
      origin: parsed.origin || '',
      productPageUrl: cascade?.productPageUrl || parsed.productPageUrl || '',
      confidence: cascade?.imageUrls.length
        ? 'high'
        : (parsed.confidence || 'low'),
      note: parsed.note || '',
      imageSource,
      imageStrategy: cascade?.strategy ?? null,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("enrich-product error:", e);
    const status = e instanceof AIGatewayError ? e.status : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
