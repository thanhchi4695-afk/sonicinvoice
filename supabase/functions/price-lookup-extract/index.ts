import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import { findBrandHint } from "../_shared/brand-extraction-hints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";
const CACHE_TTL_HOURS = 24;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, product_name, supplier, style_number, colour, supplier_cost, force_refresh } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Cache check: if we successfully extracted this URL within the last 24h, return cached row ──
    // Skips Firecrawl + AI cost entirely.
    if (!force_refresh) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const authHeader = req.headers.get("Authorization");

        if (supabaseUrl && serviceKey && authHeader) {
          const userClient = createClient(supabaseUrl, serviceKey, {
            global: { headers: { Authorization: authHeader } },
          });
          const { data: { user } } = await userClient.auth.getUser();

          if (user) {
            const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
            const admin = createClient(supabaseUrl, serviceKey);
            const { data: cached } = await admin
              .from("price_lookups")
              .select("*")
              .eq("user_id", user.id)
              .eq("source_url", url)
              .gte("updated_at", cutoff)
              .not("retail_price_aud", "is", null)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (cached) {
              const ageMin = Math.round((Date.now() - new Date(cached.updated_at).getTime()) / 60000);
              return new Response(JSON.stringify({
                product_name: cached.product_name,
                brand: cached.supplier,
                retail_price_aud: cached.retail_price_aud,
                sale_price_aud: null,
                compare_at_price_aud: null,
                currency_detected: "AUD",
                currency_confidence: cached.price_confidence ?? 90,
                image_urls: cached.image_urls ?? [],
                description: cached.description,
                page_title: null,
                source_url: cached.source_url,
                fetch_success: true,
                fetch_error: null,
                cached: true,
                cache_age_minutes: ageMin,
                description_source: cached.description ? "scraped" : null,
                status_code: 200,
                scraper: "firecrawl",
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
          }
        }
      } catch (cacheErr) {
        console.warn("Cache check failed (continuing to scrape):", cacheErr);
      }
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
        status_code: statusCode || null,
        scraper: "firecrawl",
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
- description: The main marketing/editorial copy describing the product (the "story" / hero prose). This is usually 1-4 sentences of flowing prose that sells the product — NOT a bullet list, NOT fabric, NOT care.
  • IT MAY NOT BE LABELLED "Description" — on many brand sites it appears as plain prose directly below the product title and price, before any "Details", "Features", "Fabric", or "Care" sections.
  • If you see ANY prose paragraph(s) about the product near the title (even unlabelled), capture them as the description.
  • Only return null if the page truly contains zero prose about the product (e.g. only bullet lists and spec tables).
  • Strip promo banners ("Free shipping", "Buy now pay later"), size charts, reviews, "You may also like", and navigation crumbs.
- key_features: Bullet list of feature highlights (e.g. "Removable padding", "Adjustable straps", "Fully lined"). These are SHORT phrases, distinct from the prose description.
- fabric_content: Material composition exactly as stated (e.g. "82% Recycled Nylon, 18% Elastane").
- care_instructions: Wash/care guidance (e.g. "Hand wash cold, do not tumble dry").
- fit_notes: Anything about fit/sizing (e.g. "True to size", "Model wears size 8", "Adjustable for a custom fit").

IMPORTANT: If you successfully extract key_features OR fabric_content, the page clearly has product copy — re-scan the markdown for prose near the product title and populate the description field. Do not leave it null when prose is present.

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
    parsed.status_code = statusCode || 200;
    parsed.scraper = "firecrawl";
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
