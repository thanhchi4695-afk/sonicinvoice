import { deriveArrivalMonth } from "./wholesale-mapper";
import type { GroupedProduct, SourceMeta } from "./unified-types";

// Re-export for backwards compatibility
export type { GroupedProduct as MappedProduct };

export interface JoorLineItem {
  style_name: string;
  style_number: string;
  style_description: string;
  color_name: string;
  color_code: string;
  size_name: string;
  upc: string;
  price_wholesale: number;
  price_retail: number;
  quantity_ordered: number;
  fabrication?: string;
  silhouette?: string;
  delivery_name?: string;
  season_name?: string;
  season_year?: string;
  brand?: string;
  image_url?: string;
}

function buildSource(
  item: JoorLineItem,
  orderMeta: { season_code?: string; delivery_name?: string }
): SourceMeta {
  return {
    sourceType: "wholesale",
    sourcePlatform: "joor",
    sourceDocumentId: "",
    sourceSupplier: item.brand || "",
    sourceDate: new Date().toISOString(),
    sourceCurrency: "AUD",
    importedAt: new Date().toISOString(),
  };
}

export function mapJoorLineItemToProduct(
  item: JoorLineItem,
  orderMeta: { season_code?: string; delivery_name?: string }
): GroupedProduct {
  const month = deriveArrivalMonth(item.season_year || orderMeta.season_code || "");

  return {
    title: item.style_name,
    sku: `${item.style_number}-${item.color_code}-${item.size_name}`
      .toUpperCase()
      .replace(/\s+/g, "-"),
    barcode: item.upc || "",
    description: item.style_description || "",
    vendor: item.brand || "",
    productType: item.silhouette || "",
    retailPrice: item.price_retail || 0,
    wholesaleCost: item.price_wholesale || 0,
    colour: item.color_name || "",
    colourCode: item.color_code || "",
    size: item.size_name || "",
    collection: item.delivery_name || orderMeta.delivery_name || "",
    season: item.season_name || orderMeta.season_code || "",
    fabrication: item.fabrication || "",
    imageUrl: item.image_url || "",
    brand: item.brand || "",
    tags: [item.brand, item.color_name, item.delivery_name || orderMeta.delivery_name, "full_price", "new"].filter(Boolean) as string[],
    arrivalMonth: month,
    sizes: [item.size_name],
    barcodes: [item.upc || ""],
    quantities: [item.quantity_ordered],
    source: buildSource(item, orderMeta),
  };
}

export function groupJoorItemsIntoProducts(
  items: JoorLineItem[],
  orderMeta: { season_code?: string; delivery_name?: string }
): GroupedProduct[] {
  const grouped = new Map<string, GroupedProduct>();

  for (const item of items) {
    const key = `${item.style_number}||${item.color_name}`;
    if (!grouped.has(key)) {
      grouped.set(key, mapJoorLineItemToProduct(item, orderMeta));
    } else {
      const existing = grouped.get(key)!;
      existing.sizes.push(item.size_name);
      existing.barcodes.push(item.upc || "");
      existing.quantities.push(item.quantity_ordered);
    }
  }

  return Array.from(grouped.values()).map((p) => ({
    ...p,
    size: p.sizes.join(", "),
  }));
}

export { deriveArrivalMonth };

export function buildShopifyCSV(products: GroupedProduct[]): string {
  const headers = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Product Category",
    "Type", "Tags", "Published", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Variant SKU", "Variant Price",
    "Cost per item", "Variant Barcode", "Image Src", "Collection",
  ];

  const rows: string[][] = [];
  for (const p of products) {
    const sizes = p.sizes.length ? p.sizes : [p.size];
    const barcodes = p.barcodes.length ? p.barcodes : [p.barcode];

    for (let i = 0; i < sizes.length; i++) {
      const isFirst = i === 0;
      rows.push([
        slugify(p.title + "-" + p.colour),
        isFirst ? p.title : "",
        isFirst ? p.description : "",
        isFirst ? p.vendor : "",
        "",
        isFirst ? p.productType : "",
        isFirst ? p.tags.join(", ") : "",
        isFirst ? "TRUE" : "",
        "Colour",
        p.colour,
        "Size",
        sizes[i],
        `${p.sku.split("-").slice(0, 2).join("-")}-${sizes[i]}`.toUpperCase().replace(/\s+/g, "-"),
        p.retailPrice.toFixed(2),
        p.wholesaleCost.toFixed(2),
        barcodes[i] || "",
        isFirst ? p.imageUrl : "",
        isFirst ? p.collection : "",
      ]);
    }
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

export function buildLightspeedCSV(products: GroupedProduct[]): string {
  const headers = [
    "Handle", "Title", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Variant SKU",
    "Variant Price", "Cost per item", "Variant Barcode",
    "Vendor", "Type", "Tags", "Body HTML", "Image Src",
    "Published", "Status",
  ];

  const rows: string[][] = [];
  for (const p of products) {
    const sizes = p.sizes.length ? p.sizes : [p.size];
    const barcodes = p.barcodes.length ? p.barcodes : [p.barcode];

    for (let i = 0; i < sizes.length; i++) {
      const isFirst = i === 0;
      rows.push([
        slugify(p.title + "-" + p.colour),
        isFirst ? p.title : "",
        "Colour",
        p.colour,
        "Size",
        sizes[i],
        `${p.sku.split("-").slice(0, 2).join("-")}-${sizes[i]}`.toUpperCase().replace(/\s+/g, "-"),
        p.retailPrice.toFixed(2),
        p.wholesaleCost.toFixed(2),
        barcodes[i] || "",
        isFirst ? p.vendor : "",
        isFirst ? p.productType : "",
        isFirst ? p.tags.join(", ") : "",
        isFirst ? p.description : "",
        isFirst ? p.imageUrl : "",
        "TRUE",
        "draft",
      ]);
    }
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
