// Fetch a clean product description AND product image for an invoice line item.
//
// Real fetch chain (in order):
//   1) Brand's own website (guessed from brand name)
//   2) theiconic.com.au (Australian retailer fallback)
//   3) davidjones.com (Australian retailer fallback)
//   4) AI-generated description (always succeeds)
//
// Each attempt is recorded with {url, status, reason, found} so the UI can
// show "Tried: [url] — Status: [code] — Reason: [...]" diagnostics — even
// when we end up succeeding on a later step.

import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";
import { processImageForAI } from "../_shared/image-resize.ts";

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
  colour?: string;
}

type Reason =
  | "ok"
  | "empty_response"
  | "blocked"
  | "selector_not_matched"
  | "too_short"
  | "no_search_results"
  | "fetch_error"
  | "skipped";

interface Attempt {
  url: string;
  status: number; // 0 if never executed
  reason: Reason;
  found: boolean;
  selector?: string;
  aiRawPreview?: string;
}

interface ResponsePayload {
  description: string | null;
  full_product_name: string | null;
  source_url: string;
  source_name: string;
  source_type: "supplier" | "retailer" | "ai_generated";
  word_count: number;
  raw_word_count: number;
  confidence: "high" | "medium" | "low";
  image_url: string | null;
  image_source_url: string | null;
  attempts: Attempt[];
  image_attempts: Attempt[];
  ai_raw_preview?: string;
  image_stats: {
    processed: number;
    resized: number;
    skipped: number;
    last_error?: string;
    original_width?: number;
    original_height?: number;
    final_width?: number;
    final_height?: number;
  };
}

const SCRAPED_AI_PREVIEW = "n/a — description scraped directly";

function withAiRawPreview(attempts: Attempt[], preview: string): Attempt[] {
  return attempts.map((attempt) => ({
    ...attempt,
    aiRawPreview: attempt.aiRawPreview || preview,
  }));
}

// ─── Helpers ────────────────────────────────────────────────
const BROWSER_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": BROWSER_UAS[Math.floor(Math.random() * BROWSER_UAS.length)],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  };
}

function slug(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[''’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function brandDomainGuesses(brand: string): string[] {
  const s = slug(brand);
  if (!s) return [];
  const flat = s.replace(/-/g, "");
  const bases = flat === s ? [s] : [s, flat];
  const out: string[] = [];
  for (const tld of ["com.au", "com"]) {
    for (const base of bases) out.push(`${base}.${tld}`);
  }
  // Common pattern: <brand>swim.com (Bond Eye → bondeyeswim.com)
  out.push(`${flat}swim.com`);
  return Array.from(new Set(out));
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function stripHtml(s: string): string {
  return decodeHtmlEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isChallengeStub(html: string): boolean {
  if (!html) return true;
  if (html.length < 600) return true;
  return /KPSDK|kasada|cf-browser-verification|challenge-platform|Just a moment\.\.\./i.test(html);
}

// ─── Fetch with Firecrawl fallback ───────────────────────────
async function fetchHtml(url: string): Promise<{ html: string; status: number; via: "direct" | "firecrawl" }> {
  // Direct fetch with browser-like headers
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: browserHeaders(), redirect: "follow" });
      const status = res.status;
      if (res.ok) {
        const html = await res.text();
        if (!isChallengeStub(html)) return { html, status, via: "direct" };
      }
      if ([403, 429, 503].includes(status)) {
        await new Promise((r) => setTimeout(r, 400 + attempt * 300));
        continue;
      }
      // Other non-2xx → break to firecrawl
      if (!res.ok) {
        // try firecrawl
        return tryFirecrawl(url, status);
      }
    } catch (_e) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return tryFirecrawl(url, 429);
}

async function tryFirecrawl(url: string, lastStatus: number): Promise<{ html: string; status: number; via: "direct" | "firecrawl" }> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return { html: "", status: lastStatus, via: "direct" };
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["html"],
        onlyMainContent: false,
        proxy: "stealth",
        waitFor: 2000,
      }),
    });
    const j = await res.json().catch(() => null) as Record<string, unknown> | null;
    const data = (j?.data ?? j) as Record<string, unknown> | undefined;
    const html = (data?.html as string) || (data?.rawHtml as string) || "";
    const upstream = (data?.metadata as Record<string, unknown> | undefined)?.statusCode as number | undefined;
    if (html && !isChallengeStub(html)) {
      return { html, status: upstream ?? 200, via: "firecrawl" };
    }
    return { html: "", status: upstream ?? lastStatus, via: "firecrawl" };
  } catch {
    return { html: "", status: lastStatus, via: "direct" };
  }
}

// ─── Brave Search to find product URL on a domain ───────────
async function braveFindProductUrl(query: string, site?: string): Promise<{ url: string | null; results: number }> {
  const key = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!key) return { url: null, results: 0 };
  const q = site ? `${query} site:${site}` : query;
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8&country=au`,
      { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
    );
    if (!res.ok) return { url: null, results: 0 };
    const j = await res.json() as { web?: { results?: { url: string }[] } };
    const results = j.web?.results ?? [];
    if (!results.length) return { url: null, results: 0 };
    // Prefer URLs that look like product pages
    const productLike = results.find((r) =>
      /\/product[s]?\/|\/p\/|\/dp\//i.test(r.url)
    );
    return { url: (productLike ?? results[0]).url, results: results.length };
  } catch {
    return { url: null, results: 0 };
  }
}

// ─── Selector-based extraction ──────────────────────────────
interface Extracted {
  description: string | null;
  fullName: string | null;
  imageUrl: string | null;
  selector: string;
}

function extractFromHtml(html: string): Extracted {
  const out: Extracted = { description: null, fullName: null, imageUrl: null, selector: "none" };
  if (!html) return out;

  // 1) JSON-LD product schema (most reliable)
  const ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldMatches) {
    const inner = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "").trim();
    try {
      const parsed = JSON.parse(inner);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of items) {
        const list = node?.["@graph"] && Array.isArray(node["@graph"]) ? node["@graph"] : [node];
        for (const it of list) {
          const t = it?.["@type"];
          const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
          if (!isProduct) continue;
          const desc = typeof it.description === "string" ? stripHtml(it.description) : null;
          const name = typeof it.name === "string" ? it.name.trim() : null;
          let img: string | null = null;
          if (typeof it.image === "string") img = it.image;
          else if (Array.isArray(it.image) && it.image.length) img = typeof it.image[0] === "string" ? it.image[0] : it.image[0]?.url ?? null;
          else if (it.image?.url) img = it.image.url;
          if (desc) out.description = desc;
          if (name) out.fullName = name;
          if (img) out.imageUrl = img;
          if (out.description) {
            out.selector = "json-ld:Product";
            return out;
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 2) og:description / og:image / og:title
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] ?? null;
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;
  if (ogDesc) {
    out.description = decodeHtmlEntities(ogDesc).trim();
    out.selector = "og:description";
  }
  if (ogTitle && !out.fullName) out.fullName = decodeHtmlEntities(ogTitle).trim();
  if (ogImage && !out.imageUrl) out.imageUrl = ogImage;

  // 3) meta description fallback
  if (!out.description) {
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (metaDesc) {
      out.description = decodeHtmlEntities(metaDesc).trim();
      out.selector = "meta:description";
    }
  }

  return out;
}

function makeAbsolute(url: string | null, base: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

// ─── AI fallback description generator ──────────────────────
async function aiGenerateDescription(body: RequestBody): Promise<{ description: string | null; preview: string }> {
  const sys = `You are a retail copywriter for an Australian boutique fashion store.
Write a 50-90 word product description in Australian English. Two short paragraphs max.
No emojis, no hype words, no price/shipping/sale mentions. Plain text only — no markdown, no quotes.
Use only the facts given; do not invent fabric, sizing, or care details.`;
  const user = `Product: ${body.style_name}
Brand: ${body.brand}
Product type: ${body.product_type || "(unknown)"}
Colour: ${body.colour || "(unknown)"}
Style number: ${body.style_number || "(none)"}`;
  const preview = user.slice(0, 200);
  try {
    const r = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      max_tokens: 400,
    });
    const txt = (getContent(r) || "").trim();
    return { description: txt || null, preview };
  } catch (e) {
    console.error("[fetch-desc] aiGenerateDescription failed", e);
    return { description: null, preview };
  }
}

// ─── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.style_name || !body.brand) {
    return new Response(JSON.stringify({ error: "style_name and brand are required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const attempts: Attempt[] = [];
  const imageAttempts: Attempt[] = [];

  // Build site list: brand domain guesses → retailer fallbacks
  const brandDomains = brandDomainGuesses(body.brand);
  const retailerDomains = ["theiconic.com.au", "davidjones.com"];
  const sites: Array<{ host: string; type: "supplier" | "retailer" }> = [
    ...brandDomains.map((h) => ({ host: h, type: "supplier" as const })),
    ...retailerDomains.map((h) => ({ host: h, type: "retailer" as const })),
  ];

  const query = `${body.brand} ${body.style_name}${body.style_number ? " " + body.style_number : ""}`;

  let result: ResponsePayload | null = null;

  const styleNum = (body.style_number || "").trim();
  const styleNumLower = styleNum.toLowerCase();

  for (const site of sites) {
    // 1) Find a product URL on this site via Brave Search
    const search = await braveFindProductUrl(query, site.host);
    if (!search.url) {
      attempts.push({ url: `site:${site.host}`, status: 0, reason: "no_search_results", found: false });
      continue;
    }

    // 1b) BUG 4 fix — when an invoice style_number is supplied, require it to
    // appear verbatim in the resolved URL. Prevents fuzzy collisions like
    // BOUND352E → bound234e-nina-crop on bond-eye.com.au. If no exact match,
    // fall through to the next site/AI fallback rather than serving a wrong page.
    if (styleNumLower && !search.url.toLowerCase().includes(styleNumLower)) {
      console.log(`[match] REJECTED: ${search.url} does not contain ${styleNum}`);
      attempts.push({
        url: search.url,
        status: 0,
        reason: "no_search_results",
        found: false,
        selector: `style_number_mismatch:${styleNum}`,
      });
      continue;
    }

    // 2) Fetch the page
    const fetched = await fetchHtml(search.url);
    if (!fetched.html) {
      attempts.push({
        url: search.url,
        status: fetched.status,
        reason: fetched.status === 403 || fetched.status === 429 ? "blocked" : "empty_response",
        found: false,
      });
      continue;
    }

    // 3) Extract
    const ex = extractFromHtml(fetched.html);
    const desc = ex.description?.trim() || "";
    const wc = wordCount(desc);

    if (!desc) {
      attempts.push({
        url: search.url, status: fetched.status, reason: "selector_not_matched", found: false, selector: ex.selector,
      });
      continue;
    }
    if (wc < 12) {
      attempts.push({
        url: search.url, status: fetched.status, reason: "too_short", found: false, selector: ex.selector,
      });
      continue;
    }

    // Success
    attempts.push({ url: search.url, status: fetched.status, reason: "ok", found: true, selector: ex.selector });
    const absImg = makeAbsolute(ex.imageUrl, search.url);
    let imageStats: ResponsePayload["image_stats"] = { processed: 0, resized: 0, skipped: 0 };
    let safeImg: string | null = absImg;
    if (absImg) {
      // Dimension-check & downscale to keep us safely under Claude's 2000px limit
      // for any downstream vision call. Best-effort — failures fall through to
      // returning the raw URL with a "skipped" status.
      try {
        const p = await processImageForAI(absImg, body.style_name || "image");
        imageStats = {
          processed: p.ok ? 1 : 0,
          resized: p.resized ? 1 : 0,
          skipped: p.ok ? 0 : 1,
          last_error: p.error,
          original_width: p.originalWidth,
          original_height: p.originalHeight,
          final_width: p.finalWidth,
          final_height: p.finalHeight,
        };
        if (!p.ok) {
          safeImg = null;
          imageAttempts.push({
            url: absImg,
            status: fetched.status,
            reason: "fetch_error",
            found: false,
            selector: "image-resize:" + (p.error || "failed"),
          });
        } else {
          imageAttempts.push({ url: absImg, status: fetched.status, reason: "ok", found: true, selector: ex.selector });
        }
      } catch (e) {
        imageStats = { processed: 0, resized: 0, skipped: 1, last_error: (e as Error).message };
        imageAttempts.push({ url: absImg, status: fetched.status, reason: "fetch_error", found: false });
      }
    } else {
      imageAttempts.push({ url: search.url, status: fetched.status, reason: "selector_not_matched", found: false, selector: ex.selector });
    }
    result = {
      description: desc.length > 1200 ? desc.slice(0, 1200).replace(/\s+\S*$/, "…") : desc,
      full_product_name: ex.fullName,
      source_url: search.url,
      source_name: site.host,
      source_type: site.type,
      word_count: wordCount(desc),
      raw_word_count: wc,
      confidence: site.type === "supplier" ? "high" : "medium",
      image_url: safeImg,
      image_source_url: search.url,
      attempts: withAiRawPreview(attempts, SCRAPED_AI_PREVIEW),
      image_attempts: imageAttempts,
      image_stats: imageStats,
      ai_raw_preview: SCRAPED_AI_PREVIEW,
    };
    break;
  }

  // 4) Final AI fallback — must always produce something usable
  if (!result) {
    const { description: aiDesc, preview: aiPreview } = await aiGenerateDescription(body);
    const emptyStats = { processed: 0, resized: 0, skipped: 0 };
    if (aiDesc) {
      result = {
        description: aiDesc,
        full_product_name: null,
        source_url: "",
        source_name: "AI generated",
        source_type: "ai_generated",
        word_count: wordCount(aiDesc),
        raw_word_count: wordCount(aiDesc),
        confidence: "low",
        image_url: null,
        image_source_url: null,
        attempts: withAiRawPreview(attempts, aiPreview),
        image_attempts: imageAttempts,
        image_stats: emptyStats,
        ai_raw_preview: aiPreview,
      };
    } else {
      result = {
        description: null,
        full_product_name: null,
        source_url: "",
        source_name: "",
        source_type: "ai_generated",
        word_count: 0,
        raw_word_count: 0,
        confidence: "low",
        image_url: null,
        image_source_url: null,
        attempts: withAiRawPreview(attempts, aiPreview),
        image_attempts: imageAttempts,
        image_stats: emptyStats,
        ai_raw_preview: aiPreview,
      };
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
