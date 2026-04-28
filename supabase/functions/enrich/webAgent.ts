// ───────────────────────────────────────────────────────────────
// Web Agent
// Searches the open web via the Brave Search API and extracts
// product details from the best-matching result.
//
// NOTE: Supabase Edge Functions run on Deno — `wdot` and `cheerio`
// (Node-only) aren't available, so we use `fetch` + `deno-dom`,
// matching the supplierAgent fallback approach.
// ───────────────────────────────────────────────────────────────

// Using linkedom (npm) instead of deno-dom because the deno.land/x URL
// is mangled by an upstream email-obfuscation filter (`@v0.x.y` → `[email protected]`).
import { parseHTML } from "https://esm.sh/linkedom@0.18.12?bundle&exports=parseHTML";
class DOMParser {
  parseFromString(html: string, _mime: string) {
    return parseHTML(html).document;
  }
}
type Element = any;

const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Brave secret is stored as BRAVE_SEARCH_API_KEY in this project.
const BRAVE_KEY_NAME = "BRAVE_SEARCH_API_KEY";

export interface WebAgentInput {
  searchQuery: string;
}

export interface WebProductData {
  title: string;
  description: string;
  imageUrl: string;
  price: string;
  url: string;
}

export type WebAgentResult =
  | { success: true; data: WebProductData; confidence: number; source: "web" }
  | { success: false; error: string };

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  page_type?: string | string[];
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name) ?? "";
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(maybeUrl: string, base: string): string {
  if (!maybeUrl) return "";
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return maybeUrl;
  }
}

function isProductResult(r: BraveWebResult): boolean {
  const pageType = Array.isArray(r.page_type)
    ? r.page_type.join(" ")
    : (r.page_type || "");
  if (/product/i.test(pageType)) return true;
  const url = (r.url || "").toLowerCase();
  return /\/product[s]?\//.test(url) || /\/p\//.test(url) || /\/item[s]?\//.test(url);
}

const CURRENCY_REGEX =
  /(?:AUD|USD|NZD|GBP|EUR|CAD|\$|£|€)\s?[0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})?/i;

function extractJsonLdPrice(doc: Document | null): string {
  if (!doc) return "";
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')) as Element[];
  for (const s of scripts) {
    try {
      const json = JSON.parse(s.textContent || "");
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const type = item?.["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;
        const offers = item.offers;
        if (!offers) continue;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const price = offer?.price ?? offer?.lowPrice;
        const currency = offer?.priceCurrency ? `${offer.priceCurrency} ` : "";
        if (price !== undefined && price !== null && price !== "") {
          return `${currency}${price}`.trim();
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return "";
}

interface ExtractedProduct {
  data: WebProductData;
  /** Internal score used to pick the best candidate. */
  score: number;
}

function extractProduct(html: string, pageUrl: string): ExtractedProduct | null {
  // deno-dom returns HTMLDocument; cast loosely for our needs
  const doc = new DOMParser().parseFromString(html, "text/html") as unknown as Document | null;
  if (!doc) return null;

  const titleEl = doc.querySelector("title");
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  const title =
    attr(ogTitle as unknown as Element | null, "content") ||
    textOf(titleEl as unknown as Element | null);

  const metaDesc = doc.querySelector('meta[name="description"]');
  const ogDesc = doc.querySelector('meta[property="og:description"]');
  const description =
    attr(metaDesc as unknown as Element | null, "content") ||
    attr(ogDesc as unknown as Element | null, "content");

  // Image: og:image first, then largest plausible product image
  let imageUrl = attr(doc.querySelector('meta[property="og:image"]') as unknown as Element | null, "content");
  if (!imageUrl) {
    const imgs = Array.from(doc.querySelectorAll("img")) as Element[];
    const productImg = imgs.find((img) => {
      const cls = (img.getAttribute("class") || "").toLowerCase();
      const id = (img.getAttribute("id") || "").toLowerCase();
      return cls.includes("product") || id.includes("product");
    }) || imgs[0];
    imageUrl =
      attr(productImg ?? null, "src") ||
      attr(productImg ?? null, "data-src") ||
      "";
  }
  if (imageUrl) imageUrl = absoluteUrl(imageUrl, pageUrl);

  // Price: schema.org JSON-LD > meta tag > regex on visible text
  let price = extractJsonLdPrice(doc);
  if (!price) {
    const metaPrice = doc.querySelector('meta[property="product:price:amount"]');
    const metaCurrency = doc.querySelector('meta[property="product:price:currency"]');
    const amount = attr(metaPrice as unknown as Element | null, "content");
    const currency = attr(metaCurrency as unknown as Element | null, "content");
    if (amount) price = currency ? `${currency} ${amount}` : amount;
  }
  if (!price) {
    const priceEl = doc.querySelector(".price, .product-price, .product__price, [itemprop='price']");
    const priceText = textOf(priceEl as unknown as Element | null);
    const m = priceText.match(CURRENCY_REGEX) || (doc.body?.textContent || "").match(CURRENCY_REGEX);
    if (m) price = m[0];
  }

  if (!title && !imageUrl) return null;

  // Score: prefer results with both a clear price and image
  let score = 0;
  if (price) score += 3;
  if (imageUrl) score += 2;
  if (title) score += 1;
  if (description) score += 1;

  return {
    score,
    data: {
      title: title || "",
      description: description || "",
      imageUrl: imageUrl || "",
      price: price || "",
      url: pageUrl,
    },
  };
}

// ───────────────────────────────────────────────────────────────
// Main entrypoint
// ───────────────────────────────────────────────────────────────

export async function searchWeb(input: WebAgentInput): Promise<WebAgentResult> {
  const { searchQuery } = input;
  if (!searchQuery || !searchQuery.trim()) {
    return { success: false, error: "searchQuery is required" };
  }

  const apiKey = Deno.env.get(BRAVE_KEY_NAME);
  if (!apiKey) {
    console.error(`[webAgent] ${BRAVE_KEY_NAME} is not configured`);
    return { success: false, error: "Brave Search API key is not configured" };
  }

  const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=5`;

  let braveResp: Response;
  try {
    braveResp = await timedFetch(braveUrl, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
  } catch (err) {
    console.error("[webAgent] Brave Search request failed:", err);
    return { success: false, error: "Brave Search request failed" };
  }

  if (!braveResp.ok) {
    console.error(`[webAgent] Brave Search returned ${braveResp.status}`);
    return { success: false, error: `Brave Search returned ${braveResp.status}` };
  }

  let payload: { web?: { results?: BraveWebResult[] } };
  try {
    payload = await braveResp.json();
  } catch (err) {
    console.error("[webAgent] Failed to parse Brave Search response:", err);
    return { success: false, error: "Invalid Brave Search response" };
  }

  const allResults = payload.web?.results ?? [];
  const productResults = allResults.filter(isProductResult);
  const candidates = (productResults.length > 0 ? productResults : allResults).slice(0, 5);

  if (candidates.length === 0) {
    return { success: false, error: "No matching product on external web" };
  }

  let best: ExtractedProduct | null = null;

  for (const r of candidates) {
    if (!r.url) continue;
    try {
      const res = await timedFetch(r.url);
      if (!res.ok) continue;
      const html = await res.text();
      const extracted = extractProduct(html, r.url);
      if (!extracted) continue;
      if (!best || extracted.score > best.score) {
        best = extracted;
        // Early exit if we already have an ideal candidate (price + image + title)
        if (extracted.score >= 6) break;
      }
    } catch (err) {
      console.error(`[webAgent] Failed to fetch ${r.url}:`, err);
      continue;
    }
  }

  if (!best || (!best.data.price && !best.data.imageUrl)) {
    return { success: false, error: "No matching product on external web" };
  }

  return {
    success: true,
    data: best.data,
    confidence: 75,
    source: "web",
  };
}

export default searchWeb;
