// ───────────────────────────────────────────────────────────────
// Supplier Agent
// Searches a supplier's brand website for product details.
//
// NOTE: Supabase Edge Functions run on Deno, where `Crawl4AI` and
// `wdot` (Node/Rust packages) are not available. We therefore use
// the documented fallback: `fetch` with a desktop User-Agent plus
// `deno-dom` for HTML parsing. Dynamic JS-only sites may not yield
// results — this is acceptable per the task brief.
// ───────────────────────────────────────────────────────────────

// Using linkedom (npm) instead of deno-dom because the deno.land/x URL
// is mangled by an upstream email-obfuscation filter (`@v0.x.y` → `[email protected]`).
import { DOMParser } from "https://esm.sh/linkedom@0.18.12";
type Element = any;

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface SupplierAgentInput {
  searchQuery: string;
  brandWebsite?: string;
  brand?: string;
}

export interface SupplierProductData {
  title: string;
  description: string;
  imageUrl: string;
  price: string;
  confidence: number;
}

export type SupplierAgentResult =
  | { success: true; data: SupplierProductData; source: "supplier"; url?: string }
  | { success: false; error: string };

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function buildBrandWebsite(brand?: string, explicit?: string): string | null {
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit.replace(/\/$/, "");
  if (!brand) return null;
  const slug = brand.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");
  if (!slug) return null;
  return `https://www.${slug}.com`;
}

async function timedFetch(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function safeFetchHtml(url: string): Promise<string | null> {
  return timedFetch(url)
    .then(async (res) => (res.ok ? await res.text() : null))
    .catch(() => null);
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

// ───────────────────────────────────────────────────────────────
// Extraction
// ───────────────────────────────────────────────────────────────

function extractProduct(html: string, pageUrl: string): SupplierProductData | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return null;

  // Title
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  const h1 = doc.querySelector("h1");
  const title = attr(ogTitle as Element | null, "content") || textOf(h1 as Element | null);

  // Description
  const metaDesc = doc.querySelector('meta[name="description"]');
  const ogDesc = doc.querySelector('meta[property="og:description"]');
  const productDescEl = doc.querySelector(".product-description, .product__description, #product-description");
  const description =
    attr(metaDesc as Element | null, "content") ||
    attr(ogDesc as Element | null, "content") ||
    textOf(productDescEl as Element | null);

  // Image — prefer og:image, then any <img> whose class contains "product"
  let imageUrl = attr(doc.querySelector('meta[property="og:image"]') as Element | null, "content");
  if (!imageUrl) {
    const imgs = Array.from(doc.querySelectorAll("img")) as Element[];
    const productImg = imgs.find((img) => {
      const cls = (img.getAttribute("class") || "").toLowerCase();
      return cls.includes("product");
    });
    imageUrl =
      attr(productImg ?? null, "src") ||
      attr(productImg ?? null, "data-src") ||
      "";
  }
  if (imageUrl) imageUrl = absoluteUrl(imageUrl, pageUrl);

  // Price
  const priceMeta = doc.querySelector('meta[property="product:price:amount"]');
  const priceEl = doc.querySelector(".price, .product-price, .product__price, [itemprop='price']");
  const price = attr(priceMeta as Element | null, "content") || textOf(priceEl as Element | null);

  if (!title && !description && !imageUrl) return null;

  return {
    title: title || "",
    description: description || "",
    imageUrl: imageUrl || "",
    price: price || "",
    confidence: 90,
  };
}

/**
 * Find the first plausible product page link on a search/listing page.
 */
function findProductLink(html: string, baseUrl: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return null;

  const anchors = Array.from(doc.querySelectorAll("a")) as Element[];
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    if (/\/products?\//i.test(href) || /\/shop\//i.test(href) || /\/p\//i.test(href)) {
      return absoluteUrl(href, baseUrl);
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────
// Main entrypoint
// ───────────────────────────────────────────────────────────────

export async function searchSupplier(input: SupplierAgentInput): Promise<SupplierAgentResult> {
  const { searchQuery } = input;
  if (!searchQuery || !searchQuery.trim()) {
    return { success: false, error: "searchQuery is required" };
  }

  const brandWebsite = buildBrandWebsite(input.brand, input.brandWebsite);
  if (!brandWebsite) {
    return { success: false, error: "brandWebsite or brand is required" };
  }

  const q = encodeURIComponent(searchQuery.trim());

  // 1) Try the brand's search endpoint first
  const searchCandidates = [
    `${brandWebsite}/search?q=${q}`,
    `${brandWebsite}/search?query=${q}`,
    `${brandWebsite}/?s=${q}`,
  ];

  let pageUrl: string | null = null;
  let pageHtml: string | null = null;

  for (const url of searchCandidates) {
    const html = await safeFetchHtml(url);
    if (!html) continue;
    const productLink = findProductLink(html, url);
    if (productLink) {
      const productHtml = await safeFetchHtml(productLink);
      if (productHtml) {
        pageUrl = productLink;
        pageHtml = productHtml;
        break;
      }
    }
    // If the search page itself looks like a product page, try extracting from it
    if (!pageHtml) {
      pageUrl = url;
      pageHtml = html;
    }
  }

  // 2) Fallback: scrape homepage and look for any product link
  if (!pageHtml) {
    const homeHtml = await safeFetchHtml(brandWebsite);
    if (homeHtml) {
      const productLink = findProductLink(homeHtml, brandWebsite);
      if (productLink) {
        const productHtml = await safeFetchHtml(productLink);
        if (productHtml) {
          pageUrl = productLink;
          pageHtml = productHtml;
        }
      }
    }
  }

  if (!pageHtml || !pageUrl) {
    return { success: false, error: "No product found on supplier website" };
  }

  const data = extractProduct(pageHtml, pageUrl);
  if (!data || (!data.title && !data.imageUrl)) {
    return { success: false, error: "No product found on supplier website" };
  }

  return { success: true, data, source: "supplier", url: pageUrl };
}

export default searchSupplier;
