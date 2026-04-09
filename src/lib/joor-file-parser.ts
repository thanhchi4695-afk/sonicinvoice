/**
 * JOOR File Parser — AI-powered detection and parsing of JOOR export files.
 * Handles 3 formats:
 *   1. XLSX Order Summary (simple) — columns: Style Name, Style Number, Color, Fabrication, sizes, Wholesale, Retail
 *   2. XLSX Full Linesheet — columns: Style Name, Style Number, Color, Fabrication, Category, Subcategory, Description, sizes, Wholesale, Retail
 *   3. PDF Order Confirmation — visual format parsed with regex from text content
 */

import * as XLSX from "xlsx";
import type { WholesaleOrder, WholesaleLineItem } from "./wholesale-mapper";
import { deriveArrivalMonth } from "./wholesale-mapper";

export interface JoorFileParseResult {
  format: "xlsx_order" | "xlsx_linesheet" | "pdf_order" | "unknown";
  brand: string;
  season: string;
  poNumber: string;
  orders: WholesaleOrder[];
  rawProducts: JoorParsedProduct[];
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
  description: string;
  wholesale: number;
  rrp: number;
  sizes: string[];
  quantities: number[];
  totalUnits: number;
  totalValue: number;
  imageUrl: string;
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
  const colorIdx = colAny("Color", "Colour");
  const colorCodeIdx = colAny("Color Code", "Colour Code");
  const fabricIdx = colAny("Fabrication", "Fab. Code");
  const materialsIdx = col("Materials");
  const categoryIdx = col("Category");
  const subcategoryIdx = col("Subcategory");
  const descriptionIdx = col("Description");
  const wholesaleIdx = colAny("Wholesale (AUD)", "WholeSale (AUD)", "Wholesale");
  const retailIdx = colAny("Sugg. Retail (AUD)", "Sugg. Retail", "Retail");
  const unitsIdx = col("Units");

  // Detect size columns (between last metadata col and Wholesale col)
  const sizeColumns: { idx: number; label: string }[] = [];
  const sizePattern = /^\d+\s*(AU|US|UK)|^OS$|^XXS$|^XS$|^S$|^M$|^L$|^XL$|^XXL$/i;
  for (let j = 0; j < headers.length; j++) {
    if (sizePattern.test(headers[j]) || headers[j].match(/^\d+\s+AU\/UK/)) {
      sizeColumns.push({ idx: j, label: headers[j] });
    }
  }

  // Parse product rows
  const products: JoorParsedProduct[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const styleName = String(row[styleNameIdx] || "").trim();
    const styleNum = String(row[styleNumIdx] || "").trim();
    if (!styleName && !styleNum) continue;

    const wholesale = parseFloat(String(row[wholesaleIdx] || "0").replace(/[,$]/g, "")) || 0;
    const rrp = parseFloat(String(row[retailIdx] || "0").replace(/[,$]/g, "")) || 0;
    if (wholesale === 0 && rrp === 0) continue;

    // Extract sizes and quantities
    const sizes: string[] = [];
    const quantities: number[] = [];
    for (const sc of sizeColumns) {
      const qty = parseInt(String(row[sc.idx] || "0")) || 0;
      if (qty > 0) {
        // Clean size label: "8 AU/UK (4 US)" → "8"
        const sizeLabel = sc.label.match(/^(\d+|OS|XXS|XS|S|M|L|XL|XXL)/i)?.[1] || sc.label;
        sizes.push(sizeLabel);
        quantities.push(qty);
      }
    }

    const totalUnits = unitsIdx >= 0
      ? (parseInt(String(row[unitsIdx] || "0")) || quantities.reduce((a, b) => a + b, 0))
      : quantities.reduce((a, b) => a + b, 0);

    // Try to detect brand from style name or first row
    if (!brand && styleName) {
      // Brand is usually from PO metadata, try to detect from file name
      const fileMatch = file.name.match(/\d+-([A-Z][A-Za-z\s]+)-/);
      if (fileMatch) brand = fileMatch[1].trim();
    }

    products.push({
      styleName,
      styleNumber: styleNum,
      colour: String(row[colorIdx] || "").trim(),
      colourCode: String(row[colorCodeIdx] || "").trim(),
      fabrication: String(row[fabricIdx] || "").trim(),
      materials: materialsIdx >= 0 ? String(row[materialsIdx] || "").trim() : "",
      category: categoryIdx >= 0 ? String(row[categoryIdx] || "").trim() : "",
      subcategory: subcategoryIdx >= 0 ? String(row[subcategoryIdx] || "").trim() : "",
      description: descriptionIdx >= 0 ? String(row[descriptionIdx] || "").trim() : "",
      wholesale,
      rrp,
      sizes,
      quantities,
      totalUnits,
      totalValue: totalUnits * wholesale,
      imageUrl: "",
    });
  }

  // Detect brand from filename if not found
  if (!brand) {
    const parts = file.name.replace(/\.[^.]+$/, "").split(/[-_]/);
    for (const p of parts) {
      if (p.length > 2 && !/^\d+$/.test(p)) {
        brand = p.trim().replace(/\s+/g, " ");
        break;
      }
    }
  }

  // Convert to WholesaleOrder
  const order = productsToWholesaleOrder(products, { brand, season, poNumber });

  return {
    format: isLinesheet ? "xlsx_linesheet" : "xlsx_order",
    brand,
    season,
    poNumber,
    orders: [order],
    rawProducts: products,
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
  accessToken: string
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
        body: JSON.stringify({ products, brand }),
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
