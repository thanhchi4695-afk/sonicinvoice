/**
 * POS Normaliser — converts Shopify, Lightspeed X-Series, and
 * Lightspeed R-Series product data into a unified format so
 * stock-matcher.ts can classify items from any platform.
 */

export interface NormalisedProduct {
  id: string;
  name: string;
  variantName: string;
  sku: string;
  barcode: string;
  colour: string;
  size: string;
  price: number;
  costPrice: number;
  inventoryQty: number;
  isVariant: boolean;
  parentId: string;
  allSiblings: NormalisedProduct[];
  platform: "shopify" | "lightspeed_x" | "lightspeed_r";
  raw: unknown;
}

const COLOUR_KEYS = ["colour", "color", "col"];
const SIZE_KEYS = ["size", "sz"];

function findOption(
  options: { name: string; value: string }[] | undefined,
  keys: string[],
): string {
  if (!options) return "";
  return options.find(o => keys.includes(o.name.toLowerCase()))?.value || "";
}

// ── LIGHTSPEED X-SERIES ──
export function normaliseXProduct(p: Record<string, unknown>): NormalisedProduct {
  const options = (p.variant_options as { name: string; value: string }[]) || [];
  return {
    id: String(p.id),
    name: String(p.name || ""),
    variantName: String(p.variant_name || p.name || ""),
    sku: String(p.sku || ""),
    barcode: "",
    colour: findOption(options, COLOUR_KEYS),
    size: findOption(options, SIZE_KEYS),
    price: Number(p.price) || 0,
    costPrice: Number(p.supply_price) || 0,
    inventoryQty: Number(p.inventory_count) || 0,
    isVariant: !!(p.variant_parent_id || p.has_variants),
    parentId: String(p.variant_parent_id || p.id),
    allSiblings: [],
    platform: "lightspeed_x",
    raw: p,
  };
}

// ── LIGHTSPEED R-SERIES ──
export function normaliseRItem(item: Record<string, unknown>): NormalisedProduct {
  const prices = (item.Prices as Record<string, unknown[]>)?.ItemPrice || [];
  const defPrice = (prices as { amount: string; useType: string }[])
    .find(p => p.useType === "Default")?.amount || "0";

  const shopData = (item.ItemShops as { ItemShop: { qoh: string }[] })?.ItemShop || [];
  const totalQty = (shopData as { qoh: string }[])
    .reduce((sum, s) => sum + (parseInt(s.qoh) || 0), 0);

  const matrix = item.ItemMatrix as Record<string, unknown>;
  const attrs = (matrix?.Attributes as Record<string, { name: string; value: string }[]>)?.Attribute || [];
  const colour = attrs.find(a => COLOUR_KEYS.includes(a.name.toLowerCase()))?.value || "";
  const size = attrs.find(a => SIZE_KEYS.includes(a.name.toLowerCase()))?.value || "";

  const matrixId = String(item.itemMatrixID || "0");

  return {
    id: String(item.itemID),
    name: String(item.description || ""),
    variantName: String(item.description || ""),
    sku: String(item.customSku || item.manufacturerSku || ""),
    barcode: String(item.upc || item.ean || ""),
    colour,
    size,
    price: Number(defPrice) || 0,
    costPrice: Number(item.defaultCost) || 0,
    inventoryQty: totalQty,
    isVariant: matrixId !== "0",
    parentId: matrixId !== "0" ? matrixId : String(item.itemID),
    allSiblings: [],
    platform: "lightspeed_r",
    raw: item,
  };
}

// ── SHOPIFY ──
export function normaliseShopifyVariant(v: Record<string, unknown>): NormalisedProduct {
  const options = (v.selectedOptions as { name: string; value: string }[]) || [];
  const product = v.product as Record<string, unknown>;

  return {
    id: String(v.id),
    name: String(product?.title || ""),
    variantName: String(v.title || ""),
    sku: String(v.sku || ""),
    barcode: String(v.barcode || ""),
    colour: findOption(options, COLOUR_KEYS),
    size: findOption(options, SIZE_KEYS),
    price: Number(v.price) || 0,
    costPrice: 0,
    inventoryQty: Number(v.inventoryQuantity) || 0,
    isVariant: true,
    parentId: String(product?.id || ""),
    allSiblings: [],
    platform: "shopify",
    raw: v,
  };
}

/**
 * Convert NormalisedProduct[] → ShopifyVariant[] format
 * so stock-matcher.ts matchAllLineItems() works unchanged.
 */
export function toShopifyVariantFormat(products: NormalisedProduct[]) {
  // Group by parentId to build product families
  const families = new Map<string, NormalisedProduct[]>();
  for (const p of products) {
    const key = p.parentId;
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(p);
  }

  return products.map(p => {
    const siblings = families.get(p.parentId) || [p];
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      title: p.variantName,
      inventoryItemId: p.id,
      inventoryQty: p.inventoryQty,
      price: String(p.price),
      option1: p.colour,
      option2: p.size,
      image: undefined,
      product: {
        id: p.parentId,
        title: p.name,
        vendor: "",
        productType: "",
        tags: [] as string[],
        options: [] as { name: string; values: string[] }[],
        variants: siblings.map(s => ({
          id: s.id,
          sku: s.sku,
          barcode: s.barcode,
          title: s.variantName,
          inventoryItemId: s.id,
          inventoryQty: s.inventoryQty,
          price: String(s.price),
          option1: s.colour,
          option2: s.size,
          image: undefined,
          product: null as unknown as any,
        })),
      },
      _platform: p.platform,
    };
  });
}
