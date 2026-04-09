export interface WholesaleLineItem {
  styleNumber: string;
  styleName: string;
  description: string;
  brand: string;
  productType: string;
  fabrication: string;
  colour: string;
  colourCode: string;
  size: string;
  barcode: string;
  rrp: number;
  wholesale: number;
  quantityOrdered: number;
  season: string;
  collection: string;
  arrivalMonth: string;
  imageUrl: string;
  sourceOrderId: string;
  sourcePlatform: string;
}

export interface WholesaleOrder {
  orderId: string;
  platform: string;
  brandName: string;
  season: string;
  collection: string;
  currency: string;
  orderTotal: number;
  retailerName: string;
  status: string;
  lineItems: WholesaleLineItem[];
  importedAt: string;
}

export function deriveArrivalMonth(season: string): string {
  if (!season) return "";
  const upper = season.toUpperCase();
  const yearMatch = season.match(/\d{2,4}/);
  const yr = yearMatch
    ? yearMatch[0].length === 2 ? `20${yearMatch[0]}` : yearMatch[0]
    : new Date().getFullYear().toString();
  if (upper.startsWith("SS") || upper.startsWith("SP") || upper.startsWith("RESORT") || upper.startsWith("RE"))
    return `Jan ${yr}`;
  if (upper.startsWith("AW") || upper.startsWith("FW") || upper.startsWith("FALL") || upper.startsWith("WINTER"))
    return `Jul ${yr}`;
  if (upper.startsWith("PRE-SPRING") || upper.startsWith("HO"))
    return `Oct ${yr}`;
  return "";
}

export function buildWholesaleShopifyCSV(orders: WholesaleOrder[]): string {
  const headers = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags",
    "Published", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value",
    "Variant SKU", "Variant Price", "Cost per item",
    "Variant Barcode", "Image Src", "Collection",
    "Season", "Source Platform",
  ];

  const rows: string[][] = [];
  for (const order of orders) {
    for (const item of order.lineItems) {
      const sku = `${item.styleNumber}-${item.colourCode || item.colour}-${item.size}`
        .toUpperCase().replace(/\s+/g, "-");
      rows.push([
        slugify(item.styleName),
        item.styleName,
        item.description,
        item.brand,
        item.productType,
        [item.brand, item.colour, item.collection, "full_price", "new"].filter(Boolean).join(", "),
        "TRUE",
        "Colour", item.colour,
        "Size", item.size,
        sku,
        item.rrp.toFixed(2),
        item.wholesale.toFixed(2),
        item.barcode,
        item.imageUrl,
        item.collection,
        item.season,
        item.sourcePlatform,
      ]);
    }
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

export function buildWholesaleLightspeedCSV(orders: WholesaleOrder[]): string {
  const headers = [
    "Handle", "Title", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Variant SKU",
    "Variant Price", "Cost per item", "Variant Barcode",
    "Vendor", "Type", "Tags", "Body HTML", "Image Src",
    "Published", "Status",
  ];

  const rows: string[][] = [];
  for (const order of orders) {
    for (const item of order.lineItems) {
      const sku = `${item.styleNumber}-${item.colourCode || item.colour}-${item.size}`
        .toUpperCase().replace(/\s+/g, "-");
      rows.push([
        slugify(item.styleName),
        item.styleName,
        "Colour", item.colour,
        "Size", item.size,
        sku,
        item.rrp.toFixed(2),
        item.wholesale.toFixed(2),
        item.barcode,
        item.brand,
        item.productType,
        [item.brand, item.colour, item.collection, "full_price", "new"].filter(Boolean).join(", "),
        item.description,
        item.imageUrl,
        "TRUE",
        "draft",
      ]);
    }
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function slugify(str: string): string {
  return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
