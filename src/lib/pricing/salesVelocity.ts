/**
 * Sales Velocity — derived from existing public.sales_data
 * (populated by the shopify-order-sync edge function).
 *
 * MVP rule: avg weekly sales = units sold in the last 30 days / 4.286
 * Returns 0 when no rows exist for the variant/product.
 */

import { supabase } from "@/integrations/supabase/client";

export interface VelocityResult {
  avgWeeklySales: number;
  unitsLast30d: number;
  hasData: boolean;
  lastSoldAt: string | null;
}

const EMPTY: VelocityResult = {
  avgWeeklySales: 0,
  unitsLast30d: 0,
  hasData: false,
  lastSoldAt: null,
};

const WEEKS_IN_30D = 30 / 7; // 4.2857

export async function getVelocityForVariant(variantId: string): Promise<VelocityResult> {
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sales_data")
    .select("quantity_sold, sold_at")
    .eq("variant_id", variantId)
    .gte("sold_at", sinceIso);

  if (error || !data || data.length === 0) return EMPTY;

  const units = data.reduce((sum, r: any) => sum + (Number(r.quantity_sold) || 0), 0);
  const lastSoldAt = data
    .map((r: any) => r.sold_at)
    .sort()
    .at(-1) ?? null;

  return {
    avgWeeklySales: +(units / WEEKS_IN_30D).toFixed(2),
    unitsLast30d: units,
    hasData: units > 0,
    lastSoldAt,
  };
}

/** Bulk velocity lookup for a list of variant ids. */
export async function getVelocityMap(
  variantIds: string[],
): Promise<Record<string, VelocityResult>> {
  if (variantIds.length === 0) return {};
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sales_data")
    .select("variant_id, quantity_sold, sold_at")
    .in("variant_id", variantIds)
    .gte("sold_at", sinceIso);

  if (error || !data) return {};

  const buckets: Record<string, { units: number; last: string | null }> = {};
  for (const r of data as any[]) {
    if (!r.variant_id) continue;
    const b = buckets[r.variant_id] ?? { units: 0, last: null };
    b.units += Number(r.quantity_sold) || 0;
    if (!b.last || r.sold_at > b.last) b.last = r.sold_at;
    buckets[r.variant_id] = b;
  }

  const out: Record<string, VelocityResult> = {};
  for (const id of variantIds) {
    const b = buckets[id];
    out[id] = b
      ? {
          avgWeeklySales: +(b.units / WEEKS_IN_30D).toFixed(2),
          unitsLast30d: b.units,
          hasData: b.units > 0,
          lastSoldAt: b.last,
        }
      : EMPTY;
  }
  return out;
}

/**
 * Trigger a Shopify order sync (last 90 days) so sales_data is fresh.
 * Returns true on success, false on any failure (caller decides how to surface).
 */
export async function refreshSalesData(): Promise<boolean> {
  try {
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const { error } = await supabase.functions.invoke("shopify-order-sync", {
      body: { since_date: sinceDate },
    });
    return !error;
  } catch {
    return false;
  }
}
