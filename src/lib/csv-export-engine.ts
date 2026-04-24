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
  /** ISO date — drives the arrival-month tag (Apr26, Sept26). */
  invoiceDate?: string;
  /** Season string parsed from SKU/style (e.g. "W26", "S26"). */
  season?: string;
}

// ── W-07 Tag helpers ───────────────────────────────────────
// Builds the tag list per Walnut batch spec:
//   Brand, Department, ProductType, ArrivalMonth, Season, Colour
// Drops the meaningless "General" / "New Arrival" placeholders.

const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function arrivalMonthFromDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const safe = isNaN(d.getTime()) ? new Date() : d;
  return `${MONTHS_ABBR[safe.getMonth()]}${String(safe.getFullYear()).slice(-2)}`;
}

function departmentForLine(line: Pick<ExportLine, "type" | "size">): string {
  const tt = (line.type || "").toLowerCase();
  const size = (line.size || "").toLowerCase();
  const isKids = /year|yr|month|months|\d+y|\d+m/.test(size);
  if (isKids && /shoe|sandal|boot|sneaker/.test(tt)) return "kids shoes";
  if (isKids) return "kids clothing";
  if (/dress|top|pant|skirt|short|shirt|jumpsuit|playsuit|kimono|kaftan|sarong|blouse|tee/.test(tt)) return "womens clothing";
  if (/swim|bikini|tankini|rashie|board/.test(tt)) return "swimwear";
  if (/jewel|earring|necklace|bracelet|ring/.test(tt)) return "jewellery";
  if (/hat|sunnies|bag|towel|accessor|wallet|belt|scarf/.test(tt)) return "accessories";
  if (/shoe|sandal|boot|sneaker/.test(tt)) return "footwear";
  return "";
}

/** Parse season token (e.g. "W26", "S26", "SS26", "AW26") from a SKU's middle segment. */
function seasonFromSku(sku?: string): string {
  if (!sku) return "";
  const parts = sku.split(/[-_/]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^(SS|AW|S|W|FW|HO|RE|HS|MS|LS)\d{2}$/i.test(part)) return part.toUpperCase();
  }
  return "";
}

/** Build the rich tag string. Used by both Shopify and Lightspeed exports. */
export function buildRichTags(ln: ExportLine): string {
  const tags: string[] = [];
  const brand = (ln.brand || "").trim();
  if (brand) tags.push(brand);
  const dept = departmentForLine(ln);
  if (dept) tags.push(dept);
  const type = (ln.type || "").trim().toLowerCase();
  if (type) tags.push(type);
  tags.push(arrivalMonthFromDate(ln.invoiceDate));
  const season = (ln.season || seasonFromSku(ln.sku) || "").trim();
  if (season) tags.push(season);
  const colour = (ln.colour || "").trim();
  if (colour) tags.push(colour);
  if (/year|yr|month|months|\d+y|\d+m/i.test(ln.size || "")) tags.push("kids");
  // Dedupe (case-insensitive), preserve order
  const seen = new Set<string>();
  return tags
    .filter((t) => {
      const k = t.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
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
        tags: buildRichTags(ln) || ln.tags || `${ln.brand}, ${ln.type}`,
        bodyHtml: ln.bodyHtml || `<p>${ln.name} by ${ln.brand}. Premium ${ln.type.toLowerCase()}.</p>`,
        seoTitle: ln.seoTitle || `${ln.name} | ${ln.brand}`.slice(0, 70),
        seoDesc: ln.seoDesc || `Shop ${ln.name} by ${ln.brand}. Premium ${ln.type.toLowerCase()}.`.slice(0, 160),
        imageUrl: ln.imageUrl || "",
        status: ln.status === "active" ? "active" : "draft",
        metafields: ln.metafields || {},
        collections: deriveCollections(buildRichTags(ln) || ln.tags || `${ln.brand}, ${ln.type}`, ln.brand),
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
        tags: buildRichTags(base) || base.tags || `${base.brand}, ${base.type}`,
        bodyHtml: base.bodyHtml || `<p>${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.</p>`,
        seoTitle: base.seoTitle || `${base.name} | ${base.brand}`.slice(0, 70),
        seoDesc: base.seoDesc || `Shop ${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.`.slice(0, 160),
        imageUrl: base.imageUrl || "",
        status: base.status === "active" ? "active" : "draft",
        metafields: base.metafields || {},
        collections: deriveCollections(buildRichTags(base) || base.tags || `${base.brand}, ${base.type}`, base.brand),
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
      tags: buildRichTags(base) || base.tags || `${base.brand}, ${base.type}`,
      bodyHtml: base.bodyHtml || `<p>${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.</p>`,
      seoTitle: base.seoTitle || `${base.name} | ${base.brand}`.slice(0, 70),
      seoDesc: base.seoDesc || `Shop ${base.name} by ${base.brand}. Premium ${base.type.toLowerCase()}.`.slice(0, 160),
      imageUrl: base.imageUrl || "",
      status: base.status === "active" ? "active" : "draft",
      metafields: base.metafields || {},
      collections: deriveCollections(buildRichTags(base) || base.tags || `${base.brand}, ${base.type}`, base.brand),
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
        "Option3 Name": "",
        "Option3 Value": "",
        "Variant SKU": v.sku,
        "Variant Grams": "",
        "Variant Barcode": v.barcode,
        "Variant Price": v.price,
        "Variant Compare At Price": v.compareAtPrice,
        "Variant Inventory Policy": "deny",
        "Variant Inventory Tracker": "shopify",
        "Variant Inventory Qty": v.qty || "0",
        "Variant Fulfillment Service": "manual",
        "Variant Requires Shipping": "TRUE",
        "Variant Taxable": "TRUE",
        "Variant Weight Unit": "kg",
        "Image Src": isFirstRow ? prod.imageUrl : "",
        Status: isFirstRow ? defaultStatus : "",
        "SEO Title": isFirstRow ? prod.seoTitle : "",
        "SEO Description": isFirstRow ? prod.seoDesc : "",
        Collection: isFirstRow ? prod.collections.join(", ") : "",
        ...(v.cogs ? { "Cost per item": v.cogs } : {}),
      };

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

  const baseColumns = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
    "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
    "Option3 Name", "Option3 Value",
    "Variant SKU", "Variant Grams", "Variant Barcode", "Variant Price", "Variant Compare At Price",
    "Variant Inventory Tracker", "Variant Inventory Policy", "Variant Inventory Qty",
    "Variant Fulfillment Service",
    "Variant Requires Shipping", "Variant Taxable", "Variant Weight Unit",
    "Image Src", "Status", "SEO Title", "SEO Description",
  ];

  if (rows.some((r) => r.Collection?.trim())) {
    baseColumns.push("Collection");
  }

  if (rows.some(r => r["Cost per item"])) {
    baseColumns.push("Cost per item");
  }

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

// ── Lightspeed (X-Series) CSV exporter ─────────────────────
//
// Maps the same ExportLine[] into the Lightspeed product-export-12
// schema (18 columns) — the format Lightspeed actually emits when
// you export from the X-Series catalogue. Every column is populated
// on every row (no "first row only" convention), so brand and
// supplier_code are propagated to every variant.
//
// Reference column order (matches Lightspeed's own export):
//   handle, name, sku, supplier_code, description, brand,
//   supply_price, retail_price, tax, active, tags,
//   attribute_1_name, attribute_1_value,
//   attribute_2_name, attribute_2_value,
//   attribute_3_name, attribute_3_value,
//   <STORE>_stock

export function generateLightspeedCSV(
  rawLines: ExportLine[],
  opts?: { taxName?: string; outletName?: string }
): { csv: string; rowCount: number } {
  const taxName = opts?.taxName ?? "Default Tax";
  const outlet = opts?.outletName ?? "Main Outlet";
  const outletKey = outlet.replace(/\s+/g, "_");
  const stockCol = `inventory_${outletKey}`;
  const reorderPointCol = `reorder_point_${outletKey}`;
  const restockLevelCol = `restock_level_${outletKey}`;

  // Expand size runs the same way the Shopify path does.
  const lines: ExportLine[] = rawLines.flatMap((ln) => expandLineBySize(ln));

  // Column order MIRRORS the official Lightspeed X-Series product-export template exactly.
  const headers = [
    "id",
    "handle",
    "sku",
    "composite_name",
    "composite_sku",
    "composite_quantity",
    "name",
    "description",
    "product_category",
    "variant_option_one_name",
    "variant_option_one_value",
    "variant_option_two_name",
    "variant_option_two_value",
    "variant_option_three_name",
    "variant_option_three_value",
    "tags",
    "supply_price",
    "retail_price",
    "loyalty_value",
    "loyalty_value_default",
    "tax_name",
    "tax_value",
    "account_code",
    "account_code_purchase",
    "brand_name",
    "supplier_name",
    "supplier_code",
    "active",
    "track_inventory",
    stockCol,
    reorderPointCol,
    restockLevelCol,
  ];

  const rows = lines.map((ln) => {
    const title = deduplicateTitle(ln.name, ln.brand);
    const handle = generateHandle(title, ln.brand);
    // W-07 — rich tags: Brand, Department, Type, ArrivalMonth, Season, Colour.
    // Always recompute so we don't inherit primitive upstream tags like
    // "[brand, type, colour, New Arrival]". `ln.tags` is preserved only as a
    // fallback when the rich builder produces nothing (no brand/type/date).
    const richTags = buildRichTags(ln);
    const tags = richTags || ln.tags || "";

    // Convention: Colour first, Size second (matches Shopify export + Sonic memory)
    const opt1Name = ln.colour ? "Colour" : ln.size ? "Size" : "";
    const opt1Value = ln.colour || ln.size || "";
    const opt2Name = ln.colour && ln.size ? "Size" : "";
    const opt2Value = ln.colour && ln.size ? (ln.size || "") : "";

    // Lightspeed SKU rules: only letters, numbers, ".", "-", "_", "/" — strip everything else (incl. spaces).
    const cleanSku = (ln.sku || "").replace(/[^a-zA-Z0-9._\-/]/g, "");
    // Supply Price must be numeric (blank = import error). Fall back to retail price if cogs missing.
    const supplyPrice = ln.cogs != null && ln.cogs >= 0
      ? ln.cogs.toFixed(2)
      : (ln.rrp != null ? ln.rrp.toFixed(2) : "0.00");
    // active must be 0 or 1 — Lightspeed rejects TRUE/FALSE strings.
    const activeFlag = ln.status === "active" ? "1" : "0";

    // Description: prefer rich bodyHtml; strip HTML tags so Lightspeed gets
    // clean prose (the storefront renders plain text in product detail pages).
    const descriptionText = (ln.bodyHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      id: "", // blank → Lightspeed creates new product on import
      handle,
      sku: cleanSku,
      composite_name: "",
      composite_sku: "",
      composite_quantity: "",
      name: title,
      description: descriptionText,
      product_category: ln.type || "",
      variant_option_one_name: opt1Name,
      variant_option_one_value: opt1Value,
      variant_option_two_name: opt2Name,
      variant_option_two_value: opt2Value,
      variant_option_three_name: "",
      variant_option_three_value: "",
      tags,
      supply_price: supplyPrice,
      retail_price: ln.rrp.toFixed(2),
      loyalty_value: "",
      loyalty_value_default: "",
      tax_name: taxName,
      tax_value: "",
      account_code: "",
      account_code_purchase: "",
      brand_name: ln.brand || "",
      supplier_name: ln.brand || "",
      supplier_code: "",
      active: activeFlag,
      track_inventory: "1",
      [stockCol]: String(ln.qty ?? 0),
      [reorderPointCol]: "",
      [restockLevelCol]: "",
    } as Record<string, string>;
  });

  const csv = "\uFEFF" + Papa.unparse(rows, { columns: headers });
  return { csv, rowCount: rows.length };
}

