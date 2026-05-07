/**
 * find-product-url
 *
 * Given a brand website + a style number or product name, find the
 * supplier's product page URL. Used by the product-enrichment pipeline
 * before handing off to product-extract.
 *
 * Strategies (first success wins):
 *   1. On-site search (high confidence)
 *   2. Direct URL guess (high confidence)
 *   3. Brave Search fallback (low confidence)
 */

import * as cheerio from "https://esm.sh/cheerio@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STRATEGY_TIMEOUT_MS = 5000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; SonicInvoiceBot/1.0; +https://sonicinvoices.com)";

type Confidence = "high" | "low" | "not_found";
type Strategy = "search" | "direct" | "brave" | null;

interface Result {
  url: string | null;
  confidence: Confidence;
  strategy_used: Strategy;
  brand_website: string;
}

// ─── Helpers ────────────────────────────────────────────────

function normaliseWebsite(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = STRATEGY_TIMEOUT_MS,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) },
      redirect: "follow",
    });
  } catch (err) {
    console.warn(`[find-product-url] fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── Strategy 1: On-site search ─────────────────────────────

async function tryOnSiteSearch(
  brandWebsite: string,
  query: string,
): Promise<string | null> {
  const base = `https://${brandWebsite}`;
  const searchUrls = [
    `${base}/search?q=${encodeURIComponent(query)}`,
    `${base}/search?type=product&q=${encodeURIComponent(query)}`,
  ];

  for (const searchUrl of searchUrls) {
    console.log(`[strategy:search] GET ${searchUrl}`);
    const res = await fetchWithTimeout(searchUrl);
    if (!res || !res.ok) {
      console.log(`[strategy:search] miss (status=${res?.status ?? "fetch_error"})`);
      continue;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const selectors = [
      'a[href*="/products/"]',
      ".product-item a",
      ".grid-product a",
      "[data-product-id] a",
    ];

    for (const sel of selectors) {
      const href = $(sel).first().attr("href");
      if (href) {
        const abs = absoluteUrl(href, base);
        if (abs && abs.includes("/products/")) {
          console.log(`[strategy:search] hit via "${sel}" → ${abs}`);
          return abs;
        }
      }
    }
    console.log("[strategy:search] no product link in result HTML");
  }
  return null;
}

// ─── Strategy 2: Direct URL guess ───────────────────────────

async function tryDirectGuess(
  brandWebsite: string,
  productName: string,
): Promise<string | null> {
  const slug = slugify(productName);
  if (!slug) return null;

  const base = `https://${brandWebsite}`;
  const candidates = [
    `${base}/products/${slug}`,
    `${base}/collections/all/${slug}`,
  ];

  for (const url of candidates) {
    console.log(`[strategy:direct] HEAD ${url}`);
    const res = await fetchWithTimeout(url, { method: "HEAD" });
    if (!res) continue;
    if (res.status === 200 || res.status === 301 || res.status === 302) {
      console.log(`[strategy:direct] hit (status=${res.status}) → ${url}`);
      return url;
    }
    console.log(`[strategy:direct] miss (status=${res.status})`);
  }
  return null;
}

// ─── Strategy 3: Brave Search ───────────────────────────────

async function tryBraveSearch(
  brandWebsite: string,
  query: string,
): Promise<string | null> {
  const key = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!key) {
    console.warn("[strategy:brave] BRAVE_SEARCH_API_KEY not configured — skipping");
    return null;
  }
  const fullQuery = `site:${brandWebsite} ${query}`;
  console.log(`[strategy:brave] query: ${fullQuery}`);
  const res = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(fullQuery)}&count=10`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
  );
  if (!res || !res.ok) {
    console.warn(`[strategy:brave] api failed (status=${res?.status ?? "fetch_error"})`);
    return null;
  }
  const data = await res.json().catch(() => null);
  const results: Array<{ url?: string }> = data?.web?.results ?? [];
  for (const r of results) {
    if (r.url && r.url.includes("/products/")) {
      console.log(`[strategy:brave] hit → ${r.url}`);
      return r.url;
    }
  }
  console.log("[strategy:brave] no /products/ url in results");
  return null;
}

// ─── Main handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: {
    brand_website?: string;
    style_number?: string;
    product_name?: string;
    vendor?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const brandRaw = body.brand_website?.trim();
  if (!brandRaw) {
    return new Response(
      JSON.stringify({ error: "brand_website is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!body.style_number && !body.product_name) {
    return new Response(
      JSON.stringify({ error: "style_number or product_name is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const brandWebsite = normaliseWebsite(brandRaw);
  const styleNumber = body.style_number?.trim() || null;
  const productName = body.product_name?.trim() || null;

  console.log(
    `[find-product-url] brand=${brandWebsite} style=${styleNumber ?? "-"} name=${productName ?? "-"}`,
  );

  const respond = (r: Result) =>
    new Response(JSON.stringify(r), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Strategy 1: search using style number first, then product name
  for (const q of [styleNumber, productName].filter(Boolean) as string[]) {
    try {
      const hit = await tryOnSiteSearch(brandWebsite, q);
      if (hit) {
        return respond({ url: hit, confidence: "high", strategy_used: "search", brand_website: brandWebsite });
      }
    } catch (err) {
      console.warn("[strategy:search] threw:", err instanceof Error ? err.message : err);
    }
  }

  // Strategy 2: direct guess (needs a product name)
  if (productName) {
    try {
      const hit = await tryDirectGuess(brandWebsite, productName);
      if (hit) {
        return respond({ url: hit, confidence: "high", strategy_used: "direct", brand_website: brandWebsite });
      }
    } catch (err) {
      console.warn("[strategy:direct] threw:", err instanceof Error ? err.message : err);
    }
  }

  // Strategy 3: Brave fallback
  try {
    const braveQuery = styleNumber ? `"${styleNumber}"` : (productName as string);
    const hit = await tryBraveSearch(brandWebsite, braveQuery);
    if (hit) {
      return respond({ url: hit, confidence: "low", strategy_used: "brave", brand_website: brandWebsite });
    }
  } catch (err) {
    console.warn("[strategy:brave] threw:", err instanceof Error ? err.message : err);
  }

  return respond({ url: null, confidence: "not_found", strategy_used: null, brand_website: brandWebsite });
});
