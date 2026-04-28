// ════════════════════════════════════════════════════════════════
// jsonld-parser.ts — Strategy 1 of the URL Product Extractor cascade.
//
// Parses <script type="application/ld+json"> blocks in a raw HTML
// string and returns the first valid schema.org Product node mapped
// to our internal `ProductData` shape.
//
// No external deps: uses native JSON.parse + Deno's built-in
// DOMParser (available via deno-dom in the Edge runtime).
// ════════════════════════════════════════════════════════════════

import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

export interface ProductData {
  name: string | null;
  description: string | null;
  price: string | null;       // raw numeric price as string, no symbol
  currency: string | null;    // ISO 4217 if available, else raw value
  imageUrls: string[];
  sku: string | null;
  brand: string | null;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Walk a JSON-LD value, yielding every plain object node (handles @graph + arrays). */
function* iterNodes(value: unknown): Generator<Record<string, unknown>> {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* iterNodes(v);
    return;
  }
  if (typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  yield node;

  // Recurse into @graph (common in Yoast, Shopify, etc.)
  if (node["@graph"]) yield* iterNodes(node["@graph"]);
}

function isProductNode(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === "product";
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase() === "product");
  return false;
}

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = pickString(v);
      if (s) return s;
    }
  }
  if (value && typeof value === "object") {
    // schema.org often nests { "@value": "..." } or { name: "..." }
    const obj = value as Record<string, unknown>;
    return pickString(obj["@value"]) ?? pickString(obj.name);
  }
  return null;
}

function pickImages(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      // ImageObject has { url } or { contentUrl }
      visit(obj.url ?? obj.contentUrl ?? obj["@id"]);
    }
  };
  visit(value);
  return Array.from(new Set(out));
}

function pickOffer(value: unknown): { price: string | null; currency: string | null } {
  if (!value) return { price: null, currency: null };

  const offers = Array.isArray(value) ? value : [value];
  for (const raw of offers) {
    if (!raw || typeof raw !== "object") continue;
    const offer = raw as Record<string, unknown>;

    // AggregateOffer → drill into its `offers` or fall back to lowPrice
    if (offer["@type"] === "AggregateOffer") {
      const nested = pickOffer(offer.offers);
      if (nested.price || nested.currency) return nested;
      return {
        price: pickString(offer.lowPrice ?? offer.price),
        currency: pickString(offer.priceCurrency),
      };
    }

    const price = pickString(offer.price ?? offer.lowPrice);
    const currency = pickString(offer.priceCurrency);
    if (price || currency) return { price, currency };
  }

  return { price: null, currency: null };
}

function mapNodeToProduct(node: Record<string, unknown>): ProductData {
  const { price, currency } = pickOffer(node.offers);
  return {
    name: pickString(node.name),
    description: pickString(node.description),
    price,
    currency,
    imageUrls: pickImages(node.image),
    sku: pickString(node.sku) ?? pickString(node.mpn) ?? pickString(node.gtin13) ?? pickString(node.gtin),
    brand: pickString(node.brand),
  };
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export function extractFromJsonLd(html: string): ProductData | null {
  if (!html || typeof html !== "string") return null;

  let scripts: string[] = [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return null;
    scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean);
  } catch (err) {
    console.warn("[jsonld-parser] DOM parse failed:", (err as Error).message);
    return null;
  }

  for (const raw of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn("[jsonld-parser] JSON parse error:", (err as Error).message);
      continue;
    }

    for (const node of iterNodes(parsed)) {
      if (isProductNode(node)) {
        return mapNodeToProduct(node);
      }
    }
  }

  return null;
}
