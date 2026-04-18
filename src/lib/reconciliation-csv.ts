/**
 * Shopify CSV exporters for the Stock Reconciliation flow.
 *
 * Three formats:
 *  A) New products  — standard Shopify product import with extra "Import Type" column
 *  B) Stock update  — Matrixify/Excelify-compatible inventory adjustment (additive qty)
 *  C) New variants  — adds sizes/colours to existing products by Handle
 */

import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationLine } from "./stock-matcher";

// ── Helpers ────────────────────────────────────────────────

export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shopifyHandle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "") || "product";
}

function inferOptions(line: ReconciliationLine): {
  o1Name: string;
  o1Value: string;
  o2Name: string;
  o2Value: string;
} {
  const hasSize = !!line.invoice_size;
  const hasColour = !!line.invoice_colour;
  if (hasSize && hasColour) {
    return {
      o1Name: "Size",
      o1Value: line.invoice_size!,
      o2Name: "Colour",
      o2Value: line.invoice_colour!,
    };
  }
  if (hasSize) {
    return { o1Name: "Size", o1Value: line.invoice_size!, o2Name: "", o2Value: "" };
  }
  if (hasColour) {
    return { o1Name: "Colour", o1Value: line.invoice_colour!, o2Name: "", o2Value: "" };
  }
  return { o1Name: "Title", o1Value: "Default Title", o2Name: "", o2Value: "" };
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Catalog handle resolver ────────────────────────────────
// Look up product titles from product_catalog_cache by matched_product_id
// and derive Shopify handles. Falls back to invoice product name.

async function resolveHandlesByProductId(
  productIds: string[],
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("product_catalog_cache")
    .select("platform_product_id, product_title")
    .in("platform_product_id", ids);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data) {
    const id = row.platform_product_id as string;
    if (!map[id] && row.product_title) {
      map[id] = shopifyHandle(row.product_title as string);
    }
  }
  return map;
}

// ── Format A: New products ─────────────────────────────────

export function exportNewProductsCsv(
  lines: ReconciliationLine[],
  opts: { vendorFallback?: string } = {},
): { filename: string; rowCount: number } {
  const rows = lines.map((l) => {
    const handle = shopifyHandle(l.invoice_product_name || l.invoice_sku || "product");
    const o = inferOptions(l);
    const price = l.invoice_rrp ?? l.invoice_cost ?? 0;
    return {
      "Import Type": "NEW",
      Handle: handle,
      Title: l.invoice_product_name || handle,
      "Body (HTML)": "",
      Vendor: opts.vendorFallback || "",
      Type: "",
      Tags: "",
      Published: "TRUE",
      "Option1 Name": o.o1Name,
      "Option1 Value": o.o1Value,
      "Option2 Name": o.o2Name,
      "Option2 Value": o.o2Value,
      "Variant SKU": l.invoice_sku || "",
      "Variant Price": price ? Number(price).toFixed(2) : "",
      "Variant Compare At Price": "",
      "Cost per item": l.invoice_cost != null ? Number(l.invoice_cost).toFixed(2) : "",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Qty": String(l.invoice_qty ?? 0),
      "Variant Inventory Policy": "deny",
      "Variant Fulfillment Service": "manual",
      "Variant Requires Shipping": "TRUE",
      "Variant Taxable": "TRUE",
      "Variant Weight Unit": "kg",
      Status: "draft",
    };
  });

  const csv = Papa.unparse(rows);
  const filename = `shopify-new-products-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length };
}

// ── Format B: Inventory adjustment (additive) ──────────────

export function exportStockUpdateCsv(
  lines: ReconciliationLine[],
  opts: { locationName?: string } = {},
): { filename: string; rowCount: number } {
  const location = opts.locationName || "Main Store";
  const rows = lines.map((l) => {
    const o = inferOptions(l);
    const handle = shopifyHandle(l.invoice_product_name || l.invoice_sku || "product");
    return {
      Handle: handle,
      Title: l.invoice_product_name || "",
      "Option1 Name": o.o1Name,
      "Option1 Value": o.o1Value,
      "Option2 Name": o.o2Name,
      "Option2 Value": o.o2Value,
      "Variant SKU": l.invoice_sku || "",
      // Positive qty to ADD to existing stock — Matrixify additive mode
      "Inventory Qty": String(l.invoice_qty ?? 0),
      "Inventory Policy": "deny",
      Location: location,
    };
  });
  const csv = Papa.unparse(rows);
  const filename = `shopify-stock-update-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length };
}

// ── Format C: New variants for existing products ───────────

export async function exportNewVariantsCsv(
  lines: ReconciliationLine[],
): Promise<{ filename: string; rowCount: number; missingHandles: number }> {
  const productIds = lines
    .map((l) => l.matched_product_id)
    .filter((id): id is string => !!id);
  const handleMap = await resolveHandlesByProductId(productIds);

  let missingHandles = 0;
  const rows = lines.map((l) => {
    const o = inferOptions(l);
    const handle =
      (l.matched_product_id && handleMap[l.matched_product_id]) ||
      shopifyHandle(l.invoice_product_name || "");
    if (!handle) missingHandles++;
    return {
      Handle: handle,
      "Option1 Name": o.o1Name,
      "Option1 Value": o.o1Value,
      "Option2 Name": o.o2Name,
      "Option2 Value": o.o2Value,
      "Variant SKU": l.invoice_sku || "",
      "Variant Price": l.invoice_rrp != null ? Number(l.invoice_rrp).toFixed(2) : "",
      "Variant Cost": l.invoice_cost != null ? Number(l.invoice_cost).toFixed(2) : "",
      "Variant Inventory Qty": String(l.invoice_qty ?? 0),
    };
  });

  const csv = Papa.unparse(rows);
  const filename = `shopify-new-variants-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length, missingHandles };
}

// ── Lightspeed: catalog SKU resolver ───────────────────────
// Resolves the parent item SKU for matched products from product_catalog_cache
// (platform='lightspeed'). Falls back to invoice SKU.

async function resolveLightspeedParentSkus(
  productIds: string[],
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("product_catalog_cache")
    .select("platform_product_id, sku")
    .eq("platform", "lightspeed")
    .in("platform_product_id", ids);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data) {
    const id = row.platform_product_id as string;
    if (!map[id] && row.sku) map[id] = row.sku as string;
  }
  return map;
}

// ── Lightspeed Format A: New products ──────────────────────

export function exportLightspeedNewProductsCsv(
  lines: ReconciliationLine[],
  opts: { brandFallback?: string } = {},
): { filename: string; rowCount: number } {
  const rows = lines.map((l) => ({
    product_name: l.invoice_product_name || l.invoice_sku || "Product",
    description: "",
    brand: opts.brandFallback || "",
    sku: l.invoice_sku || "",
    price_including_tax: l.invoice_rrp != null ? Number(l.invoice_rrp).toFixed(2) : "",
    supply_price: l.invoice_cost != null ? Number(l.invoice_cost).toFixed(2) : "",
    product_type: "",
    track_inventory: "TRUE",
    initial_stock_on_hand: String(l.invoice_qty ?? 0),
    colour: l.invoice_colour || "",
    size: l.invoice_size || "",
  }));
  const csv = Papa.unparse(rows);
  const filename = `lightspeed-new-products-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length };
}

// ── Lightspeed Format B: Stock adjustment ──────────────────

export function exportLightspeedStockUpdateCsv(
  lines: ReconciliationLine[],
  opts: { locationId?: string } = {},
): { filename: string; rowCount: number } {
  const locationId = opts.locationId || "";
  const rows = lines.map((l) => ({
    sku: l.invoice_sku || "",
    adjustment_qty: String(l.invoice_qty ?? 0),
    adjustment_reason: "Purchase order received",
    location_id: locationId,
  }));
  const csv = Papa.unparse(rows);
  const filename = `lightspeed-stock-update-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length };
}

// ── Lightspeed Format C: New variants (Matrix) ─────────────

export async function exportLightspeedNewVariantsCsv(
  lines: ReconciliationLine[],
): Promise<{ filename: string; rowCount: number; missingParents: number }> {
  const productIds = lines
    .map((l) => l.matched_product_id)
    .filter((id): id is string => !!id);
  const parentMap = await resolveLightspeedParentSkus(productIds);

  let missingParents = 0;
  const rows = lines.map((l) => {
    const parentSku =
      (l.matched_product_id && parentMap[l.matched_product_id]) || "";
    if (!parentSku) missingParents++;
    return {
      parent_sku: parentSku,
      variant_sku: l.invoice_sku || "",
      colour: l.invoice_colour || "",
      size: l.invoice_size || "",
      price_including_tax:
        l.invoice_rrp != null ? Number(l.invoice_rrp).toFixed(2) : "",
      supply_price: l.invoice_cost != null ? Number(l.invoice_cost).toFixed(2) : "",
      initial_stock_on_hand: String(l.invoice_qty ?? 0),
    };
  });
  const csv = Papa.unparse(rows);
  const filename = `lightspeed-new-variants-${todayStamp()}.csv`;
  downloadCsv(filename, csv);
  return { filename, rowCount: rows.length, missingParents };
}
