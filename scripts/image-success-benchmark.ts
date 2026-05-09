#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * Image success benchmark — compares real-image yield between
 *   1. Normal invoice parsing pipeline  (POST /functions/v1/enrich-product)
 *   2. URL Import pipeline              (POST /functions/v1/product-extract)
 *
 * Across three scenarios (refill, new-product, mixed) and four brands
 * (Bond Eye, Rhythm, Zoggs, OM Designs).
 *
 * Reports two metrics per scenario per flow:
 *   • cascade-source success — did the response indicate real (cascade) images?
 *   • reachability success   — does at least one returned image URL respond 2xx?
 *
 * Run:
 *   deno run --allow-net --allow-env scripts/image-success-benchmark.ts
 *
 * Env required:
 *   SUPABASE_URL                (or VITE_SUPABASE_URL)
 *   SUPABASE_PUBLISHABLE_KEY    (or VITE_SUPABASE_PUBLISHABLE_KEY)
 */

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("VITE_SUPABASE_URL") ??
  "";
const ANON =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  "";

if (!SUPABASE_URL || !ANON) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY env.");
  Deno.exit(2);
}

interface Product {
  name: string;
  brand: string;
  type: string;
  vendorCode?: string;
  brandWebsite?: string;
  /** Direct product page URL — used by the URL-import flow. */
  productUrl?: string;
}

interface Scenario {
  label: "refill" | "new-product" | "mixed";
  products: Product[];
}

const SCENARIOS: Scenario[] = [
  {
    label: "refill",
    products: [
      {
        name: "Mara Triangle Bikini Top",
        brand: "Bond Eye",
        type: "Swimwear",
        vendorCode: "BOUND001",
        brandWebsite: "bond-eye.com.au",
        productUrl: "https://bond-eye.com.au/products/mara-bikini-top",
      },
      {
        name: "Sasha Brief",
        brand: "Bond Eye",
        type: "Swimwear",
        vendorCode: "BOUND002",
        brandWebsite: "bond-eye.com.au",
        productUrl: "https://bond-eye.com.au/products/sasha-brief",
      },
    ],
  },
  {
    label: "new-product",
    products: [
      {
        name: "Classic Stripe Boardshort",
        brand: "Rhythm",
        type: "Apparel",
        vendorCode: "RHY100",
        brandWebsite: "rhythmlivin.com.au",
        productUrl: "https://rhythmlivin.com.au/collections/mens-boardshorts",
      },
      {
        name: "Predator Polarized Goggle",
        brand: "Zoggs",
        type: "Swim Accessory",
        vendorCode: "ZOG-PRED",
        brandWebsite: "zoggs.com.au",
        productUrl: "https://zoggs.com.au/products/predator-polarized",
      },
    ],
  },
  {
    label: "mixed",
    products: [
      {
        name: "Mara Triangle Bikini Top",
        brand: "Bond Eye",
        type: "Swimwear",
        vendorCode: "BOUND001",
        brandWebsite: "bond-eye.com.au",
        productUrl: "https://bond-eye.com.au/products/mara-bikini-top",
      },
      {
        name: "Handmade Wrap Dress",
        brand: "OM Designs",
        type: "Apparel",
        vendorCode: "OM1",
        brandWebsite: "", // intentionally missing — expected to fail cascade
        productUrl: "https://omdesigns.com.au/collections/dresses",
      },
      {
        name: "Predator Polarized Goggle",
        brand: "Zoggs",
        type: "Swim Accessory",
        vendorCode: "ZOG-PRED",
        brandWebsite: "zoggs.com.au",
        productUrl: "https://zoggs.com.au/products/predator-polarized",
      },
    ],
  },
];

interface Result {
  product: string;
  brand: string;
  cascade: boolean;
  reachable: boolean;
  imageCount: number;
  source: string;
  strategy: string | null;
  error?: string;
}

interface Tally {
  total: number;
  cascadeHits: number;
  reachableHits: number;
}

const HEADERS = {
  "Content-Type": "application/json",
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
};

async function headOk(url: string, timeoutMs = 8000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    if (r.status === 405 || r.status === 403) {
      // Some CDNs reject HEAD — fall back to a tiny GET.
      r = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-128" },
        signal: ctrl.signal,
      });
    }
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function anyImageReachable(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return false;
  // Check up to first 3 images in parallel.
  const checks = urls.slice(0, 3).map(headOk);
  const settled = await Promise.all(checks);
  return settled.some(Boolean);
}

async function runInvoiceEnrich(p: Product): Promise<Result> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/enrich-product`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        title: p.name,
        vendor: p.brand,
        type: p.type,
        brandWebsite: p.brandWebsite ?? "",
        styleNumber: p.vendorCode ?? "",
        storeName: "Benchmark Store",
        storeCity: "Sydney",
        customInstructions: "",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return {
        product: p.name, brand: p.brand,
        cascade: false, reachable: false, imageCount: 0,
        source: "error", strategy: null,
        error: `HTTP ${res.status}: ${txt.slice(0, 120)}`,
      };
    }
    const j = await res.json();
    const urls: string[] = Array.isArray(j.imageUrls) ? j.imageUrls : [];
    const reachable = await anyImageReachable(urls);
    return {
      product: p.name, brand: p.brand,
      cascade: j.imageSource === "cascade",
      reachable,
      imageCount: urls.length,
      source: j.imageSource ?? "none",
      strategy: j.imageStrategy ?? null,
    };
  } catch (e) {
    return {
      product: p.name, brand: p.brand,
      cascade: false, reachable: false, imageCount: 0,
      source: "error", strategy: null,
      error: (e as Error).message,
    };
  }
}

async function runUrlImport(p: Product): Promise<Result> {
  if (!p.productUrl) {
    return {
      product: p.name, brand: p.brand,
      cascade: false, reachable: false, imageCount: 0,
      source: "skipped", strategy: null,
      error: "no productUrl fixture",
    };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/product-extract`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ url: p.productUrl }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return {
        product: p.name, brand: p.brand,
        cascade: false, reachable: false, imageCount: 0,
        source: "error", strategy: null,
        error: `HTTP ${res.status}: ${txt.slice(0, 120)}`,
      };
    }
    const j = await res.json();
    const imgs: { storedUrl?: string }[] = j.product?.images ?? [];
    const urls = imgs.map(i => i?.storedUrl).filter((u): u is string => !!u);
    const reachable = await anyImageReachable(urls);
    return {
      product: p.name, brand: p.brand,
      cascade: urls.length > 0,
      reachable,
      imageCount: urls.length,
      source: urls.length > 0 ? "cascade" : "none",
      strategy: j.product?.strategyUsed ?? null,
    };
  } catch (e) {
    return {
      product: p.name, brand: p.brand,
      cascade: false, reachable: false, imageCount: 0,
      source: "error", strategy: null,
      error: (e as Error).message,
    };
  }
}

function tally(results: Result[]): Tally {
  return {
    total: results.length,
    cascadeHits: results.filter(r => r.cascade).length,
    reachableHits: results.filter(r => r.reachable).length,
  };
}

function pct(n: number, d: number) {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  return rows
    .map(r => r.map((c, i) => c.padEnd(widths[i])).join("  "))
    .join("\n");
}

async function main() {
  console.log(`\nImage Success Benchmark`);
  console.log(`endpoint: ${SUPABASE_URL}\n`);

  const summary: string[][] = [
    ["scenario", "flow", "n", "cascade%", "reachable%"],
    ["--------", "----", "-", "--------", "----------"],
  ];
  const detailed: Record<string, { invoice: Result[]; url: Result[] }> = {};

  for (const s of SCENARIOS) {
    console.log(`\n── ${s.label} (${s.products.length} products) ──`);
    const invoiceResults: Result[] = [];
    const urlResults: Result[] = [];
    for (const p of s.products) {
      const [inv, url] = await Promise.all([runInvoiceEnrich(p), runUrlImport(p)]);
      invoiceResults.push(inv);
      urlResults.push(url);
      console.log(
        `  ${p.brand.padEnd(12)} ${p.name.slice(0, 32).padEnd(32)} ` +
        `inv:${inv.cascade ? "✓" : "·"}/${inv.reachable ? "✓" : "·"} ` +
        `url:${url.cascade ? "✓" : "·"}/${url.reachable ? "✓" : "·"} ` +
        `[inv:${inv.source}${inv.strategy ? `:${inv.strategy}` : ""}, ` +
        `url:${url.source}${url.strategy ? `:${url.strategy}` : ""}]`,
      );
      if (inv.error) console.log(`    invoice error: ${inv.error}`);
      if (url.error) console.log(`    url error:     ${url.error}`);
    }
    detailed[s.label] = { invoice: invoiceResults, url: urlResults };
    const i = tally(invoiceResults);
    const u = tally(urlResults);
    summary.push([s.label, "invoice", String(i.total), pct(i.cascadeHits, i.total), pct(i.reachableHits, i.total)]);
    summary.push([s.label, "url    ", String(u.total), pct(u.cascadeHits, u.total), pct(u.reachableHits, u.total)]);
  }

  console.log(`\n── Summary ──\n${table(summary)}\n`);

  // Overall.
  const allInv = Object.values(detailed).flatMap(d => d.invoice);
  const allUrl = Object.values(detailed).flatMap(d => d.url);
  const ti = tally(allInv);
  const tu = tally(allUrl);
  console.log(`overall invoice → cascade ${pct(ti.cascadeHits, ti.total)}, reachable ${pct(ti.reachableHits, ti.total)}`);
  console.log(`overall url     → cascade ${pct(tu.cascadeHits, tu.total)}, reachable ${pct(tu.reachableHits, tu.total)}`);
  console.log(
    `delta (url − invoice): cascade ${(tu.cascadeHits / Math.max(1, tu.total) - ti.cascadeHits / Math.max(1, ti.total)) * 100 | 0}pts, ` +
    `reachable ${(tu.reachableHits / Math.max(1, tu.total) - ti.reachableHits / Math.max(1, ti.total)) * 100 | 0}pts`,
  );
}

await main();
