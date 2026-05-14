/**
 * NuOrder File Parser — handles "Download Product Data XLS" exports.
 *
 * Detection: sheet name "NuORDER Item Data" OR headers contain all of
 *   Style Number, Wholesale AUD, Retail AUD, Media URL 1, available from.
 *
 * Format: long (one row per size). Group by Style Number + Color.
 * Images are plain CDN URLs (Media URL 1/2/3) — no embedded extraction needed.
 * Description field carries real marketing copy and is used directly.
 */

import * as XLSX from "@e965/xlsx";
import type { WholesaleOrder, WholesaleLineItem } from "./wholesale-mapper";

// ── Types ───────────────────────────────────────────────────────────────────

export interface NuOrderParsedProduct {
  styleNumber: string;
  styleName: string;
  description: string;
  brand: string;
  category: string;
  subcategory: string;
  department: string;
  division: string;
  season: string;
  colour: string;
  wholesale: number;
  rrp: number;
  arrivalDate: string;          // ISO date string from "available from"
  sizes: string[];
  quantities: number[];
  barcodes: string[];           // UPC 1 per size row
  images: string[];             // up to 3 https URLs (Media URL 1/2/3)
  totalUnits: number;
  totalValue: number;
  autoTags: string[];
}

export interface NuOrderFileParseResult {
  format: "xlsx_item_data" | "xlsx_order_data" | "unknown";
  brand: string;
  season: string;
  poNumber: string;
  orders: WholesaleOrder[];
  rawProducts: NuOrderParsedProduct[];
  rawRowCount?: number;
  detected?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const NUORDER_ITEM_SHEET = "NuORDER Item Data";
const NUORDER_ORDER_SHEET = "NuORDER Order Data";

const REQUIRED_HEADERS_ITEM = [
  "style number",
  "wholesale aud",
  "retail aud",
  "media url 1",
  "available from",
] as const;

const REQUIRED_HEADERS_ORDER = [
  "style number",
  "wholesale (aud)",
  "m.s.r.p (aud)",
  "available from",
] as const;

/** Detection: matches the spec's marker columns (case-insensitive). */
export function isNuOrderHeaderRow(headers: string[]): boolean {
  const h = headers.map((s) => String(s || "").trim().toLowerCase());
  return (
    REQUIRED_HEADERS_ITEM.every((req) => h.includes(req)) ||
    REQUIRED_HEADERS_ORDER.every((req) => h.includes(req))
  );
}

export function isNuOrderRecordSet(rows: Record<string, unknown>[]): boolean {
  if (!rows || rows.length === 0) return false;
  return isNuOrderHeaderRow(Object.keys(rows[0]));
}

/** Title-case a string while preserving short words sensibly. */
function titleCase(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

/** Normalise "AU10/US6" → "10". Falls back to first run of digits, else raw. */
function normaliseSize(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const au = s.match(/AU\s*(\d+)/i);
  if (au) return au[1];
  const m = s.match(/(\d+)/);
  if (m) return m[1];
  return s;
}

function slugTag(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Convert excel/JS Date or string to YYYY-MM-DD; returns "" when invalid. */
function toIsoDate(input: unknown): string {
  if (!input) return "";
  if (input instanceof Date && !isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  if (typeof input === "number") {
    // Excel serial date — xlsx with cellDates:true should already convert,
    // but handle the raw case too. Excel epoch = 1899-12-30.
    const ms = Math.round((input - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(String(input));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function arrivalTagFromIso(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const month = d.toLocaleString("en-US", { month: "short" }).toLowerCase();
  return `arriving-${month}-${d.getFullYear()}`;
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[,$]/g, ""));
  return isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function buildNuOrderTags(p: {
  brand?: string;
  category?: string;
  subcategory?: string;
  department?: string;
  division?: string;
  season?: string;
  colour?: string;
  arrivalIso?: string;
}): string[] {
  const tags: string[] = [];
  if (p.brand) tags.push(`vendor-${slugTag(p.brand)}`);
  if (p.category) tags.push(slugTag(p.category));
  if (p.subcategory) tags.push(slugTag(p.subcategory));
  if (p.department) tags.push(slugTag(p.department));
  if (p.division) tags.push(slugTag(p.division));
  if (p.season) {
    // "Season" might be "FW26" or "2026" — extract any 4-digit year if present
    const yearMatch = String(p.season).match(/(\d{4})/);
    if (yearMatch) tags.push(`season-${yearMatch[1]}`);
    else tags.push(slugTag(`season-${p.season}`));
  }
  if (p.colour) tags.push(slugTag(p.colour));
  if (p.arrivalIso) {
    const t = arrivalTagFromIso(p.arrivalIso);
    if (t) tags.push(t);
  }
  return Array.from(new Set(tags.filter(Boolean)));
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function parseNuOrderFile(file: File): Promise<NuOrderFileParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  // Prefer named NuORDER sheets; fall back to first sheet.
  const itemSheet = wb.SheetNames.find((n) => n.trim().toLowerCase() === NUORDER_ITEM_SHEET.toLowerCase());
  const orderSheet = wb.SheetNames.find((n) => n.trim().toLowerCase() === NUORDER_ORDER_SHEET.toLowerCase());
  const sheetName = itemSheet || orderSheet || wb.SheetNames[0];
  if (!sheetName) {
    return { format: "unknown", brand: "", season: "", poNumber: "", orders: [], rawProducts: [] };
  }
  const ws = wb.Sheets[sheetName];

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (rows.length === 0) {
    return { format: "unknown", brand: "", season: "", poNumber: "", orders: [], rawProducts: [] };
  }

  const headers = Object.keys(rows[0]);
  const h = headers.map((s) => s.trim().toLowerCase());
  const isOrderFormat =
    sheetName.trim().toLowerCase() === NUORDER_ORDER_SHEET.toLowerCase() ||
    REQUIRED_HEADERS_ORDER.every((req) => h.includes(req));
  const isItemFormat =
    !isOrderFormat &&
    (sheetName.trim().toLowerCase() === NUORDER_ITEM_SHEET.toLowerCase() ||
      REQUIRED_HEADERS_ITEM.every((req) => h.includes(req)));

  if (isOrderFormat) return parseOrderFormat(rows, headers, file);
  if (!isItemFormat) {
    return { format: "unknown", brand: "", season: "", poNumber: "", orders: [], rawProducts: [] };
  }

  // Build a case-insensitive header lookup so we don't break on minor casing
  // differences (e.g. "Wholesale Aud" vs "Wholesale AUD").
  const headerMap = new Map<string, string>();
  for (const h of headers) headerMap.set(h.trim().toLowerCase(), h);
  const get = (row: Record<string, unknown>, name: string): unknown => {
    const real = headerMap.get(name.toLowerCase());
    return real ? row[real] : "";
  };

  // ── Group rows by Style Number + Color ────────────────────────────────────
  const groups = new Map<string, NuOrderParsedProduct>();
  let rawRows = 0;
  let topBrand = "";
  let topSeason = "";

  for (const row of rows) {
    const styleNumber = str(get(row, "Style Number"));
    const colour = str(get(row, "Color"));
    if (!styleNumber) continue;

    const wholesale = num(get(row, "Wholesale AUD"));
    const rrp = num(get(row, "Retail AUD"));
    if (wholesale === 0 && rrp === 0) continue;
    rawRows++;

    const key = `${styleNumber}||${colour}`;
    const sizeLabel = normaliseSize(get(row, "Size 1"));
    const qty = Math.max(0, Math.round(num(get(row, "Quantity")) || num(get(row, "Qty")) || 0));
    const barcode = str(get(row, "UPC 1"));

    let group = groups.get(key);
    if (!group) {
      const brand = str(get(row, "Brands")) || str(get(row, "Brand"));
      const category = str(get(row, "Category"));
      const subcategory = str(get(row, "Subcategory"));
      const department = str(get(row, "Department"));
      const division = str(get(row, "Division"));
      const season = str(get(row, "Season"));
      const arrivalIso = toIsoDate(get(row, "available from"));
      const description = str(get(row, "Description"));
      const styleName = titleCase(str(get(row, "Name")));

      if (!topBrand && brand) topBrand = brand;
      if (!topSeason && season) topSeason = season;

      group = {
        styleNumber,
        styleName,
        description,
        brand,
        category,
        subcategory,
        department,
        division,
        season,
        colour,
        wholesale,
        rrp,
        arrivalDate: arrivalIso,
        sizes: [],
        quantities: [],
        barcodes: [],
        images: [],
        totalUnits: 0,
        totalValue: 0,
        autoTags: buildNuOrderTags({
          brand,
          category,
          subcategory,
          department,
          division,
          season,
          colour,
          arrivalIso,
        }),
      };
      groups.set(key, group);
    }

    // Description / images: prefer the first non-empty value across the group
    // (NuOrder typically populates these only on the first size row).
    if (!group.description) {
      const d = str(get(row, "Description"));
      if (d) group.description = d;
    }
    for (let i = 1; i <= 3; i++) {
      const url = str(get(row, `Media URL ${i}`));
      if (url && /^https?:\/\//i.test(url) && !group.images.includes(url)) {
        group.images.push(url);
      }
    }

    if (sizeLabel) {
      group.sizes.push(sizeLabel);
      group.quantities.push(qty);
      group.barcodes.push(barcode);
      group.totalUnits += qty;
      group.totalValue += qty * wholesale;
    }
  }

  const products = Array.from(groups.values());

  // ── Brand fallback from filename if not present in any row ───────────────
  let brand = topBrand;
  if (!brand) {
    const cleaned = file.name.replace(/\.[^.]+$/, "").split(/[-_]/);
    for (const part of cleaned) {
      if (part.length > 2 && !/^\d+$/.test(part) && !/^products$/i.test(part) && !/^export$/i.test(part)) {
        brand = part.trim().replace(/\s+/g, " ");
        break;
      }
    }
  }

  const order = productsToWholesaleOrder(products, { brand, season: topSeason, poNumber: "" });

  return {
    format: "xlsx_item_data",
    brand,
    season: topSeason,
    poNumber: "",
    orders: products.length > 0 ? [order] : [],
    rawProducts: products,
    rawRowCount: rawRows,
    detected: true,
  };
}

// ── Mapping to WholesaleOrder ───────────────────────────────────────────────

function productsToWholesaleOrder(
  products: NuOrderParsedProduct[],
  meta: { brand: string; season: string; poNumber: string },
): WholesaleOrder {
  const lineItems: WholesaleLineItem[] = [];

  for (const p of products) {
    // Image Src in the wholesale CSV pipeline is single-URL; downstream
    // Shopify push paths can read p.images[] directly off rawProducts.
    const primaryImage = p.images[0] || "";

    if (p.sizes.length > 0) {
      for (let i = 0; i < p.sizes.length; i++) {
        lineItems.push({
          styleNumber: p.styleNumber,
          styleName: p.styleName,
          description: p.description,
          brand: p.brand || meta.brand,
          productType: p.category || p.subcategory || "",
          fabrication: "",
          colour: p.colour,
          colourCode: p.colour,
          size: p.sizes[i],
          barcode: p.barcodes[i] || "",
          rrp: p.rrp,
          wholesale: p.wholesale,
          quantityOrdered: p.quantities[i] || 0,
          season: p.season || meta.season,
          collection: p.season || meta.season,
          arrivalMonth: p.arrivalDate,
          imageUrl: primaryImage,
          sourceOrderId: meta.poNumber,
          sourcePlatform: "nuorder",
        });
      }
    } else {
      lineItems.push({
        styleNumber: p.styleNumber,
        styleName: p.styleName,
        description: p.description,
        brand: p.brand || meta.brand,
        productType: p.category || p.subcategory || "",
        fabrication: "",
        colour: p.colour,
        colourCode: p.colour,
        size: "OS",
        barcode: "",
        rrp: p.rrp,
        wholesale: p.wholesale,
        quantityOrdered: p.totalUnits || 1,
        season: p.season || meta.season,
        collection: p.season || meta.season,
        arrivalMonth: p.arrivalDate,
        imageUrl: primaryImage,
        sourceOrderId: meta.poNumber,
        sourcePlatform: "nuorder",
      });
    }
  }

  const total = products.reduce((s, p) => s + p.totalValue, 0);

  return {
    orderId: meta.poNumber || `NUORDER-${Date.now()}`,
    platform: "nuorder",
    brandName: meta.brand,
    season: meta.season,
    collection: meta.season,
    currency: "AUD",
    orderTotal: total,
    retailerName: "",
    status: "Imported",
    lineItems,
    importedAt: new Date().toISOString(),
  };
}


// ── Format B: NuORDER Order Data (wide format) ─────────────────────────────

const SIZE_COL_RE = /^AU\s*\d+\s*\/\s*US\s*\d+$/i;
const SIZE_PRICE_RE = /size\s*price$/i;

function parseOrderFormat(
  rows: Record<string, unknown>[],
  headers: string[],
  file: File,
): NuOrderFileParseResult {
  const headerMap = new Map<string, string>();
  for (const h of headers) headerMap.set(h.trim().toLowerCase(), h);
  const get = (row: Record<string, unknown>, name: string): unknown => {
    const real = headerMap.get(name.toLowerCase());
    return real ? row[real] : "";
  };

  // Discover dynamic size columns; skip "{size} size price" twins.
  const sizeColumns = headers.filter(
    (col) => SIZE_COL_RE.test(col.trim()) && !SIZE_PRICE_RE.test(col.trim()),
  );

  const groups = new Map<string, NuOrderParsedProduct>();
  let rawRows = 0;
  let topBrand = "";
  let topSeason = "";

  for (const row of rows) {
    const styleNumber = str(get(row, "Style Number"));
    if (!styleNumber) continue;
    const colour = str(get(row, "Color"));
    const wholesale = num(get(row, "Wholesale (AUD)"));
    const rrp = num(get(row, "M.S.R.P (AUD)"));
    if (wholesale === 0 && rrp === 0) continue;
    rawRows++;

    const sizes: string[] = [];
    const quantities: number[] = [];
    let totalUnits = 0;
    for (const col of sizeColumns) {
      const raw = row[col];
      if (raw == null || raw === "") continue;
      // Skip cells whose value is a formula string (NuOrder totals).
      if (typeof raw === "string" && raw.trim().startsWith("=")) continue;
      const qty = Math.max(0, Math.round(num(raw)));
      if (qty <= 0) continue;
      sizes.push(normaliseSize(col));
      quantities.push(qty);
      totalUnits += qty;
    }

    const brand = str(get(row, "Brands")) || str(get(row, "Brand"));
    const category = str(get(row, "Category"));
    const subcategory = str(get(row, "Subcategory"));
    const department = str(get(row, "Department"));
    const division = str(get(row, "Division"));
    const season = str(get(row, "Season"));
    const arrivalIso = toIsoDate(get(row, "Available From"));
    const description = str(get(row, "Description"));
    const styleName = titleCase(str(get(row, "Name")));

    if (!topBrand && brand) topBrand = brand;
    if (!topSeason && season) topSeason = season;

    const key = `${styleNumber}||${colour}`;
    const existing = groups.get(key);
    if (existing) {
      // Merge sizes if same style+colour appears twice.
      for (let i = 0; i < sizes.length; i++) {
        existing.sizes.push(sizes[i]);
        existing.quantities.push(quantities[i]);
        existing.barcodes.push("");
        existing.totalUnits += quantities[i];
        existing.totalValue += quantities[i] * wholesale;
      }
      continue;
    }

    groups.set(key, {
      styleNumber,
      styleName,
      description,
      brand,
      category,
      subcategory,
      department,
      division,
      season,
      colour,
      wholesale,
      rrp,
      arrivalDate: arrivalIso,
      sizes,
      quantities,
      barcodes: sizes.map(() => ""),
      images: [], // Format B has no image URLs — enrichment cascade fills these in
      totalUnits,
      totalValue: totalUnits * wholesale,
      autoTags: buildNuOrderTags({
        brand, category, subcategory, department, division, season, colour, arrivalIso,
      }),
    });
  }

  const products = Array.from(groups.values());

  let brand = topBrand;
  if (!brand) {
    const cleaned = file.name.replace(/\.[^.]+$/, "").split(/[-_]/);
    for (const part of cleaned) {
      if (part.length > 2 && !/^\d+$/.test(part) && !/^products?$/i.test(part) && !/^export$/i.test(part) && !/^order$/i.test(part)) {
        brand = part.trim().replace(/\s+/g, " ");
        break;
      }
    }
  }

  const order = productsToWholesaleOrder(products, { brand, season: topSeason, poNumber: "" });

  return {
    format: "xlsx_order_data",
    brand,
    season: topSeason,
    poNumber: "",
    orders: products.length > 0 ? [order] : [],
    rawProducts: products,
    rawRowCount: rawRows,
    detected: true,
  };
}
