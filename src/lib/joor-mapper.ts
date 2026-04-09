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

export interface MappedProduct {
  title: string;
  sku: string;
  barcode: string;
  description: string;
  vendor: string;
  productType: string;
  price: string;
  costPrice: string;
  colour: string;
  size: string;
  collection: string;
  season: string;
  fabrication: string;
  imageUrl: string;
  brand: string;
  priceStatus: "full_price" | "sale";
  isNew: boolean;
  arrivalMonth: string;
  sizes?: string[];
  barcodes?: string[];
  quantities?: number[];
}

export function mapJoorLineItemToProduct(
  item: JoorLineItem,
  orderMeta: { season_code?: string; delivery_name?: string }
): MappedProduct {
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
    price: item.price_retail?.toFixed(2) || "0.00",
    costPrice: item.price_wholesale?.toFixed(2) || "0.00",
    colour: item.color_name || "",
    size: item.size_name || "",
    collection: item.delivery_name || orderMeta.delivery_name || "",
    season: item.season_name || orderMeta.season_code || "",
    fabrication: item.fabrication || "",
    imageUrl: item.image_url || "",
    brand: item.brand || "",
    priceStatus: "full_price",
    isNew: true,
    arrivalMonth: month,
  };
}

export function groupJoorItemsIntoProducts(
  items: JoorLineItem[],
  orderMeta: { season_code?: string; delivery_name?: string }
): MappedProduct[] {
  const grouped = new Map<
    string,
    MappedProduct & { sizes: string[]; barcodes: string[]; quantities: number[] }
  >();

  for (const item of items) {
    const key = `${item.style_number}||${item.color_name}`;
    if (!grouped.has(key)) {
      const base = mapJoorLineItemToProduct(item, orderMeta);
      grouped.set(key, {
        ...base,
        sizes: [item.size_name],
        barcodes: [item.upc || ""],
        quantities: [item.quantity_ordered],
      });
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

export function deriveArrivalMonth(seasonCode: string): string {
  if (!seasonCode) return "";
  const upper = seasonCode.toUpperCase();
  const year = seasonCode.match(/\d{2,4}/)?.[0];
  const fullYear = year
    ? year.length === 2
      ? `20${year}`
      : year
    : new Date().getFullYear().toString();
  if (upper.startsWith("SS") || upper.startsWith("SP")) return `Jan ${fullYear}`;
  if (upper.startsWith("AW") || upper.startsWith("FW")) return `Jul ${fullYear}`;
  if (upper.startsWith("RE")) return `Apr ${fullYear}`;
  return "";
}

export function buildShopifyCSV(products: MappedProduct[]): string {
  const headers = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Product Category",
    "Type", "Tags", "Published", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Variant SKU", "Variant Price",
    "Cost per item", "Variant Barcode", "Image Src", "Collection",
  ];

  const rows: string[][] = [];
  for (const p of products) {
    const sizes = p.sizes || [p.size];
    const barcodes = p.barcodes || [p.barcode];

    for (let i = 0; i < sizes.length; i++) {
      const isFirst = i === 0;
      rows.push([
        slugify(p.title + "-" + p.colour),
        isFirst ? p.title : "",
        isFirst ? p.description : "",
        isFirst ? p.vendor : "",
        "",
        isFirst ? p.productType : "",
        isFirst
          ? [p.brand, p.colour, p.collection, "full_price", "new"]
              .filter(Boolean)
              .join(", ")
          : "",
        isFirst ? "TRUE" : "",
        "Colour",
        p.colour,
        "Size",
        sizes[i],
        `${p.sku.split("-").slice(0, 2).join("-")}-${sizes[i]}`.toUpperCase().replace(/\s+/g, "-"),
        p.price,
        p.costPrice,
        barcodes[i] || "",
        isFirst ? p.imageUrl : "",
        isFirst ? p.collection : "",
      ]);
    }
  }

  const escape = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;

  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

export function buildLightspeedCSV(products: MappedProduct[]): string {
  const headers = [
    "Handle", "Title", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Variant SKU",
    "Variant Price", "Cost per item", "Variant Barcode",
    "Vendor", "Type", "Tags", "Body HTML", "Image Src",
    "Published", "Status",
  ];

  const rows: string[][] = [];
  for (const p of products) {
    const sizes = p.sizes || [p.size];
    const barcodes = p.barcodes || [p.barcode];

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
        p.price,
        p.costPrice,
        barcodes[i] || "",
        isFirst ? p.vendor : "",
        isFirst ? p.productType : "",
        isFirst
          ? [p.brand, p.colour, p.collection, "full_price", "new"]
              .filter(Boolean)
              .join(", ")
          : "",
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
