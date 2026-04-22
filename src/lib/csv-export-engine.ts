/**
 * Production-grade Shopify CSV export engine.
 * Handles variant structure, validation, title dedup, metafields, and safety checks.
 */

import Papa from "papaparse";
import { matchCollectionsWithBrand } from "./collection-engine";
import { getPublishStatus, shopifyStatusValue } from "./publish-status";
import { expandLineBySize } from "./size-run-expander";

// ── Types ──────────────────────────────────────────────────

export interface ExportLine {
  name: string;
  brand: string;
  type: string;
  colour?: string;
  size?: string;
  sku?: string;
  barcode?: string;
  price: number;
  rrp: number;
  /** Per-unit wholesale cost (supply_price). Surfaced from the invoice. */
  cogs?: number;
  /** On-hand quantity for this variant. Surfaced from the invoice line. */
  qty?: number;
  status: string;
  hasImage?: boolean;
  imageUrl?: string;
  hasSeo?: boolean;
  hasTags?: boolean;
  tags?: string;
  seoTitle?: string;
  seoDesc?: string;
  bodyHtml?: string;
  metafields?: Record<string, string>;
}

export type VariantMode = "simple" | "variant";

export interface ValidationIssue {
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

// ── Handle Generation ──────────────────────────────────────

export function generateHandle(title: string, brand: string): string {
  const raw = `${title}`.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return raw || brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "product";
}

// ── Title Deduplication ────────────────────────────────────

export function deduplicateTitle(name: string, vendor: string): string {
  if (!vendor || !name) return name;
  const vendorLower = vendor.toLowerCase().trim();
  const nameLower = name.toLowerCase().trim();
  
  // Check if title starts with vendor name duplicated: "Brand Brand Product"
  const doubleVendor = `${vendorLower} ${vendorLower}`;
  if (nameLower.startsWith(doubleVendor)) {
    return vendor + name.slice(vendor.length + 1 + vendor.length);
  }
  
  // Build full title: "Brand Name" — check if Name already starts with Brand
  const fullTitle = `${vendor} ${name}`;
  const fullLower = fullTitle.toLowerCase();
  const doublePrefixCheck = `${vendorLower} ${vendorLower}`;
  if (fullLower.startsWith(doublePrefixCheck)) {
    // "Brand" + " " + "Brand Something" => just use name as-is (it already has brand)
    return name;
  }

  return fullTitle;
}

// ── Variant Grouping ───────────────────────────────────────

interface GroupedProduct {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string;
  bodyHtml: string;
  seoTitle: string;
  seoDesc: string;
  imageUrl: string;
  status: string;
  metafields: Record<string, string>;
  /** #6 Collection assignment — derived from tags + brand via matchCollectionsWithBrand. */
  collections: string[];
  variants: {
    option1Name: string;
    option1Value: string;
    option2Name?: string;
    option2Value?: string;
    price: string;
    compareAtPrice: string;
    sku: string;
    barcode: string;
    cogs?: string;
    qty: string;
  }[];
}

/** #6 Collection assignment helper — splits a "Tag, Tag" string and derives collections. */
function deriveCollections(tagsStr: string, brand: string): string[] {
  const tagList = (tagsStr || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return matchCollectionsWithBrand(tagList, brand || "");
}

function normalizeBaseTitle(name: string): string {
  return name
    .replace(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|\d{1,3})\b/gi, "")
    .replace(/\b(Black|White|Navy|Red|Blue|Green|Pink|Coral|Ivory|Khaki|Grey|Gray|Cream|Beige|Tan|Brown|Purple|Yellow|Orange|Aqua|Teal|Sage|Olive|Rust|Blush|Lilac|Charcoal|Bone|Sand|Wine|Burgundy|Mauve|Mint|Rose|Stone|Nude|Taupe|Champagne)\b/gi, "")
    .replace(/[·\-,|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupProducts(rawLines: ExportLine[], mode: VariantMode): GroupedProduct[] {
  // Expand any size-run rows ("8-16", "S-L") into one row per individual size.
  // Quantity is split evenly across the run; SKU is suffixed with the size.
  const lines: ExportLine[] = rawLines.flatMap((ln) => expandLineBySize(ln));

  if (mode === "simple") {
    return lines.map(ln => {
      const title = deduplicateTitle(ln.name, ln.brand);
      return {
        handle: generateHandle(title, ln.brand),
        title,
        vendor: ln.brand,
        type: ln.type,
        tags: ln.tags || `${ln.brand}, ${ln.type}, New Arrival`,
        bodyHtml: ln.bodyHtml || `<p>${ln.name} by ${ln.brand}. Premium ${ln.type.toLowerCase()}.</p>`,
        seoTitle: ln.seoTitle || `${ln.name} | ${ln.brand}`.slice(0, 70),
        seoDesc: ln.seoDesc || `Shop ${ln.name} by ${ln.brand}. Premium ${ln.type.toLowerCase()}.`.slice(0, 160),
        imageUrl: ln.imageUrl || "",
        status: ln.status === "active" ? "active" : "draft",
        metafields: ln.metafields || {},
        collections: deriveCollections(ln.tags || `${ln.brand}, ${ln.type}, New Arrival`, ln.brand),
        variants: [{
          option1Name: "Title",
          option1Value: "Default Title",
          price: ln.rrp.toFixed(2),
          // Compare-at-price stays blank for new products — only used later when a sale is applied.
          // (Previously we set it = RRP whenever price < rrp, which caused new items to look discounted.)
          compareAtPrice: "",
          sku: ln.sku || "",
          barcode: ln.barcode || "",
          cogs: ln.cogs?.toFixed(2),
          qty: String(ln.qty ?? 0),
        }],
      };
    });
  }

  // Variant mode: group by normalized base title + vendor + type
  const groups = new Map<string, { base: ExportLine; lines: ExportLine[] }>();

  for (const ln of lines) {
    const baseTitle = normalizeBaseTitle(ln.name);
    const key = `${ln.brand}::${baseTitle}::${ln.type}`.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { base: ln, lines: [ln] });
    } else {
      groups.get(key)!.lines.push(ln);
    }
  }

  return Array.from(groups.values()).map(({ base, lines: groupLines }) => {
    const title = deduplicateTitle(base.name.replace(/\b(XXS|XS|S|M|L|XL|XXL|\d{1,3})\b/gi, "").trim() || base.name, base.brand);
    const hasSize = groupLines.some(l => l.size);
    const hasColour = groupLines.some(l => l.colour);
    const isMultiVariant = groupLines.length > 1 || hasSize || hasColour;

    if (!isMultiVariant) {
      return {
        handle: generateHandle(title, base.brand),
        title,
        vendor: base.brand,
        type: base.type,
        tags: base.tags || `${base.brand}, ${base.type}, New Arrival`,
        bodyHtml: base.bodyHtml || `<p>${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.</p>`,
        seoTitle: base.seoTitle || `${base.name} | ${base.brand}`.slice(0, 70),
        seoDesc: base.seoDesc || `Shop ${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.`.slice(0, 160),
        imageUrl: base.imageUrl || "",
        status: base.status === "active" ? "active" : "draft",
        metafields: base.metafields || {},
        collections: deriveCollections(base.tags || `${base.brand}, ${base.type}, New Arrival`, base.brand),
        variants: [{
          option1Name: "Title",
          option1Value: "Default Title",
          price: base.rrp.toFixed(2),
          // Compare-at-price stays blank by default (set only when applying a markdown/sale).
          compareAtPrice: "",
          sku: base.sku || "",
          barcode: base.barcode || "",
          cogs: base.cogs?.toFixed(2),
          qty: String(base.qty ?? 0),
        }],
      };
    }

    const handle = generateHandle(title, base.brand);
    // Convention: Colour first, Size second — matches Shopify admin UI display order
    const option1Name = hasColour ? "Colour" : hasSize ? "Size" : "Title";
    const option2Name = hasColour && hasSize ? "Size" : undefined;

    const variants = groupLines.map(ln => ({
      option1Name,
      option1Value: hasColour ? (ln.colour || "Default") : hasSize ? (ln.size || "One Size") : "Default Title",
      option2Name,
      option2Value: option2Name ? (ln.size || "One Size") : undefined,
      price: ln.rrp.toFixed(2),
      // Compare-at-price stays blank by default (set only when applying a markdown/sale).
      compareAtPrice: "",
      sku: ln.sku || "",
      barcode: ln.barcode || "",
      cogs: ln.cogs?.toFixed(2),
      qty: String(ln.qty ?? 0),
    }));

    return {
      handle,
      title,
      vendor: base.brand,
      type: base.type,
      tags: base.tags || `${base.brand}, ${base.type}, New Arrival`,
      bodyHtml: base.bodyHtml || `<p>${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.</p>`,
      seoTitle: base.seoTitle || `${base.name} | ${base.brand}`.slice(0, 70),
      seoDesc: base.seoDesc || `Shop ${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.`.slice(0, 160),
      imageUrl: base.imageUrl || "",
      status: base.status === "active" ? "active" : "draft",
      metafields: base.metafields || {},
      collections: deriveCollections(base.tags || `${base.brand}, ${base.type}, New Arrival`, base.brand),
      variants,
    };
  });
}

// ── Validation ─────────────────────────────────────────────

export function validateExport(products: GroupedProduct[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  let rowIdx = 0;
  const handleStructure = new Map<string, { option1Name: string }>();

  for (const prod of products) {
    rowIdx++;

    if (!prod.handle) {
      issues.push({ row: rowIdx, field: "Handle", message: "Handle is empty", severity: "error", suggestion: "Auto-generate from title" });
    }

    if (!prod.title) {
      issues.push({ row: rowIdx, field: "Title", message: "Title is empty", severity: "error", suggestion: "Add a product title" });
    }

    for (let vi = 0; vi < prod.variants.length; vi++) {
      const v = prod.variants[vi];
      const price = parseFloat(v.price);

      if (isNaN(price) || price < 0) {
        issues.push({ row: rowIdx, field: "Variant Price", message: `Invalid price "${v.price}" on variant ${vi + 1}`, severity: "error", suggestion: "Set a valid numeric price" });
      }

      if (!v.option1Value) {
        issues.push({ row: rowIdx, field: "Option1 Value", message: `Empty Option1 Value on variant ${vi + 1}`, severity: "error", suggestion: "Set to 'Default Title' for simple products" });
      }

      // Check inconsistent option structure for same handle
      if (prod.handle) {
        const existing = handleStructure.get(prod.handle);
        if (existing) {
          if (existing.option1Name !== v.option1Name) {
            issues.push({
              row: rowIdx, field: "Option1 Name",
              message: `Inconsistent option structure for handle "${prod.handle}"`,
              severity: "error",
              suggestion: `All variants must use the same Option1 Name (found "${existing.option1Name}" and "${v.option1Name}")`
            });
          }
        } else {
          handleStructure.set(prod.handle, { option1Name: v.option1Name });
        }
      }
    }

    // Check for metafield format issues
    if (prod.metafields) {
      for (const [key, val] of Object.entries(prod.metafields)) {
        if (val && !key.includes(".")) {
          issues.push({ row: rowIdx, field: `Metafield: ${key}`, message: `Invalid metafield key "${key}" — must be namespace.key format`, severity: "warning", suggestion: "Use format: custom.field_name" });
        }
      }
    }
  }

  const errorCount = issues.filter(i => i.severity === "error").length;
  return {
    valid: errorCount === 0,
    issues,
    errorCount,
    warningCount: issues.filter(i => i.severity === "warning").length,
  };
}

// ── CSV Generation ─────────────────────────────────────────

export function generateShopifyCSV(
  lines: ExportLine[],
  mode: VariantMode,
  enabledMetaColumns: { key: string; shopifyColumn: string }[]
): { csv: string; validation: ValidationResult; rowCount: number } {
  const grouped = groupProducts(lines, mode);
  const validation = validateExport(grouped);
  const defaultStatus = shopifyStatusValue(getPublishStatus());

  // Build rows
  const rows: Record<string, string>[] = [];

  for (const prod of grouped) {
    prod.variants.forEach((v, vi) => {
      const isFirstRow = vi === 0;
      const row: Record<string, string> = {
        Handle: prod.handle,
        Title: isFirstRow ? prod.title : "",
        "Body (HTML)": isFirstRow ? prod.bodyHtml : "",
        Vendor: isFirstRow ? prod.vendor : "",
        Type: isFirstRow ? prod.type : "",
        Tags: isFirstRow ? prod.tags : "",
        Published: isFirstRow ? "TRUE" : "",
        "Option1 Name": v.option1Name,
        "Option1 Value": v.option1Value,
        ...(v.option2Name ? {
          "Option2 Name": v.option2Name,
          "Option2 Value": v.option2Value || "",
        } : {
          "Option2 Name": "",
          "Option2 Value": "",
        }),
        "Variant SKU": v.sku,
        "Variant Barcode": v.barcode,
        "Variant Price": v.price,
        "Variant Compare At Price": v.compareAtPrice,
        "Variant Inventory Policy": "deny",
        "Variant Inventory Qty": "1",
        "Variant Fulfillment Service": "manual",
        "Variant Requires Shipping": "TRUE",
        "Variant Taxable": "TRUE",
        "Variant Weight Unit": "kg",
        "Image Src": isFirstRow ? prod.imageUrl : "",
        Status: isFirstRow ? defaultStatus : "",
        "SEO Title": isFirstRow ? prod.seoTitle : "",
        "SEO Description": isFirstRow ? prod.seoDesc : "",
        // #6 Collection assignment — comma-joined list, used by importers/Shopify push.
        Collection: isFirstRow ? prod.collections.join(", ") : "",
        ...(v.cogs ? { "Cost per item": v.cogs } : {}),
      };

      // Add metafield columns on first row
      if (isFirstRow) {
        for (const mf of enabledMetaColumns) {
          row[mf.shopifyColumn] = prod.metafields[mf.key] || "";
        }
      } else {
        for (const mf of enabledMetaColumns) {
          row[mf.shopifyColumn] = "";
        }
      }

      rows.push(row);
    });
  }

  // Build column order
  const baseColumns = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
    "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
    "Variant SKU", "Variant Barcode", "Variant Price", "Variant Compare At Price",
    "Variant Inventory Policy", "Variant Inventory Qty", "Variant Fulfillment Service",
    "Variant Requires Shipping", "Variant Taxable", "Variant Weight Unit",
    "Image Src", "Status", "SEO Title", "SEO Description",
  ];

  // #6 Only include Collection column if at least one product has assignments
  if (rows.some((r) => r.Collection?.trim())) {
    baseColumns.push("Collection");
  }

  // Only include Cost if any row has it
  if (rows.some(r => r["Cost per item"])) {
    baseColumns.push("Cost per item");
  }

  // Only include metafield columns that have data
  const metaCols = enabledMetaColumns
    .filter(mf => rows.some(r => r[mf.shopifyColumn]?.trim()))
    .map(mf => mf.shopifyColumn);

  const columns = [...baseColumns, ...metaCols];
  const csv = "\uFEFF" + Papa.unparse(rows, { columns });

  return { csv, validation, rowCount: rows.length };
}

// ── Storage for variant mode preference ────────────────────

const VARIANT_MODE_KEY = "sonic_invoice_variant_mode";

export function getVariantMode(): VariantMode {
  return (localStorage.getItem(VARIANT_MODE_KEY) as VariantMode) || "simple";
}

export function setVariantMode(mode: VariantMode): void {
  localStorage.setItem(VARIANT_MODE_KEY, mode);
}
