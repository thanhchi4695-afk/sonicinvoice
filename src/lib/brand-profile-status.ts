// ──────────────────────────────────────────────────────────────
// Brand profile status helpers.
//
// `brand_profiles.profile_status` controls how the parser/UI may
// use a supplier profile during invoice processing:
//
//   active           → normal: extract + book costs
//   needs_enrichment → extract OK, but flag before publishing
//   do_not_book      → extract only, BLOCK Save to Catalog/Export
//
// This module centralises the lookup and the user-visible copy
// so every screen (PostParseReview, SupplierBrainTab, etc.)
// shows the same warning text.
// ──────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";

export type ProfileStatus = "active" | "needs_enrichment" | "do_not_book";

export interface BrandProfileStatusInfo {
  supplier_key: string;
  supplier_name: string;
  profile_status: ProfileStatus;
}

/** Per-supplier override copy for `do_not_book` profiles. */
const DO_NOT_BOOK_DETAIL: Record<string, string> = {
  tooletries: "Tooletries: Order Confirmation only, find the matching tax invoice.",
  wacoal: "Wacoal: packing list only, find the matching tax invoice.",
};

const GENERIC_DO_NOT_BOOK_DETAIL =
  "This document type cannot be used for cost booking. Find the matching tax invoice.";

const GENERIC_NEEDS_ENRICHMENT_DETAIL =
  "profile is incomplete — review before publishing to Shopify.";

export function buildDoNotBookMessage(info: BrandProfileStatusInfo): string {
  const detail =
    DO_NOT_BOOK_DETAIL[info.supplier_key.toLowerCase()] ||
    `${info.supplier_name}: ${GENERIC_DO_NOT_BOOK_DETAIL}`;
  return `⚠️ ${info.supplier_name} — this document type cannot be used for cost booking. ${detail}`;
}

export function buildNeedsEnrichmentMessage(info: BrandProfileStatusInfo): string {
  return `🔔 ${info.supplier_name} ${GENERIC_NEEDS_ENRICHMENT_DETAIL}`;
}

function normaliseKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Look up the brand_profile for a supplier name. Tries (in order):
 *   1. supplier_key exact match (after normalising spaces → dashes)
 *   2. supplier_name case-insensitive match
 *   3. shopify_vendor case-insensitive match
 * Returns null if no profile is found (caller should treat as `active`).
 */
export async function fetchBrandProfileStatus(
  supplierName: string | null | undefined,
): Promise<BrandProfileStatusInfo | null> {
  if (!supplierName) return null;
  const trimmed = supplierName.trim();
  if (!trimmed) return null;

  const key = normaliseKey(trimmed);

  // 1) supplier_key
  const { data: byKey } = await supabase
    .from("brand_profiles")
    .select("supplier_key, supplier_name, profile_status")
    .eq("supplier_key", key)
    .maybeSingle();
  if (byKey) return byKey as BrandProfileStatusInfo;

  // 2) supplier_name ilike
  const { data: byName } = await supabase
    .from("brand_profiles")
    .select("supplier_key, supplier_name, profile_status")
    .ilike("supplier_name", trimmed)
    .limit(1)
    .maybeSingle();
  if (byName) return byName as BrandProfileStatusInfo;

  // 3) shopify_vendor ilike
  const { data: byVendor } = await supabase
    .from("brand_profiles")
    .select("supplier_key, supplier_name, profile_status")
    .ilike("shopify_vendor", trimmed)
    .limit(1)
    .maybeSingle();
  if (byVendor) return byVendor as BrandProfileStatusInfo;

  return null;
}

export function statusBadgeClasses(status: ProfileStatus): string {
  switch (status) {
    case "do_not_book":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "needs_enrichment":
      return "bg-warning/15 text-warning border-warning/30";
    default:
      return "bg-success/15 text-success border-success/30";
  }
}

export function statusLabel(status: ProfileStatus): string {
  switch (status) {
    case "do_not_book": return "Do not book";
    case "needs_enrichment": return "Needs enrichment";
    default: return "Active";
  }
}
