import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Types ──

export type FileSource = "shopify_products" | "shopify_inventory" | "joor" | "generic";

export interface InventoryVariant {
  productId: string;
  productName: string;
  brand: string;
  productType: string;
  sizeName: string;
  sizeValue: string;
  colourName: string;
  colourValue: string;
  sku: string;
  qty: number;
  price: number;
  costPrice: number;
  status: string;
}

export interface ParsedInventory {
  source: FileSource;
  variants: InventoryVariant[];
  allBrands: string[];
  allTypes: string[];
  totalProducts: number;
  totalVariants: number;
  archivedExcluded: number;
}

export interface ColumnMapping {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  option1Name: string;
  option1Value: string;
  option2Name: string;
  option2Value: string;
  sku: string;
  qty: string;
  price: string;
  costPrice: string;
  status: string;
}

// ── Source detection ──

function detectSource(headers: string[]): FileSource {
  const lower = headers.map((h) => h.toLowerCase().trim());
  if (lower.includes("handle") && lower.includes("option1 name")) return "shopify_products";
  if (lower.includes("inventory available") || (lower.includes("handle") && lower.includes("available"))) return "shopify_inventory";
  if (lower.includes("style name") || lower.includes("style number") || lower.includes("ats")) return "joor";
  return "generic";
}

function findCol(headers: string[], ...names: string[]): string {
  for (const n of names) {
    const found = headers.find((h) => h.toLowerCase().trim() === n.toLowerCase());
    if (found) return found;
  }
  return "";
}

function buildMapping(headers: string[], source: FileSource): ColumnMapping {
  if (source === "shopify_products") {
    return {
      handle: findCol(headers, "Handle"),
      title: findCol(headers, "Title"),
      vendor: findCol(headers, "Vendor"),
      type: findCol(headers, "Type", "Product Type"),
      option1Name: findCol(headers, "Option1 Name"),
      option1Value: findCol(headers, "Option1 Value"),
      option2Name: findCol(headers, "Option2 Name"),
      option2Value: findCol(headers, "Option2 Value"),
      sku: findCol(headers, "Variant SKU"),
      qty: findCol(headers, "Variant Inventory Qty"),
      price: findCol(headers, "Variant Price"),
      costPrice: findCol(headers, "Cost per item", "Variant Cost"),
      status: findCol(headers, "Status"),
    };
  }
  if (source === "shopify_inventory") {
    return {
      handle: findCol(headers, "Handle"),
      title: findCol(headers, "Title"),
      vendor: findCol(headers, "Vendor"),
      type: findCol(headers, "Type", "Product Type"),
      option1Name: findCol(headers, "Option1 Name"),
      option1Value: findCol(headers, "Option1 Value"),
      option2Name: findCol(headers, "Option2 Name"),
      option2Value: findCol(headers, "Option2 Value"),
      sku: findCol(headers, "SKU"),
      qty: findCol(headers, "Available", "Inventory Available"),
      price: findCol(headers, "Price"),
      costPrice: "",
      status: "",
    };
  }
  if (source === "joor") {
    return {
      handle: findCol(headers, "Style Number", "Style #"),
      title: findCol(headers, "Style Name", "Style"),
      vendor: findCol(headers, "Brand"),
      type: findCol(headers, "Category", "Product Type"),
      option1Name: "",
      option1Value: findCol(headers, "Size"),
      option2Name: "",
      option2Value: findCol(headers, "Colour", "Color"),
      sku: findCol(headers, "Style Number", "SKU", "Style #"),
      qty: findCol(headers, "ATS", "Available Units", "Available", "Qty"),
      price: findCol(headers, "Retail Price", "RRP"),
      costPrice: findCol(headers, "Wholesale Price", "Cost"),
      status: "",
    };
  }
  return {
    handle: "", title: "", vendor: "", type: "",
    option1Name: "", option1Value: "", option2Name: "", option2Value: "",
    sku: "", qty: "", price: "", costPrice: "", status: "",
  };
}

// ── Size vs colour detection ──

const SIZE_PATTERNS = /^(XXS|XS|S|M|L|XL|XXL|XXXL|OS|ONE SIZE|FREE SIZE|\d{1,2})$/i;

function isSizeValue(value: string): boolean {
  return SIZE_PATTERNS.test(value.trim());
}

function detectSizeColumn(
  mapping: ColumnMapping,
  rows: Record<string, string>[]
): { sizeCol: "option1Value" | "option2Value"; colourCol: "option1Value" | "option2Value" } {
  const opt1Name = rows.find((r) => r[mapping.option1Name])
    ?.[mapping.option1Name]?.toLowerCase().trim() || "";
  const opt2Name = rows.find((r) => r[mapping.option2Name])
    ?.[mapping.option2Name]?.toLowerCase().trim() || "";

  if (opt1Name.includes("size")) return { sizeCol: "option1Value", colourCol: "option2Value" };
  if (opt2Name.includes("size")) return { sizeCol: "option2Value", colourCol: "option1Value" };

  // Heuristic: check values
  const opt1Vals = rows.slice(0, 20).map((r) => r[mapping.option1Value] || "");
  const opt1SizeCount = opt1Vals.filter(isSizeValue).length;
  if (opt1SizeCount > opt1Vals.length * 0.5) return { sizeCol: "option1Value", colourCol: "option2Value" };

  return { sizeCol: "option2Value", colourCol: "option1Value" };
}

// ── Main parser ──

export function parseInventoryFile(file: File, customMapping?: Partial<ColumnMapping>): Promise<ParsedInventory> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    const processRows = (rawRows: Record<string, string>[]) => {
      if (!rawRows.length) return reject("No data found");
      const headers = Object.keys(rawRows[0]);
      const source = detectSource(headers);
      let mapping = buildMapping(headers, source);

      if (customMapping) {
        mapping = { ...mapping, ...customMapping };
      }

      // For JOOR, size/colour columns are direct
      const isJoor = source === "joor";
      let sizeValueCol = mapping.option1Value;
      let colourValueCol = mapping.option2Value;

      if (!isJoor && mapping.option1Name && mapping.option1Value) {
        const detected = detectSizeColumn(mapping, rawRows);
        sizeValueCol = mapping[detected.sizeCol];
        colourValueCol = mapping[detected.colourCol];
      }

      const brandSet = new Set<string>();
      const typeSet = new Set<string>();
      const productHandles = new Set<string>();
      let archivedExcluded = 0;

      // Track title propagation for Shopify format (title only on first row)
      const handleMeta: Record<string, { title: string; vendor: string; type: string }> = {};

      const variants: InventoryVariant[] = [];

      for (const row of rawRows) {
        const handle = (row[mapping.handle] || "").trim();
        if (!handle) continue;

        const status = (row[mapping.status] || "active").toLowerCase().trim();
        if (status === "archived" || status === "draft") {
          archivedExcluded++;
          continue;
        }

        // Track first row metadata
        const title = (row[mapping.title] || "").trim();
        const vendor = (row[mapping.vendor] || "").trim();
        const type = (row[mapping.type] || "").trim();

        if (title) {
          handleMeta[handle] = { title, vendor, type };
        }
        const meta = handleMeta[handle] || { title: handle, vendor: "", type: "" };

        if (meta.vendor) brandSet.add(meta.vendor);
        if (meta.type) typeSet.add(meta.type);
        productHandles.add(handle);

        const qty = parseInt(row[mapping.qty] || "0", 10);

        variants.push({
          productId: handle,
          productName: meta.title || handle,
          brand: meta.vendor,
          productType: meta.type,
          sizeName: isJoor ? "Size" : (row[mapping.option1Name] || "Size"),
          sizeValue: (row[sizeValueCol] || "").trim(),
          colourName: isJoor ? "Colour" : (row[mapping.option2Name] || "Colour"),
          colourValue: (row[colourValueCol] || "").trim(),
          sku: (row[mapping.sku] || "").trim(),
          qty: isNaN(qty) ? 0 : qty,
          price: parseFloat(row[mapping.price] || "0") || 0,
          costPrice: parseFloat(row[mapping.costPrice] || "0") || 0,
          status,
        });
      }

      resolve({
        source,
        variants,
        allBrands: Array.from(brandSet).sort(),
        allTypes: Array.from(typeSet).sort(),
        totalProducts: productHandles.size,
        totalVariants: variants.length,
        archivedExcluded,
      });
    };

    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
          processRows(json);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => processRows(result.data as Record<string, string>[]),
        error: (err) => reject(err),
      });
    }
  });
}
