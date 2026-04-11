/**
 * Rule-Based Invoice Extractor
 * Uses saved supplier_templates (column mappings + regex patterns) to extract
 * line items from CSV/XLSX without calling an LLM.
 */
import Papa from "papaparse";

export interface ColumnMappings {
  product_name?: string;
  sku?: string;
  barcode?: string;
  colour?: string;
  size?: string;
  quantity?: string;
  cost?: string;
  rrp?: string;
  brand?: string;
  type?: string;
}

export interface RegexPatterns {
  sku_pattern?: string;      // e.g. "^[A-Z]{2,4}-\\d{3,6}"
  price_cleanup?: string;    // e.g. "\\$|AUD|\\s" — chars to strip from prices
  size_normalize?: string;   // e.g. mapping JSON
  skip_row_pattern?: string; // rows matching this are noise
}

export interface SupplierTemplate {
  id: string;
  user_id: string;
  supplier_name: string;
  column_mappings: ColumnMappings;
  regex_patterns: RegexPatterns;
  header_row: number;
  file_type: string;
  notes: string;
  success_count: number;
  error_count: number;
}

export interface ExtractedProduct {
  name: string;
  brand: string;
  sku: string;
  barcode: string;
  type: string;
  colour: string;
  size: string;
  qty: number;
  cost: number;
  rrp: number;
}

/** Extract products from CSV text using a supplier template */
export function extractWithTemplate(
  rows: Record<string, string>[],
  template: SupplierTemplate,
): ExtractedProduct[] {
  const cm = template.column_mappings;
  const rp = template.regex_patterns;
  const skipRegex = rp.skip_row_pattern ? new RegExp(rp.skip_row_pattern, "i") : null;
  const priceCleanRegex = rp.price_cleanup ? new RegExp(rp.price_cleanup, "g") : /[$,\s]/g;

  const products: ExtractedProduct[] = [];

  for (const row of rows) {
    const getVal = (mappedCol?: string): string => {
      if (!mappedCol) return "";
      // Try exact match first, then case-insensitive
      if (row[mappedCol] !== undefined) return String(row[mappedCol]).trim();
      const key = Object.keys(row).find(k => k.toLowerCase().trim() === mappedCol.toLowerCase().trim());
      return key ? String(row[key]).trim() : "";
    };

    const name = getVal(cm.product_name);
    if (!name) continue;

    // Skip noise rows
    if (skipRegex && skipRegex.test(name)) continue;

    const rawCost = getVal(cm.cost).replace(priceCleanRegex, "");
    const rawRrp = getVal(cm.rrp).replace(priceCleanRegex, "");

    products.push({
      name,
      brand: getVal(cm.brand),
      sku: getVal(cm.sku),
      barcode: getVal(cm.barcode),
      type: getVal(cm.type),
      colour: getVal(cm.colour),
      size: getVal(cm.size) || "One Size",
      qty: parseInt(getVal(cm.quantity)) || 1,
      cost: parseFloat(rawCost) || 0,
      rrp: parseFloat(rawRrp) || 0,
    });
  }

  return products;
}

/** Parse a CSV/XLSX file into rows, respecting headerRow */
export function parseFileToRows(
  file: File,
  headerRow: number = 1,
): Promise<Record<string, string>[]> {
  return new Promise((resolve) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (ext === "csv") {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const allRows = results.data as string[][];
          if (allRows.length < headerRow) return resolve([]);
          const headers = allRows[headerRow - 1].map(h => String(h).trim());
          const dataRows = allRows.slice(headerRow);
          const mapped = dataRows
            .filter(r => r.some(cell => cell && String(cell).trim()))
            .map(r => {
              const obj: Record<string, string> = {};
              headers.forEach((h, i) => { if (h) obj[h] = String(r[i] || "").trim(); });
              return obj;
            });
          resolve(mapped);
        },
        error: () => resolve([]),
      });
    } else if (["xlsx", "xls"].includes(ext)) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(ev.target?.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // Read raw with header offset
          const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, {
            header: 1,
            defval: "",
          }) as any[][];
          if (allRows.length < headerRow) return resolve([]);
          const headers = allRows[headerRow - 1].map((h: any) => String(h).trim());
          const dataRows = allRows.slice(headerRow);
          const mapped = dataRows
            .filter((r: any[]) => r.some(cell => cell && String(cell).trim()))
            .map((r: any[]) => {
              const obj: Record<string, string> = {};
              headers.forEach((h, i) => { if (h) obj[h] = String(r[i] || "").trim(); });
              return obj;
            });
          resolve(mapped);
        } catch {
          resolve([]);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      resolve([]);
    }
  });
}

/** Auto-detect column mappings by scanning header names */
export function autoDetectMappings(headers: string[]): ColumnMappings {
  const mappings: ColumnMappings = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  const find = (candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const idx = lowerHeaders.findIndex(h => h.includes(c));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };

  mappings.product_name = find(["product", "name", "title", "description", "item"]);
  mappings.sku = find(["sku", "style", "code", "item code", "article"]);
  mappings.barcode = find(["barcode", "ean", "upc", "gtin"]);
  mappings.colour = find(["colour", "color", "col"]);
  mappings.size = find(["size", "sz"]);
  mappings.quantity = find(["qty", "quantity", "units", "ordered"]);
  mappings.cost = find(["cost", "wholesale", "unit price", "net"]);
  mappings.rrp = find(["rrp", "retail", "sell", "msrp", "price"]);
  mappings.brand = find(["brand", "vendor", "supplier", "manufacturer"]);
  mappings.type = find(["type", "category", "product type", "dept"]);

  return mappings;
}
