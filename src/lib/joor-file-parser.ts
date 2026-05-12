/**
 * JOOR File Parser — AI-powered detection and parsing of JOOR export files.
 * Handles 3 formats:
 *   1. XLSX Order Summary (simple) — columns: Style Name, Style Number, Color, Fabrication, sizes, Wholesale, Retail
 *   2. XLSX Full Linesheet — columns: Style Name, Style Number, Color, Fabrication, Category, Subcategory, Description, sizes, Wholesale, Retail
 *   3. PDF Order Confirmation — visual format parsed with regex from text content
 */

import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { WholesaleOrder, WholesaleLineItem } from "./wholesale-mapper";
import { deriveArrivalMonth } from "./wholesale-mapper";

// ── Embedded image extraction (Excel image objects in xl/media/) ──
// JOOR "Export Order to Size" embeds product photos as drawings anchored to
// each product row. We unzip the .xlsx, walk drawings → rels → media, and
// build a Map<rowIndex (1-based), dataUrl>. The active sheet's drawing is
// resolved via xl/_rels/workbook.xml.rels + xl/worksheets/_rels/sheetN.xml.rels.
async function extractEmbeddedRowImages(
  buffer: ArrayBuffer,
  activeSheetIndex: number,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const zip = await JSZip.loadAsync(buffer);

    // Resolve sheet target path from workbook rels (preserves order of <sheet>)
    const wbRelsFile = zip.file("xl/_rels/workbook.xml.rels");
    const wbXmlFile = zip.file("xl/workbook.xml");
    if (!wbRelsFile || !wbXmlFile) return out;
    const wbRels = await wbRelsFile.async("string");
    const wbXml = await wbXmlFile.async("string");

    // Map sheet order → rId → target. <sheet name="..." sheetId="..." r:id="rIdN"/>
    const sheetRids: string[] = [];
    const sheetTagRe = /<sheet[^>]*r:id="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = sheetTagRe.exec(wbXml)) !== null) sheetRids.push(m[1]);
    const targetRid = sheetRids[activeSheetIndex];
    if (!targetRid) return out;

    const relRe = new RegExp(`<Relationship[^>]*Id="${targetRid}"[^>]*Target="([^"]+)"`);
    const relMatch = relRe.exec(wbRels);
    if (!relMatch) return out;
    // Target is e.g. "worksheets/sheet1.xml" → sheet basename
    const sheetPath = relMatch[1].replace(/^\/?xl\//, "");
    const sheetBase = sheetPath.split("/").pop() || ""; // sheet1.xml
    const sheetRelsPath = `xl/worksheets/_rels/${sheetBase}.rels`;

    const sheetRelsFile = zip.file(sheetRelsPath);
    if (!sheetRelsFile) return out;
    const sheetRels = await sheetRelsFile.async("string");
    const drawingMatch = /<Relationship[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/.exec(sheetRels);
    if (!drawingMatch) return out;
    // Target like "../drawings/drawing1.xml"
    const drawingFile = drawingMatch[1].split("/").pop() || ""; // drawing1.xml
    const drawingPath = `xl/drawings/${drawingFile}`;
    const drawingRelsPath = `xl/drawings/_rels/${drawingFile}.rels`;

    const drawingZip = zip.file(drawingPath);
    const drawingRelsZip = zip.file(drawingRelsPath);
    if (!drawingZip || !drawingRelsZip) return out;
    const drawingXml = await drawingZip.async("string");
    const drawingRels = await drawingRelsZip.async("string");

    // rId → media path
    const ridToMedia = new Map<string, string>();
    const ridRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
    while ((m = ridRe.exec(drawingRels)) !== null) {
      if (/image/i.test(m[2]) || /media/i.test(m[2])) {
        const target = m[2].replace(/^\.\.\//, "");
        ridToMedia.set(m[1], `xl/${target}`);
      }
    }

    // Anchor → row + rId. JOOR uses oneCellAnchor; also handle twoCellAnchor.
    const anchorRe = /<xdr:(?:oneCellAnchor|twoCellAnchor)[^>]*>([\s\S]*?)<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/g;
    while ((m = anchorRe.exec(drawingXml)) !== null) {
      const block = m[1];
      const rowMatch = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(block);
      const blipMatch = /<a:blip[^>]*r:embed="([^"]+)"/.exec(block);
      if (!rowMatch || !blipMatch) continue;
      const xdrRow = parseInt(rowMatch[1], 10); // 0-based
      const xlsxRow = xdrRow + 1; // 1-based, matches openpyxl/sheet_to_json row index when origin=1
      const mediaPath = ridToMedia.get(blipMatch[1]);
      if (!mediaPath) continue;
      // Skip JOOR's footer logo (small png like joor6.png)
      if (/joor\d*\.png$/i.test(mediaPath)) continue;

      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) continue;
      const bytes = await mediaFile.async("uint8array");
      // Skip blanks / tiny placeholders
      if (bytes.byteLength < 800) continue;
      const ext = (mediaPath.split(".").pop() || "jpg").toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
      // Convert to base64 (chunked to avoid stack overflow)
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const dataUrl = `data:${mime};base64,${btoa(bin)}`;
      // Only set the FIRST image found per row (some rows have multiple anchors).
      if (!out.has(xlsxRow)) out.set(xlsxRow, dataUrl);
    }
  } catch (err) {
    console.warn("[joor-file-parser] Embedded image extraction failed:", err);
  }
  return out;
}

export interface JoorFileParseResult {
  format: "xlsx_order" | "xlsx_linesheet" | "pdf_order" | "unknown";
  brand: string;
  season: string;
  poNumber: string;
  orders: WholesaleOrder[];
  rawProducts: JoorParsedProduct[];
  rawRowCount?: number;
  detected?: boolean;
}

export interface JoorParsedProduct {
  styleName: string;
  styleNumber: string;
  colour: string;
  colourCode: string;
  fabrication: string;
  materials: string;
  category: string;
  subcategory: string;
  silhouette?: string;
  countryOfOrigin?: string;
  description: string;
  wholesale: number;
  rrp: number;
  sizes: string[];
  quantities: number[];
  totalUnits: number;
  totalValue: number;
  imageUrl: string;
  deliveryStart?: string;
  deliveryEnd?: string;
  autoTags?: string[];
}

/**
 * Detect a JOOR catalog export by checking for the 4 marker columns.
 * Spec rule: Style Number + Wholesale Price + Sugg. Retail Price + Delivery Start Date.
 * Also accepts the older variants ("Wholesale (AUD)", "Sugg. Retail (AUD)").
 */
export function isJoorHeaderRow(headers: string[]): boolean {
  const h = headers.map((s) => String(s || "").trim().toLowerCase());
  const hasStyleNum = h.includes("style number") || h.includes("style_number");
  const hasWholesale = h.some((c) => c === "wholesale price" || c === "wholesale" || c.startsWith("wholesale (") || c.startsWith("wholesale price ("));
  const hasRetail = h.some((c) => c === "sugg. retail price" || c === "sugg. retail" || c.startsWith("sugg. retail price (") || c.startsWith("sugg. retail ("));
  const hasDelivery = h.some((c) => c === "delivery start date" || c === "delivery start" || c === "delivery name");
  return hasStyleNum && hasWholesale && hasRetail && hasDelivery;
}

export function isJoorRecordSet(rows: Record<string, string>[]): boolean {
  if (!rows || rows.length === 0) return false;
  return isJoorHeaderRow(Object.keys(rows[0]));
}

/** Extract the AU/UK number from "8 AU/UK (4 US)" → "8". */
function normaliseSizeLabel(raw: string): string {
  if (!raw) return raw;
  const auMatch = raw.match(/^(\d+)\s*AU\/UK/i);
  if (auMatch) return auMatch[1];
  const m = raw.match(/^(\d+|OS|XXS|XS|S|M|L|XL|XXL|FREE)/i);
  return m ? m[1] : raw;
}

/** Format a date string as "MMM YYYY" for arrival tags (e.g. "arriving-jun-2026"). */
function arrivalFromDate(input: string): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  const month = d.toLocaleString("en-US", { month: "short" }).toLowerCase();
  return `arriving-${month}-${d.getFullYear()}`;
}

function slugTag(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Build the auto-tag list per spec: vendor, category, material-X, fabric, drop, arriving, country. */
function buildAutoTags(p: Partial<JoorParsedProduct> & { brand?: string }): string[] {
  const tags: string[] = [];
  if (p.brand) tags.push(slugTag(p.brand));
  if (p.subcategory) tags.push(slugTag(p.subcategory));
  else if (p.category) tags.push(slugTag(p.category));
  if (p.materials) tags.push(`material-${slugTag(p.materials)}`);
  if (p.fabrication) tags.push(slugTag(p.fabrication));
  if (p.silhouette) tags.push(slugTag(p.silhouette));
  if (p.countryOfOrigin) tags.push(`made-in-${slugTag(p.countryOfOrigin)}`);
  if (p.deliveryStart) {
    const t = arrivalFromDate(p.deliveryStart);
    if (t) tags.push(t);
  }
  return Array.from(new Set(tags.filter(Boolean)));
}

// ── Main entry point ──
export async function parseJoorFile(file: File): Promise<JoorFileParseResult> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    return parseJoorPDF(file);
  }
  if (ext === "xlsx" || ext === "xls") {
    return parseJoorXLSX(file);
  }
  return { format: "unknown", brand: "", season: "", poNumber: "", orders: [], rawProducts: [] };
}

// ── XLSX Parser ──
async function parseJoorXLSX(file: File): Promise<JoorFileParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Extract metadata from top rows
  let poNumber = "";
  let season = "";
  let brand = "";
  let isLinesheet = false;

  // Scan first 10 rows for metadata
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    for (let j = 0; j < row.length; j++) {
      const val = String(row[j] || "").trim();
      if (val === "PO#" || val === "PO Number:") poNumber = String(row[j + 1] || "").trim();
      if (val === "Linesheet" || val === "Season") season = String(row[j + 1] || "").trim();
      if (val === "Season Year") season = String(row[j + 1] || "").trim();
      // Brand is often the second cell in the first data row
    }
  }

  // Find header row (contains "Style Name" and "Style Number")
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i].map((v: any) => String(v || "").trim());
    if (row.includes("Style Name") && row.includes("Style Number")) {
      headerIdx = i;
      headers = row;
      break;
    }
  }

  if (headerIdx === -1) {
    return { format: "unknown", brand: "", season: "", poNumber: "", orders: [], rawProducts: [] };
  }

  // Detect format by checking for linesheet-specific columns
  isLinesheet = headers.includes("Category") || headers.includes("Subcategory") || headers.includes("Description");

  // Map column indices
  const col = (name: string) => headers.indexOf(name);
  const colAny = (...names: string[]) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const styleNameIdx = col("Style Name");
  const styleNumIdx = col("Style Number");
  const colorIdx = colAny("Color Name", "Color", "Colour");
  const colorCodeIdx = colAny("Color Code", "Colour Code");
  const fabricIdx = colAny("Fabrication Name", "Fabrication", "Fab. Code");
  const materialsIdx = col("Materials");
  const categoryIdx = col("Category");
  const subcategoryIdx = colAny("Sub Category", "Subcategory");
  const silhouetteIdx = colAny("Silhouette Name", "Silhouette");
  const countryIdx = colAny("Country of Origin", "Country");
  const descriptionIdx = col("Description");
  const wholesaleIdx = colAny("Wholesale Price", "Wholesale (AUD)", "WholeSale (AUD)", "Wholesale");
  const retailIdx = colAny("Sugg. Retail Price", "Sugg. Retail (AUD)", "Sugg. Retail", "Retail");
  const unitsIdx = colAny("Units Ordered", "Units");
  const sizeColIdx = colAny("Size");
  const deliveryStartIdx = colAny("Delivery Start Date", "Delivery Start");
  const deliveryEndIdx = colAny("Delivery End Date", "Delivery End");
  const brandIdx = colAny("Brand Name", "Brand");

  // Detect wide-format size columns (one column per size, "8 AU/UK (4 US)" etc.)
  const sizeColumns: { idx: number; label: string }[] = [];
  const sizePattern = /^\d+\s*(AU|US|UK)|^OS$|^XXS$|^XS$|^S$|^M$|^L$|^XL$|^XXL$/i;
  for (let j = 0; j < headers.length; j++) {
    if (sizePattern.test(headers[j]) || headers[j].match(/^\d+\s+AU\/UK/)) {
      sizeColumns.push({ idx: j, label: headers[j] });
    }
  }
  const isLongFormat = sizeColIdx >= 0 && sizeColumns.length === 0;

  // Parse product rows
  const products: JoorParsedProduct[] = [];
  let rawRows = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const styleName = String(row[styleNameIdx] || "").trim();
    const styleNum = String(row[styleNumIdx] || "").trim();
    if (!styleName && !styleNum) continue;

    const wholesale = parseFloat(String(row[wholesaleIdx] || "0").replace(/[,$]/g, "")) || 0;
    const rrp = parseFloat(String(row[retailIdx] || "0").replace(/[,$]/g, "")) || 0;
    if (wholesale === 0 && rrp === 0) continue;
    rawRows++;

    // Extract sizes and quantities (wide vs long format)
    const sizes: string[] = [];
    const quantities: number[] = [];
    if (isLongFormat) {
      const sz = normaliseSizeLabel(String(row[sizeColIdx] || "").trim());
      const qty = parseInt(String(row[unitsIdx] || "0")) || 0;
      if (sz) {
        sizes.push(sz);
        quantities.push(qty);
      }
    } else {
      for (const sc of sizeColumns) {
        const qty = parseInt(String(row[sc.idx] || "0")) || 0;
        if (qty > 0) {
          sizes.push(normaliseSizeLabel(sc.label));
          quantities.push(qty);
        }
      }
    }

    const totalUnits = unitsIdx >= 0 && !isLongFormat
      ? (parseInt(String(row[unitsIdx] || "0")) || quantities.reduce((a, b) => a + b, 0))
      : quantities.reduce((a, b) => a + b, 0);

    // Per-row brand wins; otherwise inferred from filename later
    const rowBrand = brandIdx >= 0 ? String(row[brandIdx] || "").trim() : "";
    if (!brand && rowBrand) brand = rowBrand;

    const deliveryStart = deliveryStartIdx >= 0 ? String(row[deliveryStartIdx] || "").trim() : "";
    const deliveryEnd = deliveryEndIdx >= 0 ? String(row[deliveryEndIdx] || "").trim() : "";

    const product: JoorParsedProduct = {
      styleName,
      styleNumber: styleNum,
      colour: String(row[colorIdx] || "").trim(),
      colourCode: String(row[colorCodeIdx] || "").trim(),
      fabrication: String(row[fabricIdx] || "").trim(),
      materials: materialsIdx >= 0 ? String(row[materialsIdx] || "").trim() : "",
      category: categoryIdx >= 0 ? String(row[categoryIdx] || "").trim() : "",
      subcategory: subcategoryIdx >= 0 ? String(row[subcategoryIdx] || "").trim() : "",
      silhouette: silhouetteIdx >= 0 ? String(row[silhouetteIdx] || "").trim() : "",
      countryOfOrigin: countryIdx >= 0 ? String(row[countryIdx] || "").trim() : "",
      description: descriptionIdx >= 0 ? String(row[descriptionIdx] || "").trim() : "",
      wholesale,
      rrp,
      sizes,
      quantities,
      totalUnits,
      totalValue: totalUnits * wholesale,
      imageUrl: "",
      deliveryStart,
      deliveryEnd,
    };
    product.autoTags = buildAutoTags({ ...product, brand: rowBrand || brand });
    products.push(product);
  }

  // Detect brand from filename if still missing
  if (!brand) {
    const parts = file.name.replace(/\.[^.]+$/, "").split(/[-_]/);
    for (const p of parts) {
      if (p.length > 2 && !/^\d+$/.test(p)) {
        brand = p.trim().replace(/\s+/g, " ");
        break;
      }
    }
  }

  // If long-format, merge rows sharing styleNumber+colour into one product with multiple sizes
  let finalProducts = products;
  if (isLongFormat) {
    const merged = new Map<string, JoorParsedProduct>();
    for (const p of products) {
      const key = `${p.styleNumber}||${p.colour}`;
      const existing = merged.get(key);
      if (!existing) { merged.set(key, p); continue; }
      existing.sizes.push(...p.sizes);
      existing.quantities.push(...p.quantities);
      existing.totalUnits += p.totalUnits;
      existing.totalValue += p.totalValue;
    }
    finalProducts = Array.from(merged.values());
  }

  const order = productsToWholesaleOrder(finalProducts, { brand, season, poNumber });

  return {
    format: isLinesheet ? "xlsx_linesheet" : "xlsx_order",
    brand,
    season,
    poNumber,
    orders: [order],
    rawProducts: finalProducts,
    rawRowCount: rawRows,
    detected: true,
  };
}

// ── PDF Parser (text extraction) ──
async function parseJoorPDF(file: File): Promise<JoorFileParseResult> {
  // We'll parse the PDF text content on the client side
  // For now, return a placeholder — the real parsing happens via the AI enrichment edge function
  // which receives the PDF and extracts structured data
  return {
    format: "pdf_order",
    brand: extractBrandFromFilename(file.name),
    season: "",
    poNumber: "",
    orders: [],
    rawProducts: [],
  };
}

function extractBrandFromFilename(filename: string): string {
  // "ORDER_ALEMAIS-_2026-09-30_19174469.pdf" → "ALEMAIS"
  // "2026-04-09-19174469-ALEMAIS-.xlsx" → "ALEMAIS"
  const cleaned = filename.replace(/\.[^.]+$/, "");
  const parts = cleaned.split(/[-_]/);
  for (const p of parts) {
    if (p.length > 2 && !/^\d+$/.test(p) && !/^ORDER$/i.test(p)) {
      return p.trim();
    }
  }
  return "";
}

function productsToWholesaleOrder(
  products: JoorParsedProduct[],
  meta: { brand: string; season: string; poNumber: string }
): WholesaleOrder {
  const lineItems: WholesaleLineItem[] = [];

  for (const p of products) {
    if (p.sizes.length > 0) {
      for (let i = 0; i < p.sizes.length; i++) {
        lineItems.push({
          styleNumber: p.styleNumber,
          styleName: p.styleName,
          description: p.description,
          brand: meta.brand,
          productType: p.subcategory || p.category || "",
          fabrication: p.fabrication || p.materials || "",
          colour: p.colour,
          colourCode: p.colourCode,
          size: p.sizes[i],
          barcode: "",
          rrp: p.rrp,
          wholesale: p.wholesale,
          quantityOrdered: p.quantities[i] || 0,
          season: meta.season,
          collection: meta.season,
          arrivalMonth: deriveArrivalMonth(meta.season),
          imageUrl: p.imageUrl,
          sourceOrderId: meta.poNumber,
          sourcePlatform: "joor",
        });
      }
    } else {
      lineItems.push({
        styleNumber: p.styleNumber,
        styleName: p.styleName,
        description: p.description,
        brand: meta.brand,
        productType: p.subcategory || p.category || "",
        fabrication: p.fabrication || p.materials || "",
        colour: p.colour,
        colourCode: p.colourCode,
        size: "OS",
        barcode: "",
        rrp: p.rrp,
        wholesale: p.wholesale,
        quantityOrdered: p.totalUnits || 1,
        season: meta.season,
        collection: meta.season,
        arrivalMonth: deriveArrivalMonth(meta.season),
        imageUrl: p.imageUrl,
        sourceOrderId: meta.poNumber,
        sourcePlatform: "joor",
      });
    }
  }

  const total = products.reduce((s, p) => s + p.totalValue, 0);

  return {
    orderId: meta.poNumber || `JOOR-${Date.now()}`,
    platform: "joor",
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

// ── AI Enrichment ──
export async function enrichJoorProducts(
  products: JoorParsedProduct[],
  brand: string,
  accessToken: string,
  searchImages: boolean = true
): Promise<JoorParsedProduct[]> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  try {
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/joor-enrich`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ products, brand, searchImages }),
      }
    );
    if (!res.ok) throw new Error(`Enrichment failed: ${res.status}`);
    const data = await res.json();
    return data.enrichedProducts || products;
  } catch (e) {
    console.error("AI enrichment failed:", e);
    return products;
  }
}

// ── Parse PDF text (extracted from document parser) into products ──
export function parseJoorPDFText(text: string): JoorFileParseResult {
  const products: JoorParsedProduct[] = [];
  let brand = "";
  let poNumber = "";
  let season = "";

  // Extract PO number
  const poMatch = text.match(/PO#[:\s]*\**(\d+)\**/);
  if (poMatch) poNumber = poMatch[1];

  // Extract brand from heading (usually ## BRAND NAME or # BRAND)
  const brandMatch = text.match(/^#\s+([A-ZÉÈÊËÀÂÄÙÛÜÔÖÎÏÇ][A-ZÉÈÊËÀÂÄÙÛÜÔÖÎÏÇa-zéèêëàâäùûüôöîïç\s]+)/m);
  if (brandMatch) brand = brandMatch[1].trim();

  // Extract season from "FALL 26", "SS26", etc.
  const seasonMatch = text.match(/(FALL|SPRING|SS|AW|FW|RESORT|PRE-SPRING)\s*\d{2,4}/i);
  if (seasonMatch) season = seasonMatch[0];

  // Extract product blocks: "## PRODUCT NAME\nStyle #XXXX | SEASON\nWholesale: **AUD XXX** Sugg. Retail: **AUD XXX**"
  const productPattern = /##\s+([A-Z][A-Z\s]+)\n\s*Style\s+#(\w+)\s*\|\s*([^\n]+)\n[^]*?Wholesale:\s*\**AUD\s*([\d,.]+)\**\s*Sugg\.\s*Retail:\s*\**AUD\s*([\d,.]+)\**/g;
  let match;

  while ((match = productPattern.exec(text)) !== null) {
    const styleName = match[1].trim();
    const styleNumber = match[2].trim();
    const wholesale = parseFloat(match[4].replace(/,/g, "")) || 0;
    const rrp = parseFloat(match[5].replace(/,/g, "")) || 0;

    // Extract color and quantities from the table following this product
    const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 500);
    const colorMatch = afterMatch.match(/<td>([A-Z]+)\s+\1<\/td>/);
    const colour = colorMatch ? colorMatch[1] : "";

    // Extract size quantities from table cells
    const sizes: string[] = [];
    const quantities: number[] = [];
    const qtyMatch = afterMatch.match(/<td>(\d+)<\/td>/g);
    if (qtyMatch) {
      // The last two numbers are typically Qty and Total
      const nums = qtyMatch.map(m => parseInt(m.replace(/<\/?td>/g, "")));
      // Size quantities are all but the last (which is total qty)
      for (const n of nums.slice(0, -1)) {
        if (n > 0 && n < 100) {
          sizes.push(`Size${sizes.length + 1}`);
          quantities.push(n);
        }
      }
    }

    products.push({
      styleName,
      styleNumber,
      colour,
      colourCode: colour,
      fabrication: "",
      materials: "",
      category: "",
      subcategory: "",
      description: "",
      wholesale,
      rrp,
      sizes,
      quantities,
      totalUnits: quantities.reduce((a, b) => a + b, 0),
      totalValue: quantities.reduce((a, b) => a + b, 0) * wholesale,
      imageUrl: "",
    });
  }

  const order = productsToWholesaleOrder(products, { brand, season, poNumber });

  return {
    format: "pdf_order",
    brand,
    season,
    poNumber,
    orders: products.length > 0 ? [order] : [],
    rawProducts: products,
  };
}
