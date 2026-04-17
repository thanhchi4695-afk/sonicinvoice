import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import { findBrandHint } from "../_shared/brand-extraction-hints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, product_name, supplier, style_number, colour, supplier_cost } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Scrape via Firecrawl (renders JS, follows redirects, beats bot blockers) ──
    let pageMarkdown = "";
    let pageTitle = "";
    let finalUrl = url;
    let fetchError = "";
    let statusCode = 0;

    // Per-brand hints: pass tighter includeTags/excludeTags + longer waitFor for known sites.
    const brandHint = findBrandHint(url);
    const scrapeBody: Record<string, unknown> = {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      // JS-rendered sites (Iconic, Myer, David Jones, Zimmermann) need longer waits
      // Firecrawl runs a real headless browser, so this gives JS time to hydrate
      waitFor: brandHint?.waitFor ?? 2500,
      mobile: false,
      blockAds: true,
      location: { country: "AU", languages: ["en-AU", "en"] },
    };
    if (brandHint?.includeTags?.length) scrapeBody.includeTags = brandHint.includeTags;
    if (brandHint?.excludeTags?.length) scrapeBody.excludeTags = brandHint.excludeTags;

    try {
      const fcRes = await fetch(`${FIRECRAWL_API}/scrape`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(scrapeBody),
      });

      const fcData = await fcRes.json();

      if (!fcRes.ok) {
        fetchError = `Firecrawl ${fcRes.status}: ${fcData?.error || "scrape failed"}`;
      } else {
        // v2 SDK shape vs raw REST shape
        const doc = fcData?.data ?? fcData;
        pageMarkdown = doc?.markdown || "";
        const meta = doc?.metadata || {};
        pageTitle = meta.title || "";
        finalUrl = meta.sourceURL || meta.url || url;
        statusCode = meta.statusCode || 0;

        // Bug 1 guard: if Firecrawl landed on a category/listing page (no real product info), flag it
        if (statusCode === 404) {
          fetchError = `HTTP 404 — page does not exist`;
          pageMarkdown = "";
        } else if (!pageMarkdown || pageMarkdown.length < 200) {
          fetchError = "Page returned empty or too-short content";
        }

        // Truncate to fit AI context
        if (pageMarkdown.length > 20000) {
          pageMarkdown = pageMarkdown.slice(0, 20000);
        }
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "Failed to scrape page";
    }

    // ── If we couldn't fetch the page, return early with a HONEST empty result.
    //    Do NOT ask the AI to "guess" — that's how Bug 3 (empty desc) + Bug 4 (false currency warning) happened.
    if (fetchError || !pageMarkdown) {
      return new Response(JSON.stringify({
        product_name: null,
        brand: supplier || null,
        retail_price_aud: null,
        sale_price_aud: null,
        compare_at_price_aud: null,
        currency_detected: null, // ← null (not "AUD" with 0%) so UI can hide the misleading warning
        currency_confidence: 0,
        image_urls: [],
        description: null,
        key_features: null,
        fabric_content: null,
        care_instructions: null,
        fit_notes: null,
        sizes_available: null,
        colours_available: null,
        page_title: pageTitle || null,
        extraction_notes: fetchError
          ? `Could not load page (${fetchError}). Try a different result or paste a working URL.`
          : "No content extracted from page.",
        price_matches_cost: false,
        price_vs_cost_note: null,
        source_url: finalUrl,
        fetch_success: false,
        fetch_error: fetchError || "no_content",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Bug 3 fix: explicit, granular extraction prompt ──
    const systemPrompt = `You are a product data extraction specialist for Australian fashion retailers.
You receive cleaned markdown from a product page. Extract product information accurately.

CRITICAL RULES:
1. Use ONLY information present in the markdown. NEVER invent prices, sizes, or descriptions.
2. AUD prices only. If the page shows USD/EUR/GBP, set currency_detected accordingly and DO NOT convert.
3. If you cannot find a price on the page, set retail_price_aud to null and currency_detected to null.
4. Output raw numbers — no thousands separators, no currency symbols (e.g. 129.95 not "$1,299.95").
5. Prefer JSON-LD / Open Graph / schema.org data when present in the markdown.

EXTRACT (separately, each can be null):
- description: The main marketing/editorial copy describing the product (the "story"). Strip HTML, promo banners, "Free shipping" lines, size charts, reviews.
- key_features: Bullet list of feature highlights (e.g. "Removable padding", "Adjustable straps", "Fully lined").
- fabric_content: Material composition exactly as stated (e.g. "82% Recycled Nylon, 18% Elastane").
- care_instructions: Wash/care guidance (e.g. "Hand wash cold, do not tumble dry").
- fit_notes: Anything about fit/sizing (e.g. "True to size", "Model wears size 8", "Adjustable for a custom fit").

Return STRICT JSON ONLY (no markdown fences, no preamble):
{
  "product_name": "Full product name as shown on page",
  "brand": "Brand name",
  "retail_price_aud": 129.95,
  "sale_price_aud": null,
  "compare_at_price_aud": null,
  "currency_detected": "AUD",
  "currency_confidence": 95,
  "image_urls": ["https://..."],
  "description": "Cleaned marketing description...",
  "key_features": ["Removable padding", "Adjustable straps"],
  "fabric_content": "82% Recycled Nylon, 18% Elastane",
  "care_instructions": "Hand wash cold",
  "fit_notes": "True to size",
  "sizes_available": ["8", "10", "12"],
  "colours_available": ["Black", "White"],
  "page_title": "Page title",
  "extraction_notes": "Notes about data quality or what was missing",
  "price_matches_cost": false,
  "price_vs_cost_note": "Retail is 2.5x supplier cost"
}`;

    const brandHintLine = brandHint?.promptHint
      ? `\nBRAND HINT (${brandHint.name}): ${brandHint.promptHint}\n`
      : "";

    const userContent = `Extract product data from this page.

Looking for: ${product_name}
Brand: ${supplier || "unknown"}
Style Number: ${style_number || "N/A"}
Colour: ${colour || "N/A"}
Supplier cost (ex GST): ${supplier_cost ? `$${supplier_cost} AUD` : "unknown"}

Source URL: ${finalUrl}
Page title: ${pageTitle}${brandHintLine}

PAGE CONTENT (markdown):
---
${pageMarkdown}
---`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Failed to parse AI extraction response");
    }

    // Bug 4 guard: if no price was extracted, force currency to null so the UI hides the warning
    if (parsed.retail_price_aud == null && parsed.sale_price_aud == null) {
      parsed.currency_detected = null;
      parsed.currency_confidence = 0;
    }

    parsed.source_url = finalUrl;
    parsed.fetch_success = true;
    parsed.fetch_error = null;
    parsed.page_title = parsed.page_title || pageTitle || null;
    parsed.brand_hint_applied = brandHint?.name || null;
    // Mark whether the description was successfully scraped from the page
    parsed.description_source = parsed.description && parsed.description.trim().length > 20 ? "scraped" : null;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("price-lookup-extract error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
