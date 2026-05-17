// Karpathy Loop — weekly collector + promoter for the discount strategy A/B test.
// 1) Closes out experiments older than 7 days (computes efficiency_score)
// 2) Blacklists variants with margin loss > settings.max_margin_loss_pct
// 3) Promotes the winning candidate if it beats current by ≥10% and has ≥50 samples
//    (unless a single param differs >50% from current — then mark pending_human_approval)
// 4) Rollback check: if current was promoted <14 days ago and overall margin
//    regressed by >10pp, revert to parent variant

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_SAMPLE = 50;
const MIN_LIFT_RATIO = 1.10;
const ROLLBACK_WINDOW_DAYS = 14;
const ROLLBACK_MARGIN_DROP_PP = 10;

function flatten(obj: any, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof obj !== "object" || obj === null) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number") out[key] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
      v.forEach((x, i) => (out[`${key}[${i}]`] = x as number));
    } else if (typeof v === "object" && v !== null) {
      Object.assign(out, flatten(v, key));
    }
  }
  return out;
}

function maxRelativeDelta(a: any, b: any): number {
  const fa = flatten(a);
  const fb = flatten(b);
  let max = 0;
  for (const k of Object.keys(fa)) {
    if (!(k in fb)) continue;
    const base = Math.abs(fa[k]) || 0.01;
    const delta = Math.abs((fb[k] - fa[k]) / base);
    if (delta > max) max = delta;
  }
  return max;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const logIns = await svc
    .from("discount_strategy_log")
    .insert({ run_type: "collect", run_started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = logIns.data?.id;

  try {
    // Pull max margin loss threshold from any user settings (most permissive — feature is per-user opt-in)
    const { data: settings } = await svc
      .from("discount_optimizer_settings")
      .select("max_margin_loss_pct, auto_promote")
      .limit(1)
      .maybeSingle();
    const maxMarginLoss = Number(settings?.max_margin_loss_pct ?? 15);
    const autoPromote = !!settings?.auto_promote;

    // 1) Close ripe experiments
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: ripe } = await svc
      .from("discount_strategy_experiments")
      .select("id, variant_id, parameters, parent_variant_id, test_started_at")
      .lt("test_started_at", sevenDaysAgo)
      .is("test_completed_at", null);

    for (const exp of ripe ?? []) {
      const { data: fb } = await svc
        .from("discount_strategy_feedback")
        .select("units_sold_during_test, revenue_during_test, margin_during_test, baseline_velocity")
        .eq("experiment_id", exp.id);

      const rows = fb ?? [];
      const samples = rows.length;
      let velocityGain = 0;
      let marginLoss = 0;
      if (samples > 0) {
        const avgUnits = rows.reduce((s, r) => s + (r.units_sold_during_test ?? 0), 0) / samples;
        const avgBaseline = rows.reduce((s, r) => s + (Number(r.baseline_velocity) ?? 0), 0) / samples || 0.01;
        velocityGain = ((avgUnits - avgBaseline) / avgBaseline) * 100;
        const avgRevenue = rows.reduce((s, r) => s + Number(r.revenue_during_test ?? 0), 0) / samples;
        const avgMargin = rows.reduce((s, r) => s + Number(r.margin_during_test ?? 0), 0) / samples;
        marginLoss = avgRevenue > 0 ? Math.max(0, ((avgRevenue - avgMargin) / avgRevenue) * 100 - 50) : 0;
        // ^ rough proxy: how far below a 50% gross-margin baseline we landed.
      }
      const efficiency = velocityGain / Math.max(0.01, marginLoss);
      const blacklisted = marginLoss > maxMarginLoss;

      await svc
        .from("discount_strategy_experiments")
        .update({
          test_completed_at: new Date().toISOString(),
          efficiency_score: Number.isFinite(efficiency) ? efficiency : 0,
          velocity_gain_pct: velocityGain,
          margin_loss_pct: marginLoss,
          sample_size: samples,
          blacklisted,
        })
        .eq("id", exp.id);
    }

    // 2) Current active
    const { data: active } = await svc
      .from("discount_strategy_experiments")
      .select("*")
      .eq("is_active", true)
      .order("promoted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!active) {
      return new Response(JSON.stringify({ ok: true, message: "No active strategy" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Pick winner
    const { data: candidates } = await svc
      .from("discount_strategy_experiments")
      .select("*")
      .eq("blacklisted", false)
      .gte("sample_size", MIN_SAMPLE)
      .not("efficiency_score", "is", null)
      .neq("id", active.id)
      .order("efficiency_score", { ascending: false })
      .limit(5);

    let promoted = false;
    let winnerId: string | null = null;
    let lift = 0;
    let pendingApproval = false;

    const winner = (candidates ?? [])[0];
    const activeEff = Number(active.efficiency_score ?? 0);
    if (winner && Number(winner.efficiency_score) >= activeEff * MIN_LIFT_RATIO && Number(winner.efficiency_score) > 0) {
      const delta = maxRelativeDelta(active.parameters, winner.parameters);
      if (delta > 0.5 && !autoPromote) {
        await svc
          .from("discount_strategy_experiments")
          .update({ pending_human_approval: true })
          .eq("id", winner.id);
        pendingApproval = true;
        winnerId = winner.variant_id;
        lift = activeEff > 0 ? (Number(winner.efficiency_score) - activeEff) / activeEff : 1;
      } else {
        await svc.from("discount_strategy_experiments").update({ is_active: false }).eq("id", active.id);
        await svc
          .from("discount_strategy_experiments")
          .update({
            is_active: true,
            promoted_at: new Date().toISOString(),
            parent_variant_id: active.variant_id,
          })
          .eq("id", winner.id);
        promoted = true;
        winnerId = winner.variant_id;
        lift = activeEff > 0 ? (Number(winner.efficiency_score) - activeEff) / activeEff : 1;
      }
    }

    // 4) Rollback check
    if (!promoted && active.promoted_at) {
      const ageDays = (Date.now() - new Date(active.promoted_at).getTime()) / 86400000;
      if (ageDays <= ROLLBACK_WINDOW_DAYS && Number(active.margin_loss_pct ?? 0) > ROLLBACK_MARGIN_DROP_PP && active.parent_variant_id) {
        const { data: parent } = await svc
          .from("discount_strategy_experiments")
          .select("id, variant_id")
          .eq("variant_id", active.parent_variant_id)
          .maybeSingle();
        if (parent) {
          await svc.from("discount_strategy_experiments").update({ is_active: false }).eq("id", active.id);
          await svc
            .from("discount_strategy_experiments")
            .update({ is_active: true, promoted_at: new Date().toISOString() })
            .eq("id", parent.id);
          await svc
            .from("discount_strategy_log")
            .update({
              run_completed_at: new Date().toISOString(),
              winning_variant_id: parent.variant_id,
              previous_variant_id: active.variant_id,
              promoted: true,
              notes: { reason: "auto_rollback" },
            })
            .eq("id", runId!);
          return new Response(JSON.stringify({ ok: true, rolled_back_to: parent.variant_id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    await svc
      .from("discount_strategy_log")
      .update({
        run_completed_at: new Date().toISOString(),
        experiments_ran: (ripe ?? []).length,
        winning_variant_id: winnerId,
        previous_variant_id: promoted ? active.variant_id : null,
        efficiency_improvement_pct: lift,
        promoted,
        notes: {
          pending_human_approval: pendingApproval,
          active_efficiency: activeEff,
          candidates: (candidates ?? []).slice(0, 5).map((c) => ({
            variant_id: c.variant_id,
            efficiency: c.efficiency_score,
            samples: c.sample_size,
            blacklisted: c.blacklisted,
          })),
        },
      })
      .eq("id", runId!);

    return new Response(JSON.stringify({ ok: true, promoted, winner: winnerId, lift, pending_approval: pendingApproval }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("discount-optimizer-collect error:", msg);
    if (runId) {
      await svc
        .from("discount_strategy_log")
        .update({ run_completed_at: new Date().toISOString(), error_message: msg })
        .eq("id", runId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
