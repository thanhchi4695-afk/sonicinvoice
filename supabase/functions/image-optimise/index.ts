import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSeoFilename(product: { vendor?: string; title?: string; colour?: string; productType?: string }): string {
  const parts = [product.vendor, product.productType, product.colour].filter(Boolean).map((p) => slugify(p!));
  return parts.join("-") + ".jpg";
}

// Detect duplicates by URL
function detectDuplicateUrls(products: any[]): Map<number, string> {
  const urlMap = new Map<string, number[]>();
  products.forEach((p, i) => {
    const url = (p.imageUrl || "").trim();
    if (!url) return;
    const existing = urlMap.get(url) || [];
    existing.push(i);
    urlMap.set(url, existing);
  });
  const dupes = new Map<number, string>();
  for (const [url, indices] of urlMap) {
    if (indices.length > 1) {
      const titles = indices.map(i => products[i].title || `Product ${i + 1}`);
      for (const idx of indices) {
        dupes.set(idx, `Shared with: ${titles.filter((_, ti) => indices[ti] !== idx).join(", ")}`);
      }
    }
  }
  return dupes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, products } = await req.json();

    // ── 1. Context-aware alt text + SEO keywords + search intent ──
    if (action === "generate_alt_text") {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productList = products.slice(0, 25).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title || "Unknown"}", Vendor: "${p.vendor || ""}", Colour: "${p.colour || ""}", Type: "${p.productType || ""}", Description: "${(p.description || "").slice(0, 120)}", Tags: "${(p.tags || []).join(", ")}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are an advanced SEO image optimisation engine for e-commerce.

For each product, generate:

1. ALT TEXT (8-15 words):
   - Include brand name, product type, colour/pattern, and key style feature
   - Match shopper search intent (what would someone Google to find this?)
   - Use natural language, sentence case
   - Do NOT start with "Image of" or "Photo of"
   - Each must be unique even for similar products
   - Example: "Sea Level black ribbed bikini top with bow straps"

2. SEO FILENAME:
   - Format: brand-product-type-colour.jpg
   - Lowercase, hyphen-separated, no special chars
   - Example: sea-level-black-bikini-top.jpg

3. SEO KEYWORDS (5-8):
   - Primary: exact product type + brand
   - Secondary: style, material, occasion
   - Long-tail: specific search phrases shoppers use
   - Include colour variations if applicable
   - Example: ["black bikini top", "sea level swimwear", "ribbed bikini", "bow strap bikini top", "women's swimwear"]

4. SEARCH INTENT:
   - What query would a shopper use to find this product?
   - Example: "black bikini top with straps"

5. IMAGE CAPTION (optional short marketing line):
   - 1 sentence, under 20 words
   - Example: "Flattering ribbed bikini top with adjustable bow straps for all-day comfort."

Return JSON array: [{"index": 0, "alt_text": "...", "seo_filename": "...", "keywords": ["..."], "search_intent": "...", "caption": "..."}]`,
          },
          {
            role: "user",
            content: `Generate context-aware alt text, keywords, and SEO metadata for:\n${productList}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch { results = []; }

      const output = products.slice(0, 25).map((p: any, i: number) => {
        const match = results.find((r: any) => r.index === i) || {};
        return {
          ...p,
          alt_text: match.alt_text || `${p.vendor || ""} ${p.title || "Product"} in ${p.colour || ""}`.trim(),
          seo_filename: match.seo_filename || buildSeoFilename(p),
          keywords: match.keywords || [],
          search_intent: match.search_intent || "",
          caption: match.caption || "",
        };
      });

      return new Response(JSON.stringify({ results: output }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Image quality + duplicate + mismatch analysis ──
    if (action === "analyse_quality") {
      if (!products || !Array.isArray(products)) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pre-compute duplicates deterministically
      const dupes = detectDuplicateUrls(products);

      const imageList = products.slice(0, 30).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title}", Vendor: "${p.vendor || ""}", Type: "${p.productType || ""}", Image URL: "${p.imageUrl || "MISSING"}", Description: "${(p.description || "").slice(0, 80)}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a product image quality and SEO analyser. For each product assess:

1. IMAGE STATUS: "ok" | "missing" | "broken" | "low_quality" | "mismatch"
   - "missing": no URL or empty
   - "broken": malformed URL, placeholder image, or generic stock photo URL
   - "low_quality": URL suggests thumbnail (tiny dimensions), or known low-res CDN patterns
   - "mismatch": image URL domain/path doesn't match the product brand/type (e.g. a shoe image for a dress product)
   - "ok": appears valid and appropriate

2. ISSUE: short description of the problem (or null)
3. RECOMMENDATION: actionable fix (or null)
4. MISMATCH_CONFIDENCE: 0-100 if you suspect a mismatch (how confident the image doesn't match the product)

Return JSON array: [{"index": 0, "status": "...", "issue": "...", "recommendation": "...", "mismatch_confidence": 0}]`,
          },
          {
            role: "user",
            content: `Analyse these product images for quality, relevance, and mismatches:\n${imageList}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch { results = []; }

      // Merge duplicate detection
      const finalResults = products.slice(0, 30).map((_: any, i: number) => {
        const aiResult = results.find((r: any) => r.index === i) || { status: "ok", issue: null, recommendation: null, mismatch_confidence: 0 };
        const dupeInfo = dupes.get(i);
        if (dupeInfo && aiResult.status === "ok") {
          return { ...aiResult, index: i, status: "duplicate", issue: dupeInfo, recommendation: "Use a unique image for this product" };
        }
        if (dupeInfo) {
          aiResult.issue = `${aiResult.issue || ""}. Also duplicate: ${dupeInfo}`.replace(/^\.?\s*/, "");
        }
        return { ...aiResult, index: i };
      });

      return new Response(JSON.stringify({ results: finalResults }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Image-to-product validation (batch) ──
    if (action === "validate_match") {
      if (!products || !Array.isArray(products)) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const list = products.slice(0, 20).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title}", Vendor: "${p.vendor || ""}", Type: "${p.productType || ""}", Colour: "${p.colour || ""}", Description: "${(p.description || "").slice(0, 100)}", Image URL: "${p.imageUrl || "NONE"}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a product image validator. Assess whether each product's image URL is likely to match the product described.

Analyse the URL structure, filename, CDN patterns, and any embedded product identifiers to determine if the image likely belongs to this product.

Return JSON array: [{"index": 0, "match": "likely"|"uncertain"|"mismatch", "confidence": 0-100, "reason": "..."}]

- "likely": URL contains brand/product hints matching the title
- "uncertain": can't determine from URL alone
- "mismatch": URL clearly belongs to a different product or brand`,
          },
          {
            role: "user",
            content: `Validate image-to-product matches:\n${list}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch { results = []; }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Conversion-focused audit ──
    if (action === "conversion_audit") {
      if (!products || !Array.isArray(products) || products.length === 0) {
        return new Response(JSON.stringify({ error: "products array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productList = products.slice(0, 25).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title || "Unknown"}", Vendor: "${p.vendor || ""}", Colour: "${p.colour || ""}", Type: "${p.productType || ""}", Image URL: "${p.imageUrl || "NONE"}", Variant Count: ${p.variantCount || 0}, Has Multiple Images: ${p.hasMultipleImages || false}, Image Dimensions: "${p.imageDimensions || "unknown"}"`
      ).join("\n");

      const response = await callAI({
        model: "google/gemini-3-flash-preview",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are an e-commerce conversion rate optimization (CRO) image auditor. For each product, analyse and score across 5 dimensions:

1. CONSISTENCY (0-100): Does the image URL suggest a consistent brand style? Look for:
   - Same CDN/domain patterns across products from same vendor
   - Similar filename conventions (suggesting same photographer/studio)
   - Flag any outliers that likely have different backgrounds or styles

2. VARIANT_MAPPING (0-100): How well are images mapped to variants?
   - If product has colour variants, does it likely have colour-specific images?
   - Flag products with multiple variants but only one image URL
   - Score higher if URL contains colour/variant identifiers

3. ZOOM_READINESS (0-100): Is the image likely high-resolution enough for zoom?
   - Check URL for size hints (e.g. 2048x, _large, _2000x)
   - Flag thumbnails or small images (64x, 100x, _small, _thumb)
   - Score based on likely resolution from URL patterns

4. MOBILE_OPTIMIZATION (0-100): Is the image likely optimised for mobile?
   - Check if CDN supports responsive images (Shopify CDN does)
   - Flag very large images without CDN resize parameters
   - Note if format supports modern compression (webp/avif hints)

5. HERO_SCORE (0-100): How suitable is this image as the main product image?
   - Higher for front/flat-lay/lifestyle images (from URL hints)
   - Lower for detail/back/side images
   - Consider if filename suggests primary image (_1, main, front, hero)

Return JSON array: [{"index": 0, "consistency": 85, "consistency_note": "...", "variant_mapping": 60, "variant_note": "...", "zoom_readiness": 90, "zoom_note": "...", "mobile_optimization": 75, "mobile_note": "...", "hero_score": 95, "hero_note": "...", "overall_score": 81, "top_issue": "...", "recommendation": "..."}]`,
          },
          {
            role: "user",
            content: `Audit these product images for conversion optimization:\n${productList}`,
          },
        ],
      });

      const raw = getContent(response);
      let results: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        results = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch { results = []; }

      // Ensure all results have index
      const output = products.slice(0, 25).map((_: any, i: number) => {
        const match = results.find((r: any) => r.index === i) || {};
        return {
          index: i,
          consistency: match.consistency ?? 50,
          consistency_note: match.consistency_note || "",
          variant_mapping: match.variant_mapping ?? 50,
          variant_note: match.variant_note || "",
          zoom_readiness: match.zoom_readiness ?? 50,
          zoom_note: match.zoom_note || "",
          mobile_optimization: match.mobile_optimization ?? 50,
          mobile_note: match.mobile_note || "",
          hero_score: match.hero_score ?? 50,
          hero_note: match.hero_note || "",
          overall_score: match.overall_score ?? 50,
          top_issue: match.top_issue || "",
          recommendation: match.recommendation || "",
        };
      });

      return new Response(JSON.stringify({ results: output }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("image-optimise error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
