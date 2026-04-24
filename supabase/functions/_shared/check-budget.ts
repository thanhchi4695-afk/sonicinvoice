/**
 * Budget check helper for agent runs.
 * Returns ok:false with degraded:true when caps are hit so the caller
 * can fall back to deterministic decisions instead of calling Claude.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const PER_SESSION_CAP_CENTS = 20;

export interface BudgetCheck {
  ok: boolean;
  degraded: boolean;
  reason?: "user_cap" | "global_cap" | "session_cap";
  remainingCents: number;
}

export async function checkBudget(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  sessionId: string,
  estimatedCents = 1,
): Promise<BudgetCheck> {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Per-session cap (sum of decisions for this session)
  const { data: session } = await admin
    .from("agent_sessions")
    .select("total_cost_cents")
    .eq("id", sessionId)
    .maybeSingle();
  const sessionSpent = session?.total_cost_cents ?? 0;
  if (sessionSpent + estimatedCents > PER_SESSION_CAP_CENTS) {
    return { ok: false, degraded: true, reason: "session_cap", remainingCents: 0 };
  }

  // 2. Per-user monthly cap — upsert default row if missing
  let { data: budget } = await admin
    .from("agent_budgets")
    .select("monthly_cap_cents, spent_cents, degraded")
    .eq("user_id", userId)
    .maybeSingle();
  if (!budget) {
    await admin.from("agent_budgets").insert({ user_id: userId });
    budget = { monthly_cap_cents: 500, spent_cents: 0, degraded: false };
  }
  const userRemaining = budget.monthly_cap_cents - budget.spent_cents;
  if (userRemaining <= estimatedCents) {
    return { ok: false, degraded: true, reason: "user_cap", remainingCents: Math.max(0, userRemaining) };
  }

  // 3. Global ceiling
  const { data: globalBudget } = await admin
    .from("agent_global_budget")
    .select("monthly_cap_cents, spent_cents")
    .eq("id", 1)
    .maybeSingle();
  if (globalBudget) {
    const globalRemaining = globalBudget.monthly_cap_cents - globalBudget.spent_cents;
    if (globalRemaining <= estimatedCents) {
      return { ok: false, degraded: true, reason: "global_cap", remainingCents: 0 };
    }
  }

  // Soft-degrade if within 10% of any cap
  const nearUserCap = userRemaining < budget.monthly_cap_cents * 0.1;
  return { ok: true, degraded: nearUserCap, remainingCents: userRemaining };
}
