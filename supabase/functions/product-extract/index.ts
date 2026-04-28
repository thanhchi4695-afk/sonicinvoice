// ════════════════════════════════════════════════════════════════
// product-extract — Edge Function entry point for the URL Product
// Extractor Agent. Receives { url } and returns normalised product
// data (name, description, price+currency, stored image URLs).
//
// Cascade (locked in mem://features/url-product-extractor):
//   1. JSON-LD / microdata parser
//   2. Universal DOM selectors (Cheerio)
//   3. LLM raw HTML extractor (AI Gateway)
//
// Steps 4 (Playwright) and 5 (3rd-party API) are intentionally NOT
// invoked here — they belong to a later roadmap phase.
// ════════════════════════════════════════════════════════════════

import { load as cheerioLoad } from "https://esm.sh/cheerio@1.0.0";
import { downloadImages, collectImageUrls } from "./image-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIMEOUT_MS = 20_000;

interface ExtractedProduct {
  name: string | null;
  description: string | null;
  price: string | null;          // raw price string as found on page
  currency: string | null;       // ISO 4217 code if known, else raw symbol
  imageUrls: string[];           // raw image URLs prior to download/optimise
  sourceUrl: string;
}

interface NormalisedPrice {
  value: number | null;
  currency: string | null;       // ISO code
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────
// Helpers expected from later tasks — wired as stubs for now
// ────────────────────────────────────────────────────────────────

// `downloadImages` + `collectImageUrls` now provided by ./image-pipeline.ts
// (Task 5 complete: streams via WASM imagescript → compressed-images bucket,
//  enforces 10MB kill-switch, follows priority order: og:image → near-price
//  → product container → gallery).

/**
 * TODO (Task 6): Replace with `currency-detector.ts` logic
 * (regex + currency-symbol-map + <html lang> cross-check).
 * For now, accept already-ISO currencies and pass through.
 */
function normalizeCurrency(price: string | null, currency: string | null): NormalisedPrice {
  const warnings: string[] = [];
  if (!price) return { value: null, currency, warnings };

  const numeric = parseFloat(price.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  const value = Number.isFinite(numeric) ? numeric : null;

  let iso = currency;
  if (iso && !/^[A-Z]{3}$/.test(iso)) {
    warnings.push(`Currency "${iso}" is not ISO 4217; needs detection (Task 6).`);
    iso = null;
  }
  if (!iso) warnings.push("Unknown currency — flag for manual review.");

  return { value, currency: iso, warnings };
}

// ────────────────────────────────────────────────────────────────
// Strategy 1 — JSON-LD / microdata Product schema
// ────────────────────────────────────────────────────────────────
function extractFromJsonLd($: ReturnType<typeof cheerioLoad>, sourceUrl: string): ExtractedProduct | null {
  // TODO (later refactor): move to src/lib/product-extract/jsonld-parser.ts
  const blocks = $('script[type="application/ld+json"]');
  for (const el of blocks.toArray()) {
    try {
      const raw = $(el).contents().text();
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const node of candidates) {
        if (!node || typeof node !== "object") continue;
        const type = node["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;

        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const images = Array.isArray(node.image) ? node.image : node.image ? [node.image] : [];

        return {
          name: node.name ?? null,
          description: node.description ?? null,
          price: offer?.price ? String(offer.price) : null,
          currency: offer?.priceCurrency ?? null,
          imageUrls: images.filter((x: unknown): x is string => typeof x === "string"),
          sourceUrl,
        };
      }
    } catch (e) {
      console.warn("[product-extract] JSON-LD parse error:", (e as Error).message);
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// Strategy 2 — Universal DOM selectors (Cheerio + meta tags)
// ────────────────────────────────────────────────────────────────
function extractWithSelectors($: ReturnType<typeof cheerioLoad>, sourceUrl: string): ExtractedProduct | null {
  // TODO (later refactor): move to src/lib/product-extract/dom-selectors.ts
  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr("content") || $(`meta[name="${name}"]`).attr("content") || null;

  const name =
    meta("og:title") ||
    $('h1[itemprop="name"]').first().text().trim() ||
    $("h1").first().text().trim() ||
    null;

  const description =
    meta("og:description") ||
    meta("description") ||
    $('[itemprop="description"]').first().text().trim() ||
    null;

  const price =
    $('[itemprop="price"]').attr("content") ||
    $('[itemprop="price"]').first().text().trim() ||
    meta("product:price:amount") ||
    $(".price, .product-price, [data-price]").first().text().trim() ||
    null;

  const currency =
    $('[itemprop="priceCurrency"]').attr("content") ||
    meta("product:price:currency") ||
    null;

  const ogImage = meta("og:image");
  const galleryImgs = $(".product-image img, .product-gallery img, [class*='product'] img")
    .map((_, el) => $(el).attr("src") || $(el).attr("data-src"))
    .get()
    .filter(Boolean) as string[];

  const imageUrls = Array.from(new Set([ogImage, ...galleryImgs].filter(Boolean) as string[]));

  if (!name && !price && imageUrls.length === 0) return null;

  return { name, description, price, currency, imageUrls, sourceUrl };
}

// ────────────────────────────────────────────────────────────────
// Strategy 3 — LLM raw HTML extraction (AI Gateway, tool-call JSON)
// ────────────────────────────────────────────────────────────────
async function extractWithLLM(html: string, sourceUrl: string): Promise<ExtractedProduct | null> {
  // TODO (later refactor): move to src/lib/product-extract/llm-extractor.ts
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[product-extract] LOVABLE_API_KEY missing — skipping LLM strategy");
    return null;
  }

  // Trim HTML to keep prompt cost down — body text + first 60KB
  const trimmed = html.length > 60_000 ? html.slice(0, 60_000) : html;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "Extract product info from raw HTML. Return strictly via the provided tool. Use the page's stated currency; do not guess.",
        },
        { role: "user", content: `URL: ${sourceUrl}\n\nHTML:\n${trimmed}` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_product",
            description: "Return the extracted product data.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price: { type: "string", description: "Numeric price as string, no currency symbol" },
                currency: { type: "string", description: "ISO 4217 code if known" },
                imageUrls: { type: "array", items: { type: "string" } },
              },
              required: ["name", "imageUrls"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_product" } },
    }),
  });

  if (!resp.ok) {
    console.warn("[product-extract] LLM gateway error", resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return {
      name: parsed.name ?? null,
      description: parsed.description ?? null,
      price: parsed.price ?? null,
      currency: parsed.currency ?? null,
      imageUrls: Array.isArray(parsed.imageUrls) ? parsed.imageUrls : [],
      sourceUrl,
    };
  } catch (e) {
    console.warn("[product-extract] LLM JSON parse error", (e as Error).message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// Orchestrator + HTTP handler
// ────────────────────────────────────────────────────────────────
async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SonicInvoiceBot/1.0; +https://sonicinvoices.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!r.ok) throw new Error(`Source returned ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!isHttpUrl(body.url)) {
    return jsonResponse({ success: false, error: "Body must include a valid http(s) `url`" }, 400);
  }
  const url = body.url;

  const overall = AbortSignal.timeout(TIMEOUT_MS);
  const start = Date.now();

  try {
    const html = await fetchHtml(url);
    const $ = cheerioLoad(html);

    // Cascade — escalate only on null
    let product: ExtractedProduct | null = extractFromJsonLd($, url);
    let strategyUsed: "jsonld" | "selectors" | "llm" | null = product ? "jsonld" : null;

    if (!product) {
      product = extractWithSelectors($, url);
      if (product) strategyUsed = "selectors";
    }
    if (!product) {
      if (overall.aborted) throw new Error("Timeout before LLM strategy");
      product = await extractWithLLM(html, url);
      if (product) strategyUsed = "llm";
    }

    if (!product) {
      return jsonResponse(
        { success: false, error: "Could not extract product data from URL" },
        422,
      );
    }

    // Step 5 — image download/optimise (stub until Task 5)
    const images = await downloadImages(product.imageUrls, url);

    // Step 4 — currency normalisation (stub until Task 6)
    const priceNormalized = normalizeCurrency(product.price, product.currency);

    return jsonResponse({
      success: true,
      product: {
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        priceNormalized,
        images,
        sourceUrl: url,
        extractedAt: new Date().toISOString(),
        strategyUsed,
        durationMs: Date.now() - start,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[product-extract] failed", { url, message });
    const status = message.toLowerCase().includes("timeout") || message.includes("aborted") ? 504 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
