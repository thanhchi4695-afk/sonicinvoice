// Ported from collection-content-generator (deprecated).
// Normalises smart_collection_rules JSON and persists it onto
// collection_suggestions so collection-publish (which reads s.rule_set)
// and any UI that reads s.smart_collection_rules both have the same data.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface SmartCollectionRule {
  column: string;        // 'vendor' | 'type' | 'tag' | 'title' | 'variant_title'
  relation: string;      // 'equals' | 'contains' | ...
  condition: string;
}

export interface SmartCollectionRules {
  applied_disjunctively: boolean;
  rules: SmartCollectionRule[];
}

const ALLOWED_COLUMNS = new Set([
  "vendor", "type", "tag", "title", "variant_title",
  "variant_compare_at_price", "variant_inventory", "variant_price", "variant_weight",
]);
const ALLOWED_RELATIONS = new Set([
  "equals", "not_equals", "greater_than", "less_than",
  "starts_with", "ends_with", "contains", "not_contains",
]);

export function normalizeSmartRules(input: unknown): SmartCollectionRules | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const rawRules = Array.isArray(obj.rules)
    ? obj.rules
    : Array.isArray(input as unknown as unknown[]) ? (input as unknown as unknown[]) : [];

  const rules: SmartCollectionRule[] = [];
  for (const r of rawRules as Array<Record<string, unknown>>) {
    const column = String(r?.column ?? "").trim();
    const relation = String(r?.relation ?? "").trim();
    const condition = String(r?.condition ?? "").trim();
    if (!column || !relation || !condition) continue;
    if (!ALLOWED_COLUMNS.has(column) || !ALLOWED_RELATIONS.has(relation)) continue;
    rules.push({ column, relation, condition });
  }
  if (rules.length === 0) return null;

  return {
    applied_disjunctively: obj.applied_disjunctively === true,
    rules,
  };
}

/**
 * Persist normalised smart rules onto the suggestion row.
 * - Always writes `smart_collection_rules` (legacy CCG column, still queried by UI).
 * - Also fills `rule_set` if it is currently empty so collection-publish has rules
 *   to push to Shopify. Never overwrites a non-empty `rule_set`.
 */
export async function persistSmartRules(
  supabase: SupabaseClient,
  suggestionId: string,
  rawRules: unknown,
): Promise<{ persisted: boolean; rule_count: number; filled_rule_set: boolean }> {
  const normalised = normalizeSmartRules(rawRules);
  if (!normalised) return { persisted: false, rule_count: 0, filled_rule_set: false };

  const { data: existing } = await supabase
    .from("collection_suggestions")
    .select("rule_set")
    .eq("id", suggestionId)
    .maybeSingle();

  const existingRuleSet = existing?.rule_set as Record<string, unknown> | unknown[] | null | undefined;
  const ruleSetEmpty =
    !existingRuleSet ||
    (Array.isArray(existingRuleSet) && existingRuleSet.length === 0) ||
    (typeof existingRuleSet === "object" && !Array.isArray(existingRuleSet) &&
      (!Array.isArray((existingRuleSet as Record<string, unknown>).rules) ||
        ((existingRuleSet as Record<string, unknown>).rules as unknown[]).length === 0));

  const patch: Record<string, unknown> = { smart_collection_rules: normalised };
  if (ruleSetEmpty) patch.rule_set = normalised;

  const { error } = await supabase
    .from("collection_suggestions")
    .update(patch)
    .eq("id", suggestionId);
  if (error) throw error;

  return {
    persisted: true,
    rule_count: normalised.rules.length,
    filled_rule_set: ruleSetEmpty,
  };
}
