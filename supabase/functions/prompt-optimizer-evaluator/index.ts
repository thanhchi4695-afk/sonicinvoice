// Karpathy Loop evaluator. Promotes a winning variant when:
//   - it has ≥100 feedback rows in the window
//   - its approval rate beats the current default by ≥5 percentage points
// Also auto-rolls back a recently promoted variant if its rate drops
// below the previous default within 7 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_SAMPLE = 100;
const MIN_LIFT = 0.05;
const ROLLBACK_WINDOW_DAYS = 7;

interface VariantStats {
  variant_id: string;
  experiment_id: string;
  total: number;
  approved: number;
  rate: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // All experiments for this type (last 30d candidates)
    const { data: experiments } = await svc
      .from("prompt_experiments")
      .select("id, variant_id, is_active, promoted_at, parent_variant_id, created_at")
      .eq("experiment_type", "collection_description")
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    if (!experiments || experiments.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No experiments to evaluate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const active = experiments.find((e) => e.is_active);
    if (!active) {
      return new Response(JSON.stringify({ ok: true, message: "No active variant" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull feedback for all candidate variants
    const ids = experiments.map((e) => e.variant_id);
    const { data: feedback } = await svc
      .from("prompt_experiment_feedback")
      .select("variant_id, experiment_id, approved")
      .eq("experiment_type", "collection_description")
      .in("variant_id", ids);

    const stats = new Map<string, VariantStats>();
    for (const e of experiments) {
      stats.set(e.variant_id, { variant_id: e.variant_id, experiment_id: e.id, total: 0, approved: 0, rate: 0 });
    }
    for (const f of feedback ?? []) {
      const s = stats.get(f.variant_id);
      if (!s) continue;
      s.total++;
      if (f.approved) s.approved++;
    }
    for (const s of stats.values()) {
      s.rate = s.total > 0 ? s.approved / s.total : 0;
    }

    const activeStats = stats.get(active.variant_id)!;
    const candidates = [...stats.values()]
      .filter((s) => s.variant_id !== active.variant_id && s.total >= MIN_SAMPLE)
      .sort((a, b) => b.rate - a.rate);

    let promoted = false;
    let winnerId: string | null = null;
    let lift = 0;

    // Rollback check first
    if (active.promoted_at) {
      const ageDays = (Date.now() - new Date(active.promoted_at).getTime()) / 86400000;
      if (ageDays <= ROLLBACK_WINDOW_DAYS && active.parent_variant_id && activeStats.total >= MIN_SAMPLE) {
        const parent = experiments.find((e) => e.variant_id === active.parent_variant_id);
        const parentStats = parent ? stats.get(parent.variant_id) : null;
        if (parentStats && activeStats.rate + MIN_LIFT < parentStats.rate) {
          await svc.from("prompt_experiments").update({ is_active: false }).eq("id", active.id);
          await svc
            .from("prompt_experiments")
            .update({ is_active: true, promoted_at: new Date().toISOString() })
            .eq("id", parentStats.experiment_id);
          await svc.from("prompt_optimizer_log").insert({
            experiment_type: "collection_description",
            run_started_at: new Date().toISOString(),
            run_completed_at: new Date().toISOString(),
            experiments_ran: 0,
            winning_variant_id: parentStats.variant_id,
            previous_variant_id: active.variant_id,
            improvement_percentage: parentStats.rate - activeStats.rate,
            promoted: true,
            notes: { reason: "auto_rollback" },
          });
          return new Response(
            JSON.stringify({ ok: true, rolled_back_to: parentStats.variant_id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Promote winner if it beats the active by ≥5pp
    const winner = candidates[0];
    if (winner && winner.rate >= activeStats.rate + MIN_LIFT) {
      await svc.from("prompt_experiments").update({ is_active: false }).eq("id", active.id);
      await svc
        .from("prompt_experiments")
        .update({
          is_active: true,
          promoted_at: new Date().toISOString(),
          parent_variant_id: active.variant_id,
          approval_rate: winner.rate,
          sample_size: winner.total,
        })
        .eq("id", winner.experiment_id);
      promoted = true;
      winnerId = winner.variant_id;
      lift = winner.rate - activeStats.rate;
    }

    // Always refresh rolling rate on active
    await svc
      .from("prompt_experiments")
      .update({ approval_rate: activeStats.rate, sample_size: activeStats.total })
      .eq("id", active.id);

    await svc.from("prompt_optimizer_log").insert({
      experiment_type: "collection_description",
      run_started_at: new Date().toISOString(),
      run_completed_at: new Date().toISOString(),
      experiments_ran: candidates.length,
      winning_variant_id: winnerId,
      previous_variant_id: promoted ? active.variant_id : null,
      improvement_percentage: lift,
      promoted,
      notes: {
        active_rate: activeStats.rate,
        active_samples: activeStats.total,
        candidates: candidates.slice(0, 5).map((c) => ({ variant_id: c.variant_id, rate: c.rate, total: c.total })),
      },
    });

    return new Response(JSON.stringify({ ok: true, promoted, winner: winnerId, lift }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("prompt-optimizer-evaluator error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
