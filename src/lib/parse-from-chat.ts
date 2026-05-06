// Sequential pipeline: parsed rows → tags → SEO → Shopify CSV string.
// Used by the Sonic chat `parse_from_chat` action.

import { generateTags, type TagInput } from "@/lib/tag-engine";
import { generateSeo, type SeoProduct } from "@/lib/seo-engine";

export interface ParsedRow {
  productName?: string | null;
  styleNumber?: string | null;
  colour?: string | null;
  size?: string | null;
  quantity?: number | null;
  costPrice?: number | null;
  rrp?: number | null;
}

export interface EnrichedRow extends ParsedRow {
  brand: string;
  productType: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
}

function slugify(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferProductType(name: string): string {
  const n = (name || "").toLowerCase();
  if (/bikini\s*top/.test(n)) return "Bikini Tops";
  if (/bikini\s*bottom/.test(n)) return "Bikini Bottoms";
  if (/one[-\s]?piece/.test(n)) return "One Pieces";
  if (/sandal|thong|slide/.test(n)) return "Footwear";
  if (/dress/.test(n)) return "Dresses";
  if (/short/.test(n)) return "Shorts";
  if (/top/.test(n)) return "Tops";
  if (/bag/.test(n)) return "Bags";
  return "Apparel";
}

export function applyTagsAndSeo(rows: ParsedRow[], brand: string): EnrichedRow[] {
  const arrival = new Date()
    .toLocaleString("en-AU", { month: "short", year: "2-digit" })
    .replace(" ", "");
  return rows.map((r) => {
    const productType = inferProductType(r.productName ?? "");
    let tags: string[] = [];
    let seoTitle = "";
    let seoDescription = "";
    try {
      const tagInput: TagInput = {
        title: r.productName ?? `${brand} ${productType}`,
        brand,
        productType,
        priceStatus: "full_price",
        isNew: true,
        arrivalMonth: arrival,
        colour: r.colour ?? undefined,
      } as TagInput;
      tags = generateTags(tagInput);
    } catch {}
    try {
      const seoInput: SeoProduct = {
        title: r.productName ?? `${brand} ${productType}`,
        brand,
        type: productType,
        tags: r.colour ? [r.colour] : [],
      };
      const seo = generateSeo(seoInput);
      seoTitle = seo.seoTitle;
      seoDescription = seo.seoDescription;
    } catch {}
    return {
      ...r,
      brand,
      productType,
      tags,
      seoTitle,
      seoDescription,
    };
  });
}

export function buildShopifyCsv(rows: EnrichedRow[]): string {
  const headers = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
    "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
    "Variant SKU", "Variant Price", "Cost per item",
    "SEO Title", "SEO Description",
  ];
  const escape = (v: string) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const out: string[] = [headers.map(escape).join(",")];
  for (const r of rows) {
    const handle = slugify(`${r.brand}-${r.productName ?? r.styleNumber ?? "item"}`);
    const sku = [r.styleNumber, r.colour, r.size].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, "-");
    out.push([
      handle,
      r.productName ?? `${r.brand} ${r.productType}`,
      "",
      r.brand,
      r.productType,
      r.tags.join(", "),
      "TRUE",
      "Colour", r.colour ?? "",
      "Size", r.size ?? "",
      sku,
      r.rrp != null ? r.rrp.toFixed(2) : "",
      r.costPrice != null ? r.costPrice.toFixed(2) : "",
      r.seoTitle,
      r.seoDescription,
    ].map((v) => escape(String(v))).join(","));
  }
  return out.join("\n");
}

export function csvDownloadUrl(csv: string): string {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  return URL.createObjectURL(blob);
}
