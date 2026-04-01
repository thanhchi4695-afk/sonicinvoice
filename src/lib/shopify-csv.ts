import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ShopifyRow {
  [key: string]: string;
}

export interface ShopifyProduct {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string[];
  status: string;
  variantRows: number[]; // indices into the raw rows array
  titleRowIndex: number; // the row that has the Title
  currentPrice: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  salePercent: number | null;
}

export interface ParsedFile {
  headers: string[];
  rows: ShopifyRow[];
  products: ShopifyProduct[];
  allTags: string[];
  allVendors: string[];
  allTypes: string[];
  totalVariants: number;
  onSaleCount: number;
  fullPriceCount: number;
}

function findCol(headers: string[], ...names: string[]): string | null {
  for (const n of names) {
    const found = headers.find((h) => h.toLowerCase().trim() === n.toLowerCase());
    if (found) return found;
  }
  return null;
}

export function parseShopifyFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    const processRows = (rawRows: ShopifyRow[]) => {
      if (!rawRows.length) return reject("No data found in file");
      const headers = Object.keys(rawRows[0]);

      const hHandle = findCol(headers, "Handle") || "Handle";
      const hTitle = findCol(headers, "Title") || "Title";
      const hVendor = findCol(headers, "Vendor") || "Vendor";
      const hType = findCol(headers, "Type") || "Type";
      const hTags = findCol(headers, "Tags") || "Tags";
      const hStatus = findCol(headers, "Status") || "Status";
      const hPrice = findCol(headers, "Variant Price") || "Variant Price";
      const hCompare = findCol(headers, "Variant Compare At Price") || "Variant Compare At Price";

      const productMap = new Map<string, ShopifyProduct>();
      const tagSet = new Set<string>();
      const vendorSet = new Set<string>();
      const typeSet = new Set<string>();

      rawRows.forEach((row, idx) => {
        const handle = (row[hHandle] || "").trim();
        if (!handle) return;

        const title = (row[hTitle] || "").trim();
        const vendor = (row[hVendor] || "").trim();
        const type = (row[hType] || "").trim();
        const tagsStr = (row[hTags] || "").trim();
        const price = parseFloat(row[hPrice] || "0") || 0;
        const compare = row[hCompare] ? parseFloat(row[hCompare]) || null : null;

        if (!productMap.has(handle)) {
          const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [];
          tags.forEach((t) => tagSet.add(t));
          if (vendor) vendorSet.add(vendor);
          if (type) typeSet.add(type);

          const isOnSale = compare !== null && compare > 0 && compare > price;
          const salePercent = isOnSale && compare ? Math.round((1 - price / compare) * 100) : null;

          productMap.set(handle, {
            handle,
            title: title || handle,
            vendor,
            type,
            tags,
            status: (row[hStatus] || "").trim(),
            variantRows: [idx],
            titleRowIndex: idx,
            currentPrice: price,
            compareAtPrice: compare,
            isOnSale,
            salePercent,
          });
        } else {
          productMap.get(handle)!.variantRows.push(idx);
        }
      });

      const products = Array.from(productMap.values());

      resolve({
        headers,
        rows: rawRows,
        products,
        allTags: Array.from(tagSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
        allVendors: Array.from(vendorSet).sort(),
        allTypes: Array.from(typeSet).sort(),
        totalVariants: rawRows.filter((r) => (r[hHandle] || "").trim()).length,
        onSaleCount: products.filter((p) => p.isOnSale).length,
        fullPriceCount: products.filter((p) => !p.isOnSale).length,
      });
    };

    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json: ShopifyRow[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
          processRows(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => processRows(result.data as ShopifyRow[]),
        error: (err) => reject(err),
      });
    }
  });
}

export type RoundingRule = "nearest_01" | "nearest_05" | "nearest_1" | "floor_95";
export type DiscountType = "percentage" | "fixed" | "exact" | "multiply";
export type Direction = "apply" | "end";

export function applyRounding(price: number, rule: RoundingRule): number {
  switch (rule) {
    case "nearest_05":
      return Math.round(price * 20) / 20;
    case "nearest_01":
      return Math.round(price * 100) / 100;
    case "nearest_1":
      return Math.round(price);
    case "floor_95": {
      const dollars = Math.floor(price);
      return price - dollars >= 0.95 ? dollars + 0.95 : dollars - 1 + 0.95;
    }
    default:
      return Math.round(price * 100) / 100;
  }
}

export interface PriceResult {
  newPrice: number;
  newCompare: number | null;
  change: string;
  status: "sale" | "restored" | "skipped" | "floor_applied";
}

export function calculateNewPrice(
  currentPrice: number,
  compareAt: number | null,
  direction: Direction,
  discountType: DiscountType,
  discountValue: number,
  rounding: RoundingRule,
  priceFloor?: number
): PriceResult {
  if (direction === "end") {
    if (compareAt && compareAt > 0) {
      return { newPrice: compareAt, newCompare: null, change: "↑ Full", status: "restored" };
    }
    return { newPrice: currentPrice, newCompare: null, change: "—", status: "skipped" };
  }

  // Apply sale
  const rrp = compareAt && compareAt > 0 ? compareAt : currentPrice;
  let raw: number;

  switch (discountType) {
    case "percentage":
      raw = rrp * (1 - discountValue / 100);
      break;
    case "fixed":
      raw = rrp - discountValue;
      break;
    case "exact":
      raw = discountValue;
      break;
    case "multiply":
      raw = rrp * discountValue;
      break;
    default:
      raw = rrp;
  }

  let newPrice = applyRounding(Math.max(raw, 0), rounding);

  let status: PriceResult["status"] = "sale";
  if (priceFloor !== undefined && priceFloor > 0 && newPrice < priceFloor) {
    newPrice = priceFloor;
    status = "floor_applied";
  }

  const pctChange = rrp > 0 ? Math.round((1 - newPrice / rrp) * 100) : 0;

  return {
    newPrice,
    newCompare: rrp,
    change: `−${pctChange}%`,
    status,
  };
}

export function updateTags(
  tags: string[],
  direction: Direction,
  removeFullPrice: boolean,
  addSaleTag: boolean,
  saleTagName: string,
  customTag: string
): string[] {
  let updated = [...tags];

  if (direction === "apply") {
    if (removeFullPrice) updated = updated.filter((t) => t.toLowerCase() !== "full_price");
    if (addSaleTag && saleTagName && !updated.some((t) => t.toLowerCase() === saleTagName.toLowerCase()))
      updated.push(saleTagName);
    if (customTag && !updated.some((t) => t.toLowerCase() === customTag.toLowerCase())) updated.push(customTag);
  } else {
    if (removeFullPrice && !updated.some((t) => t.toLowerCase() === "full_price")) updated.push("full_price");
    if (addSaleTag) updated = updated.filter((t) => t.toLowerCase() !== saleTagName.toLowerCase());
    if (customTag) updated = updated.filter((t) => t.toLowerCase() !== customTag.toLowerCase());
  }

  return updated;
}

export function generateOutputCSV(
  headers: string[],
  rows: ShopifyRow[],
  selectedHandles: Set<string>,
  direction: Direction,
  discountType: DiscountType,
  discountValue: number,
  rounding: RoundingRule,
  priceFloor: number | undefined,
  tagOpts: { removeFullPrice: boolean; addSaleTag: boolean; saleTagName: string; customTag: string }
): string {
  const hHandle = headers.find((h) => h.toLowerCase() === "handle") || "Handle";
  const hTitle = headers.find((h) => h.toLowerCase() === "title") || "Title";
  const hTags = headers.find((h) => h.toLowerCase() === "tags") || "Tags";
  const hPrice = headers.find((h) => h.toLowerCase() === "variant price") || "Variant Price";
  const hCompare =
    headers.find((h) => h.toLowerCase() === "variant compare at price") || "Variant Compare At Price";

  const updatedRows = rows.map((row) => {
    const handle = (row[hHandle] || "").trim();
    if (!handle || !selectedHandles.has(handle)) return row;

    const newRow = { ...row };
    const price = parseFloat(row[hPrice] || "0") || 0;
    const compare = row[hCompare] ? parseFloat(row[hCompare]) || null : null;

    const result = calculateNewPrice(price, compare, direction, discountType, discountValue, rounding, priceFloor);

    if (result.status !== "skipped") {
      newRow[hPrice] = result.newPrice.toFixed(2);
      newRow[hCompare] = result.newCompare !== null ? result.newCompare.toFixed(2) : "";
    }

    // Update tags only on title row
    const title = (row[hTitle] || "").trim();
    if (title && row[hTags] !== undefined) {
      const currentTags = row[hTags] ? row[hTags].split(",").map((t) => t.trim()).filter(Boolean) : [];
      const newTags = updateTags(
        currentTags,
        direction,
        tagOpts.removeFullPrice,
        tagOpts.addSaleTag,
        tagOpts.saleTagName,
        tagOpts.customTag
      );
      newRow[hTags] = newTags.join(", ");
    }

    return newRow;
  });

  return "\uFEFF" + Papa.unparse(updatedRows, { columns: headers });
}

export function generateFilename(
  vendor: string,
  tag: string,
  direction: Direction,
  discountValue: number
): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 20);

  if (direction === "end") {
    return `${clean(vendor || "products")}_fullprice_restored_${date}.csv`;
  }
  return `${clean(vendor || "products")}_sale_${Math.round(discountValue)}pct_${date}.csv`;
}
