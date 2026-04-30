/**
 * Restock status helpers.
 *
 * Resolution order for a variant's effective status:
 *   1. restock_status_override (per-variant staff tag)
 *   2. product_catalog_cache.restock_status
 *   3. supplier default (supplier_profiles.profile_data.default_restock_status)
 *   4. 'ongoing' (system default — opt-out model)
 *
 * Stored in DB as the lowercase enum value: 'ongoing' | 'refill' | 'no_reorder'
 */
import { supabase } from "@/integrations/supabase/client";

export type RestockStatus = "ongoing" | "refill" | "no_reorder";

export const RESTOCK_STATUS_LABEL: Record<RestockStatus, string> = {
  ongoing: "Ongoing",
  refill: "Refill",
  no_reorder: "No Reorder",
};

export const RESTOCK_STATUS_EMOJI: Record<RestockStatus, string> = {
  ongoing: "🔄",
  refill: "🔁",
  no_reorder: "⛔",
};

export const RESTOCK_STATUS_OPTIONS: RestockStatus[] = ["ongoing", "refill", "no_reorder"];

/** Tailwind classes for the badge pill */
export const RESTOCK_STATUS_BADGE: Record<RestockStatus, string> = {
  ongoing: "bg-success/15 text-success border-success/30",
  refill: "bg-primary/15 text-primary border-primary/30",
  no_reorder: "bg-muted text-muted-foreground border-border",
};

/** Subtle row background for refill rows */
export const REFILL_ROW_BG = "bg-primary/5";

export function isValidRestockStatus(v: unknown): v is RestockStatus {
  return v === "ongoing" || v === "refill" || v === "no_reorder";
}

/**
 * Build a Map<platform_variant_id, RestockStatus> for the current user
 * by reading restock_status_override.
 */
export async function loadRestockOverrides(userId: string): Promise<Map<string, RestockStatus>> {
  const out = new Map<string, RestockStatus>();
  const { data, error } = await supabase
    .from("restock_status_override" as any)
    .select("platform_variant_id, restock_status")
    .eq("user_id", userId);
  if (error || !data) return out;
  (data as any[]).forEach((r) => {
    if (r?.platform_variant_id && isValidRestockStatus(r.restock_status)) {
      out.set(String(r.platform_variant_id), r.restock_status as RestockStatus);
    }
  });
  return out;
}

/** Build a Map<lowercased supplier_name, RestockStatus> from supplier profiles' profile_data */
export function buildSupplierDefaultMap(
  profiles: Array<{ supplier_name: string; profile_data: any }> | null,
): Map<string, RestockStatus> {
  const m = new Map<string, RestockStatus>();
  (profiles || []).forEach((p) => {
    const v = p?.profile_data?.default_restock_status;
    if (isValidRestockStatus(v)) {
      m.set((p.supplier_name || "").toLowerCase(), v);
    }
  });
  return m;
}

/**
 * Resolve effective status for a single variant.
 */
export function resolveRestockStatus(args: {
  platformVariantId?: string | null;
  /** Internal Supabase variants.id — used as fallback override key when no Shopify ID exists. */
  internalVariantId?: string | null;
  vendor?: string | null;
  cacheStatus?: string | null;
  overrides: Map<string, RestockStatus>;
  supplierDefaults: Map<string, RestockStatus>;
}): RestockStatus {
  const { platformVariantId, internalVariantId, vendor, cacheStatus, overrides, supplierDefaults } = args;
  // Check Shopify variant ID first, then internal variant ID as fallback
  const keysToCheck = [platformVariantId, internalVariantId].filter(Boolean) as string[];
  for (const key of keysToCheck) {
    const o = overrides.get(String(key));
    if (o) return o;
  }
  if (isValidRestockStatus(cacheStatus)) return cacheStatus;
  if (vendor) {
    const d = supplierDefaults.get(vendor.toLowerCase());
    if (d) return d;
  }
  return "ongoing";
}

/**
 * Upsert override(s). Variants without platform_variant_id are skipped.
 */
export async function setRestockStatusBulk(
  userId: string,
  variants: Array<{ platform_variant_id: string | null | undefined; shop_domain?: string | null }>,
  status: RestockStatus,
): Promise<{ updated: number }> {
  const rows = variants
    .filter((v) => v.platform_variant_id)
    .map((v) => ({
      user_id: userId,
      platform: "shopify",
      platform_variant_id: String(v.platform_variant_id),
      shop_domain: v.shop_domain ?? null,
      restock_status: status,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return { updated: 0 };
  const { error } = await supabase
    .from("restock_status_override" as any)
    .upsert(rows, { onConflict: "user_id,platform,platform_variant_id" });
  if (error) throw error;
  return { updated: rows.length };
}
