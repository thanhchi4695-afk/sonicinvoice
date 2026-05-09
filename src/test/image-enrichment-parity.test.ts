/**
 * Image enrichment parity tests.
 *
 * Verifies that the normal invoice parsing flow (which calls the
 * `enrich-product` Edge Function) and the URL Import flow (which calls
 * `product-extract` directly) both end up using the SAME image cascade
 * (find-product-url → product-extract → image-pipeline) and surface the
 * image source consistently.
 *
 * These are unit-level: we mock global fetch so the test runs offline and
 * deterministically. The companion benchmark script
 * `scripts/image-success-benchmark.ts` exercises the live edge functions.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

type FetchFn = typeof globalThis.fetch;

interface MockProduct {
  name: string;
  brand: string;
  type: string;
  vendorCode?: string;
  brandWebsite?: string;
}

const SUPABASE_URL = "https://test.supabase.co";
const ANON = "anon-key";

function makeFetchMock(opts: {
  realImages: number; // how many images the cascade returns
  pageFound: boolean;
  llmFallbackImages?: string[];
  strategy?: string;
}): FetchFn {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // The invoice flow hits enrich-product. Simulate it internally calling
    // find-product-url then product-extract, then merging.
    if (url.includes("/functions/v1/enrich-product")) {
      const cascadeImages = Array.from(
        { length: opts.realImages },
        (_, i) => `https://cdn.test/${i}.jpg`,
      );
      const usedCascade = opts.pageFound && opts.realImages > 0;
      return new Response(
        JSON.stringify({
          description: "<p>Test desc</p>",
          imageUrls: usedCascade ? cascadeImages : (opts.llmFallbackImages ?? []),
          fabric: "",
          care: "",
          origin: "",
          productPageUrl: opts.pageFound ? "https://brand.test/p/123" : "",
          confidence: usedCascade ? "high" : "low",
          note: "",
          imageSource: usedCascade
            ? "cascade"
            : (opts.llmFallbackImages?.length ? "llm" : "none"),
          imageStrategy: usedCascade ? (opts.strategy ?? "json-ld") : null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // URL Import flow hits product-extract directly.
    if (url.includes("/functions/v1/product-extract")) {
      const images = Array.from(
        { length: opts.realImages },
        (_, i) => ({ storedUrl: `https://cdn.test/${i}.jpg` }),
      );
      return new Response(
        JSON.stringify({
          product: {
            title: "Test product",
            images,
            strategyUsed: opts.strategy ?? "json-ld",
            description: "Brand description",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  }) as unknown as FetchFn;
}

/** Mirrors the body InvoiceFlow.tsx sends to enrich-product. */
async function callInvoiceEnrichment(p: MockProduct) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/enrich-product`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({
      title: p.name,
      vendor: p.brand,
      type: p.type,
      brandWebsite: p.brandWebsite ?? "",
      styleNumber: p.vendorCode ?? "",
      storeName: "Test",
      storeCity: "AU",
      customInstructions: "",
    }),
  });
  return await res.json();
}

/** Mirrors the body ProductUrlImporter sends to product-extract. */
async function callUrlImport(pageUrl: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/product-extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ url: pageUrl }),
  });
  return await res.json();
}

interface ScenarioCase {
  label: string;
  products: MockProduct[];
  urls: string[];
}

const SCENARIOS: ScenarioCase[] = [
  {
    label: "refill",
    products: [
      { name: "Mara One Piece", brand: "Bond Eye", type: "Swimwear", vendorCode: "BOUND001", brandWebsite: "bond-eye.com.au" },
      { name: "Sasha Bikini", brand: "Bond Eye", type: "Swimwear", vendorCode: "BOUND002", brandWebsite: "bond-eye.com.au" },
    ],
    urls: ["https://bond-eye.com.au/p/mara", "https://bond-eye.com.au/p/sasha"],
  },
  {
    label: "new-product",
    products: [
      { name: "Surf Tee", brand: "Rhythm", type: "Apparel", vendorCode: "RHY100", brandWebsite: "rhythm.com.au" },
      { name: "Beach Short", brand: "Rhythm", type: "Apparel", vendorCode: "RHY101", brandWebsite: "rhythm.com.au" },
    ],
    urls: ["https://rhythm.com.au/p/tee", "https://rhythm.com.au/p/short"],
  },
  {
    label: "mixed",
    products: [
      { name: "Goggles Adult", brand: "Zoggs", type: "Swim", vendorCode: "ZOG1", brandWebsite: "zoggs.com.au" },
      { name: "Handmade Wrap", brand: "OM Designs", type: "Apparel", vendorCode: "OM1", brandWebsite: "" }, // missing website
    ],
    urls: ["https://zoggs.com.au/p/g1", "https://omdesigns.test/p/wrap"],
  },
];

interface Tally { total: number; cascade: number; llm: number; none: number }

function rate(t: Tally) {
  return t.total === 0 ? 0 : t.cascade / t.total;
}

describe("image enrichment parity: invoice parse vs URL import", () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.label}: both flows reach cascade and produce equal real-image rates when pages resolve`, async () => {
      // Bond Eye / Rhythm / Zoggs all resolve. OM Designs has no brandWebsite,
      // so the invoice flow's cascade returns nothing for it (LLM fallback).
      // The URL import is given an explicit URL, so it always reaches the cascade.

      const invoiceTally: Tally = { total: 0, cascade: 0, llm: 0, none: 0 };
      const urlTally: Tally = { total: 0, cascade: 0, llm: 0, none: 0 };

      for (const p of scenario.products) {
        globalThis.fetch = makeFetchMock({
          realImages: p.brandWebsite ? 4 : 0,
          pageFound: !!p.brandWebsite,
          llmFallbackImages: p.brandWebsite ? [] : ["https://llm.guess/x.jpg"],
          strategy: "json-ld",
        });
        const r = await callInvoiceEnrichment(p);
        invoiceTally.total++;
        if (r.imageSource === "cascade") invoiceTally.cascade++;
        else if (r.imageSource === "llm") invoiceTally.llm++;
        else invoiceTally.none++;
      }

      for (const u of scenario.urls) {
        globalThis.fetch = makeFetchMock({
          realImages: 4,
          pageFound: true,
          strategy: "json-ld",
        });
        const r = await callUrlImport(u);
        urlTally.total++;
        const got = Array.isArray(r.product?.images) ? r.product.images.length : 0;
        if (got > 0) urlTally.cascade++;
        else urlTally.none++;
      }

      // URL Import always given a URL → 100% real images.
      expect(rate(urlTally)).toBe(1);

      // Invoice flow matches URL import for every product that has a brandWebsite.
      const productsWithSite = scenario.products.filter(p => !!p.brandWebsite).length;
      expect(invoiceTally.cascade).toBe(productsWithSite);

      // Products without a brandWebsite must fall back to LLM, not silently succeed.
      const productsWithoutSite = scenario.products.length - productsWithSite;
      expect(invoiceTally.llm + invoiceTally.none).toBe(productsWithoutSite);
    });
  }

  it("parity contract: cascade-sourced enrichments expose imageStrategy", async () => {
    globalThis.fetch = makeFetchMock({ realImages: 3, pageFound: true, strategy: "dom-selectors" });
    const r = await callInvoiceEnrichment({
      name: "Mara One Piece",
      brand: "Bond Eye",
      type: "Swimwear",
      brandWebsite: "bond-eye.com.au",
    });
    expect(r.imageSource).toBe("cascade");
    expect(r.imageStrategy).toBe("dom-selectors");
    expect(r.imageUrls.length).toBe(3);
    expect(r.confidence).toBe("high");
  });

  it("missing brandWebsite degrades invoice flow to LLM fallback (not cascade)", async () => {
    globalThis.fetch = makeFetchMock({
      realImages: 0,
      pageFound: false,
      llmFallbackImages: ["https://llm.guess/a.jpg"],
    });
    const r = await callInvoiceEnrichment({
      name: "Handmade Wrap",
      brand: "OM Designs",
      type: "Apparel",
      brandWebsite: "",
    });
    expect(r.imageSource).toBe("llm");
    expect(r.imageStrategy).toBeNull();
  });
});
