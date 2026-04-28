// ════════════════════════════════════════════════════════════════
// dom-selectors.ts — Strategy 2 of the URL Product Extractor cascade.
//
// Universal CSS-selector heuristics that catch ~30% of e-commerce
// sites that don't ship JSON-LD. Native deno-dom only — no cheerio,
// no other external libs.
// ════════════════════════════════════════════════════════════════

import { DOMParser, type Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import type { ProductData } from "./jsonld-parser.ts";

// Currency symbol → ISO 4217 (subset; full map lives in currency-detector — Task 6)
const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₽": "RUB",
  "R$": "BRL",
  "C$": "CAD",
  "A$": "AUD",
  "NZ$": "NZD",
};

// ────────────────────────────────────────────────────────────────
// Tiny query helpers (deno-dom returns Element | null)
// ────────────────────────────────────────────────────────────────

function firstText(doc: Document, selectors: string[]): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel) as Element | null;
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function firstAttr(doc: Document, selectors: Array<[string, string]>): string | null {
  for (const [sel, attr] of selectors) {
    const el = doc.querySelector(sel) as Element | null;
    const v = el?.getAttribute(attr)?.trim();
    if (v) return v;
  }
  return null;
}

function firstImage(doc: Document): string | null {
  return firstAttr(doc, [
    ['meta[property="og:image"]', "content"],
    ['meta[name="og:image"]', "content"],
    ['meta[name="twitter:image"]', "content"],
    ['link[rel="image_src"]', "href"],
    ["img.product-image", "src"],
    ['img[itemprop="image"]', "src"],
    [".product-image img", "src"],
    [".product-gallery img", "src"],
  ]);
}

// ────────────────────────────────────────────────────────────────
// Currency / price helpers
// ────────────────────────────────────────────────────────────────

function detectCurrency(priceText: string | null, doc: Document): string | null {
  // 1) Explicit meta tag
  const meta = firstAttr(doc, [
    ['meta[property="product:price:currency"]', "content"],
    ['meta[name="product:price:currency"]', "content"],
    ['[itemprop="priceCurrency"]', "content"],
  ]);
  if (meta && /^[A-Z]{3}$/.test(meta.trim())) return meta.trim();

  if (!priceText) return null;

  // 2) ISO 4217 code embedded in the text (e.g. "AUD 49.95")
  const isoMatch = priceText.match(/\b([A-Z]{3})\b/);
  if (isoMatch && /^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|CNY|HKD|SGD|INR|KRW|BRL|MXN|ZAR|SEK|NOK|DKK|PLN)$/.test(isoMatch[1])) {
    return isoMatch[1];
  }

  // 3) Compound symbols first (A$, NZ$, R$, C$) before plain $
  const compound = priceText.match(/(A\$|NZ\$|R\$|C\$)/);
  if (compound) return CURRENCY_SYMBOL_MAP[compound[1]];

  const symbol = priceText.match(/[$€£¥₹₩₽]/);
  if (symbol) return CURRENCY_SYMBOL_MAP[symbol[0]] ?? null;

  return null;
}

function cleanPrice(raw: string | null): string | null {
  if (!raw) return null;
  // Pull the first numeric run with optional decimals/commas
  const m = raw.match(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/);
  if (!m) return null;
  let s = m[0];
  // Normalise European "1.234,56" → "1234.56"; US "1,234.56" → "1234.56"
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // Comma as decimal if 1-2 trailing digits
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  return s;
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export function extractWithSelectors(html: string): ProductData | null {
  if (!html || typeof html !== "string") return null;

  let doc: Document | null = null;
  try {
    doc = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
  } catch (err) {
    console.warn("[dom-selectors] DOM parse failed:", (err as Error).message);
    return null;
  }
  if (!doc) return null;

  // Name
  const name =
    firstAttr(doc, [
      ['meta[property="og:title"]', "content"],
      ['meta[name="og:title"]', "content"],
      ['meta[name="twitter:title"]', "content"],
    ]) ??
    firstText(doc, ["h1.product-title", "h1.product-name", ".product-title", ".product-name", 'h1[itemprop="name"]', "h1"]);

  // Description
  const description =
    firstAttr(doc, [
      ['meta[property="og:description"]', "content"],
      ['meta[name="description"]', "content"],
      ['meta[name="twitter:description"]', "content"],
    ]) ??
    firstText(doc, ['div[itemprop="description"]', ".product-description", ".product__description", "#product-description"]);

  // Price — meta first, then visible nodes
  const priceRaw =
    firstAttr(doc, [
      ['meta[property="product:price:amount"]', "content"],
      ['meta[name="product:price:amount"]', "content"],
      ['span[itemprop="price"]', "content"],
      ['[itemprop="price"]', "content"],
      ['[data-price]', "data-price"],
    ]) ??
    firstText(doc, [
      'span[itemprop="price"]',
      '[itemprop="price"]',
      ".product-price",
      ".product__price",
      ".price__current",
      ".price-now",
      ".price",
    ]);

  const price = cleanPrice(priceRaw);
  const currency = detectCurrency(priceRaw, doc);

  const image = firstImage(doc);
  const imageUrls = image ? [image] : [];

  const sku = firstAttr(doc, [['[itemprop="sku"]', "content"]]) ?? firstText(doc, ['[itemprop="sku"]', ".product-sku", ".sku"]);
  const brand =
    firstAttr(doc, [['meta[property="product:brand"]', "content"], ['[itemprop="brand"]', "content"]]) ??
    firstText(doc, ['[itemprop="brand"]', ".product-brand", ".brand"]);

  // Need at least name + price for this strategy to be considered a hit
  if (!name || !price) return null;

  return {
    name: name.trim(),
    description: description?.trim() ?? null,
    price,
    currency,
    imageUrls,
    sku: sku?.trim() ?? null,
    brand: brand?.trim() ?? null,
  };
}
