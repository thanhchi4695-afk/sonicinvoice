// Pre-publish validation engine — evaluates an invoice batch across four
// dimensions (price, variants, SKU/barcode, Shopify catalog cross-check) and
// returns a structured report consumed by `PrePublishValidation.tsx`.

import type { ExportProduct } from "@/components/ExportReviewScreen";

export type Severity = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  severity: Severity;
  message: string;
  productKey?: string;      // groupKey for Edit handler
  productLabel?: string;
}

export interface ValidationReport {
  totalLines: number;
  totalProducts: number;
  totalVariants: number;
  price: { pass: number; warn: number; fail: number; results: CheckResult[] };
  variant: { pass: number; warn: number; fail: number; results: CheckResult[] };
  sku: { pass: number; warn: number; fail: number; results: CheckResult[] };
  catalog: {
    pass: number; warn: number; fail: number;
    newProducts: number; refillsMatched: number; needReview: number;
    results: CheckResult[];
  };
  totals: { pass: number; warn: number; fail: number };
}

export interface CatalogProduct {
  title: string;
  vendor: string;
  price?: number;
}

export interface ValidationInput {
  products: ExportProduct[];
  catalog?: CatalogProduct[];
  /** Map of vendor-code/group key marked as REFILL by stock-check. */
  refillKeys?: Set<string>;
}

const groupKey = (p: ExportProduct) => `${p.brand}::${p.name}`.toLowerCase();
const SIZE_RX = /^(xxs|xs|s|m|l|xl|xxl|xxxl|os|one\s*size|\d{1,2})$/i;

function isValidBarcode(b: string): boolean {
  const digits = b.replace(/\D/g, "");
  return digits.length === 8 || digits.length === 12 || digits.length === 13;
}

export function validateForPublish(input: ValidationInput): ValidationReport {
  const { products, catalog = [], refillKeys = new Set() } = input;

  // Group variants by product
  const groups = new Map<string, ExportProduct[]>();
  products.forEach((p) => {
    const k = groupKey(p);
    const arr = groups.get(k) || [];
    arr.push(p);
    groups.set(k, arr);
  });

  // ---- SECTION 1: prices
  const price = { pass: 0, warn: 0, fail: 0, results: [] as CheckResult[] };
  for (const [k, vs] of groups.entries()) {
    const label = `${vs[0].brand} ${vs[0].name}`;
    // Per-variant range check
    for (const v of vs) {
      const rrp = Number(v.rrp || 0);
      if (!rrp || rrp <= 0) {
        price.fail++;
        price.results.push({ id: `pr-zero-${k}-${v.sku}`, severity: "fail", productKey: k, productLabel: label, message: `Price is $0 — must be set before publish` });
      } else if (rrp < 1 || rrp > 10000) {
        price.fail++;
        price.results.push({ id: `pr-range-${k}-${v.sku}`, severity: "fail", productKey: k, productLabel: label, message: `Price $${rrp.toFixed(2)} is outside $1–$10,000 range` });
      } else {
        price.pass++;
      }
    }
    // Cross-variant consistency
    const rrps = vs.map((v) => Number(v.rrp || 0)).filter((n) => n > 0);
    if (rrps.length > 1) {
      const min = Math.min(...rrps), max = Math.max(...rrps);
      if (max - min > 0.01) {
        price.warn++;
        price.results.push({ id: `pr-mismatch-${k}`, severity: "warn", productKey: k, productLabel: label, message: `Variants have different RRPs ($${min.toFixed(2)}–$${max.toFixed(2)}) — usually all sizes share one price` });
      }
    }
    // Catalog drift
    const cat = catalog.find((c) => c.title.toLowerCase().includes(vs[0].name.toLowerCase()) && c.vendor.toLowerCase() === vs[0].brand.toLowerCase());
    if (cat?.price && rrps.length > 0) {
      const newPrice = rrps[0];
      const drift = Math.abs(newPrice - cat.price) / cat.price;
      if (drift > 0.2) {
        price.warn++;
        price.results.push({ id: `pr-drift-${k}`, severity: "warn", productKey: k, productLabel: label, message: `Price $${newPrice.toFixed(2)} differs from Shopify ($${cat.price.toFixed(2)}) by ${(drift * 100).toFixed(0)}%` });
      }
    }
  }

  // ---- SECTION 2: variant completeness
  const variant = { pass: 0, warn: 0, fail: 0, results: [] as CheckResult[] };
  for (const [k, vs] of groups.entries()) {
    const label = `${vs[0].brand} ${vs[0].name}`;
    const sizes = new Set(vs.map((v) => (v.size || "").trim()).filter((s) => SIZE_RX.test(s)));
    const colours = new Set(vs.map((v) => (v.colour || "").trim().toLowerCase()).filter(Boolean));
    const hasAnySize = vs.some((v) => v.size);
    const hasAnyColour = vs.some((v) => v.colour);

    if (!hasAnySize && !hasAnyColour) {
      variant.fail++;
      variant.results.push({ id: `vr-empty-${k}`, severity: "fail", productKey: k, productLabel: label, message: `No size and no colour detected — incomplete variant data` });
      continue;
    }
    if (colours.size > 1 && vs.length === 1) {
      variant.warn++;
      variant.results.push({ id: `vr-single-${k}`, severity: "warn", productKey: k, productLabel: label, message: `Multiple colours listed but only 1 variant extracted — likely extraction error` });
      continue;
    }
    if (hasAnySize && sizes.size < 2 && vs.length >= 2) {
      variant.warn++;
      variant.results.push({ id: `vr-fewsize-${k}`, severity: "warn", productKey: k, productLabel: label, message: `Only ${sizes.size} size detected for a multi-variant product` });
      continue;
    }
    variant.pass++;
  }

  // ---- SECTION 3: SKU / barcode
  const sku = { pass: 0, warn: 0, fail: 0, results: [] as CheckResult[] };
  const skuMap = new Map<string, string[]>();
  products.forEach((p) => {
    if (p.sku) {
      const arr = skuMap.get(p.sku) || [];
      arr.push(groupKey(p));
      skuMap.set(p.sku, arr);
    }
  });
  for (const p of products) {
    const k = groupKey(p);
    const label = `${p.brand} ${p.name}`;
    if (!p.sku) {
      sku.warn++;
      sku.results.push({ id: `sk-miss-${k}-${Math.random()}`, severity: "warn", productKey: k, productLabel: label, message: `SKU missing (optional, but recommended)` });
    } else {
      const owners = new Set(skuMap.get(p.sku) || []);
      if (owners.size > 1) {
        sku.warn++;
        sku.results.push({ id: `sk-dup-${p.sku}`, severity: "warn", productKey: k, productLabel: label, message: `SKU "${p.sku}" appears on ${owners.size} different products` });
      } else {
        sku.pass++;
      }
    }
    if (p.barcode && !isValidBarcode(p.barcode)) {
      sku.fail++;
      sku.results.push({ id: `bc-bad-${k}-${p.barcode}`, severity: "fail", productKey: k, productLabel: label, message: `Barcode "${p.barcode}" is not 8, 12, or 13 digits` });
    }
  }
  // Dedupe duplicate SKU rows
  const seenIds = new Set<string>();
  sku.results = sku.results.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

  // ---- SECTION 4: catalog cross-check
  const catalogR = { pass: 0, warn: 0, fail: 0, newProducts: 0, refillsMatched: 0, needReview: 0, results: [] as CheckResult[] };
  for (const [k, vs] of groups.entries()) {
    const first = vs[0];
    const label = `${first.brand} ${first.name}`;
    const titleLc = first.name.toLowerCase();
    const vendorLc = first.brand.toLowerCase();

    const exact = catalog.find((c) => c.vendor.toLowerCase() === vendorLc && c.title.toLowerCase().includes(titleLc));
    const similar = !exact ? catalog.find((c) => c.title.toLowerCase().includes(titleLc) && c.vendor.toLowerCase() !== vendorLc) : null;
    const isRefill = refillKeys.has(k) || refillKeys.has(first.sku || "");

    if (isRefill && !exact) {
      catalogR.fail++;
      catalogR.needReview++;
      catalogR.results.push({ id: `ct-refill-miss-${k}`, severity: "fail", productKey: k, productLabel: label, message: `Marked as REFILL but not found in Shopify catalog` });
    } else if (similar) {
      catalogR.warn++;
      catalogR.needReview++;
      catalogR.results.push({ id: `ct-similar-${k}`, severity: "warn", productKey: k, productLabel: label, message: `Similar title in Shopify under vendor "${similar.vendor}" — possible duplicate` });
    } else if (exact) {
      catalogR.pass++;
      catalogR.refillsMatched++;
    } else {
      catalogR.pass++;
      catalogR.newProducts++;
    }
  }

  const totals = {
    pass: price.pass + variant.pass + sku.pass + catalogR.pass,
    warn: price.warn + variant.warn + sku.warn + catalogR.warn,
    fail: price.fail + variant.fail + sku.fail + catalogR.fail,
  };

  return {
    totalLines: products.length,
    totalProducts: groups.size,
    totalVariants: products.length,
    price, variant, sku, catalog: catalogR,
    totals,
  };
}
