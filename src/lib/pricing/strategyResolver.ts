// Resolves the StrategyParams to use for a given product, honouring any
// active weekly A/B-test assignment. Falls back to the active default,
// then to the engine's DEFAULT_STRATEGY constant.
//
// Cached in-memory for 60s to avoid hammering the DB from price-recommendation
// loops. Margin floor is never read from here — it stays hard-coded in
// lifecycleEngine and cannot be softened by any variant.

import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_STRATEGY, type StrategyParams } from "./lifecycleEngine";

const TTL_MS = 60_000;

interface CachedEntry {
  params: StrategyParams;
  variantId: string;
  expiresAt: number;
}

let activeCache: CachedEntry | null = null;
const productCache = new Map<string, CachedEntry>();

function fresh(entry: CachedEntry | null | undefined): entry is CachedEntry {
  return !!entry && entry.expiresAt > Date.now();
}

function thisWeekStartISO(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

async function loadActiveStrategy(): Promise<CachedEntry> {
  if (fresh(activeCache)) return activeCache!;
  const { data } = await supabase
    .from("discount_strategy_experiments")
    .select("variant_id, parameters")
    .eq("is_active", true)
    .order("promoted_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const entry: CachedEntry = {
    params: (data?.parameters as unknown as StrategyParams) ?? DEFAULT_STRATEGY,
    variantId: data?.variant_id ?? "default",
    expiresAt: Date.now() + TTL_MS,
  };
  activeCache = entry;
  return entry;
}

export async function resolveStrategyForProduct(productId: string): Promise<{ params: StrategyParams; variantId: string }> {
  const cached = productCache.get(productId);
  if (fresh(cached)) return { params: cached.params, variantId: cached.variantId };

  const { data: assignment } = await supabase
    .from("discount_variant_assignments")
    .select("variant_id, experiment_id, test_week_start")
    .eq("product_id", productId)
    .eq("test_week_start", thisWeekStartISO())
    .maybeSingle();

  if (assignment?.experiment_id) {
    const { data: exp } = await supabase
      .from("discount_strategy_experiments")
      .select("variant_id, parameters, blacklisted")
      .eq("id", assignment.experiment_id)
      .maybeSingle();
    if (exp && !exp.blacklisted) {
      const entry: CachedEntry = {
        params: exp.parameters as unknown as StrategyParams,
        variantId: exp.variant_id,
        expiresAt: Date.now() + TTL_MS,
      };
      productCache.set(productId, entry);
      return { params: entry.params, variantId: entry.variantId };
    }
  }

  const active = await loadActiveStrategy();
  productCache.set(productId, { ...active, expiresAt: Date.now() + TTL_MS });
  return { params: active.params, variantId: active.variantId };
}

export function clearStrategyCache() {
  activeCache = null;
  productCache.clear();
}
