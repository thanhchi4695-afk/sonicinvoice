// Edge function: pricing-competitor-fetch
// Takes a single competitor product URL and returns { price, currency, title, source }.
// Strategy cascade:
//   1. Fetch HTML
//   2. Parse JSON-LD <script type="application/ld+json"> for Product schema
//   3. Fall back to OpenGraph meta tags (og:price:amount, product:price:amount)
//   4. Fall back to Shopify-style /products/<handle>.json
//   5. Last resort: Gemini extraction from HTML body

import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ScrapeResult {
  price: number | null;
  currency: string | null;
  title: string | null;
  source: "json-ld" | "og-meta" | "shopify-json" | "ai" | "none";
  raw?: unknown;
}

function extractFromJsonLd(html: string): Partial<ScrapeResult> | null {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = item["@graph"] ?? [item];
        for (const node of graph) {
          if (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product"))) {
            const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
            const price = offers?.price ?? offers?.lowPrice;
            if (price) {
              return {
                price: parseFloat(String(price)),
                currency: offers?.priceCurrency ?? null,
                title: node.name ?? null,
                source: "json-ld",
              };
            }
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return null;
}

function extractFromOgMeta(html: string): Partial<ScrapeResult> | null {
  const re = (name: string) =>
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  const altRe = (name: string) =>
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i");
  const find = (n: string) => html.match(re(n))?.[1] ?? html.match(altRe(n))?.[1] ?? null;

  const price = find("product:price:amount") ?? find("og:price:amount") ?? find("twitter:data1");
  if (!price) return null;
  return {
    price: parseFloat(String(price).replace(/[^0-9.]/g, "")),
    currency: find("product:price:currency") ?? find("og:price:currency"),
    title: find("og:title"),
    source: "og-meta",
  };
}

async function tryShopifyJson(url: string): Promise<Partial<ScrapeResult> | null> {
  // Shopify product URLs follow /products/<handle>; appending .json returns structured data.
  const m = url.match(/^(https?:\/\/[^\/]+\/products\/[^\/?#]+)/i);
  if (!m) return null;
  try {
    const res = await fetch(`${m[1]}.json`, {
      headers: { "User-Agent": "SonicInvoices/1.0 (price-comparison)" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const variant = data?.product?.variants?.[0];
    if (!variant?.price) return null;
    return {
      price: parseFloat(variant.price),
      currency: null,
      title: data.product.title ?? null,
      source: "shopify-json",
    };
  } catch {
    return null;
  }
}

async function aiExtractPrice(html: string, url: string): Promise<Partial<ScrapeResult> | null> {
  const trimmed = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);

  try {
    const res = await callAI({
      messages: [
        {
          role: "user",
          content: `Extract the current sale price (number only), currency code, and product title from this product page text.
Return JSON: {"price": number|null, "currency": "USD"|"AUD"|..., "title": "..."}

URL: ${url}
Text: ${trimmed}`,
        },
      ],
      modelPreference: ["google/gemini-2.5-flash"],
      jsonMode: true,
    });
    const content = getContent(res);
    const parsed = JSON.parse(content);
    if (typeof parsed.price === "number" && parsed.price > 0) {
      return {
        price: parsed.price,
        currency: parsed.currency ?? null,
        title: parsed.title ?? null,
        source: "ai",
      };
    }
  } catch (e) {
    console.warn("AI extract failed:", e);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return json({ error: "Valid http(s) URL required" }, 400);
    }

    // Try Shopify .json shortcut first (cheapest + most accurate when applicable)
    const shopify = await tryShopifyJson(url);
    if (shopify?.price) {
      return json({ ok: true, ...shopify, url });
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SonicInvoicesBot/1.0; +https://sonicinvoices.com/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return json({ error: `Failed to fetch URL: ${res.status}` }, 502);
    const html = await res.text();

    const ld = extractFromJsonLd(html);
    if (ld?.price) return json({ ok: true, ...ld, url });

    const og = extractFromOgMeta(html);
    if (og?.price) return json({ ok: true, ...og, url });

    const ai = await aiExtractPrice(html, url);
    if (ai?.price) return json({ ok: true, ...ai, url });

    return json({ ok: false, source: "none", price: null, message: "Could not detect price on page" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("pricing-competitor-fetch error:", msg);
    return json({ error: msg }, 500);
  }
});
