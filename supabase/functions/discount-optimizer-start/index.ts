// Karpathy Loop — weekly discount-strategy A/B test starter.
// 1) Reads active strategy parameters
// 2) Asks the LLM for 5–8 single-parameter mutations
// 3) Validates them (caps + weight-sum within sane bounds)
// 4) Refreshes the held-constant 100-product test set for this week
// 5) Assigns products round-robin to variants → discount_variant_assignments
// 6) Records baseline velocity for each product
//
// The actual sales-vs-margin signal is collected by discount-optimizer-collect
// one week later, and feedback rows are inserted by discount-optimizer-feedback
// (typically from the sales sync job).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const TEST_SET_SIZE = 100;
const VARIANTS_PER_RUN = 6;

function weekStart(d = new Date()): string {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

function isValidStrategy(p: any): boolean {
  if (!p || typeof p !== "object") return false;
  const w = p.weights;
  if (!w) return false;
  const sum = (w.lifecycle ?? 0) + (w.competitor ?? 0) + (w.velocity ?? 0) + (w.margin ?? 0);
  if (sum < 0.95 || sum > 1.05) return false;
  const bands = p.phaseBands;
  if (!bands) return false;
  for (const k of ["1", "2", "3", "4", "5"]) {
    const b = bands[k];
    if (!Array.isArray(b) || b.length !== 2) return false;
    if (b[0] < 0 || b[1] > 0.85 || b[0] > b[1]) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const provided = req.headers.get("x-cron-secret") ?? "";
  const userJwt = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && provided !== CRON_SECRET && !userJwt) {
    return new Response(JSON.stringify({ error: "Unauthorised" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const ws = weekStart();
  const we = new Date(new Date(ws).getTime() + 6 * 86400000).toISOString().slice(0, 10);

  const logIns = await svc
    .from("discount_strategy_log")
    .insert({ run_type: "start", run_started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = logIns.data?.id;

  try {
    // 1) Active strategy
    const { data: active, error: actErr } = await svc
      .from("discount_strategy_experiments")
      .select("variant_id, parameters")
      .eq("is_active", true)
      .order("promoted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (actErr) throw actErr;
    if (!active) throw new Error("No active discount strategy (v0 seed missing)");

    // 2) Generate variants
    const ai = await callAI({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: "You are a pricing optimisation expert. Output STRICT JSON only." },
        {
          role: "user",
          content: `Generate ${VARIANTS_PER_RUN} variations of the discount strategy parameters below.
Each variation must mutate exactly ONE leaf value. All other keys must stay identical to the original.
Allowed mutations:
- phaseDays (launch/firstMark/performance/clearance) ±5
- phaseBands min or max (per phase) ±0.05, never above 0.85
- weights (lifecycle/competitor/velocity/margin) — keep the sum at ~1.0
- competitorCapGap ±0.05 (0.10 to 0.50)
- velocityWeeksOfCover.low or .high (low<high, 1..52)

Return JSON: {"variants":[{"variant_id":"v1","strategy_name":"label","parameters":{...full object...}}]}

ORIGINAL:
${JSON.stringify(active.parameters, null, 2)}`,
        },
      ],
      temperature: 0.9,
      max_tokens: 8000,
    });

    let proposed: Array<{ variant_id: string; strategy_name?: string; parameters: any }> = [];
    try {
      const txt = getContent(ai).replace(/^```json\s*|\s*```$/g, "");
      const parsed = JSON.parse(txt);
      proposed = Array.isArray(parsed?.variants) ? parsed.variants : [];
    } catch (e) {
      console.error("Variant JSON parse failed:", e);
    }
    if (proposed.length === 0) throw new Error("LLM returned no parseable variants");

    // 3) Validate + insert
    const stamp = Date.now().toString(36);
    const inserted: { id: string; variant_id: string }[] = [];
    for (let i = 0; i < proposed.length; i++) {
      const v = proposed[i];
      if (!isValidStrategy(v.parameters)) {
        console.warn("Rejecting invalid variant:", v.variant_id);
        continue;
      }
      const variantId = `${v.variant_id || `v${i + 1}`}-${stamp}`;
      const { data: row, error } = await svc
        .from("discount_strategy_experiments")
        .insert({
          variant_id: variantId,
          strategy_name: v.strategy_name ?? `Auto ${variantId}`,
          parameters: v.parameters,
          parent_variant_id: active.variant_id,
          test_started_at: new Date().toISOString(),
          is_active: false,
        })
        .select("id, variant_id")
        .single();
      if (error) {
        console.error("Insert failed:", error);
        continue;
      }
      inserted.push(row as any);
    }
    if (inserted.length === 0) throw new Error("All generated variants failed validation");

    // 4) Refresh test product set (skip if already present for this week)
    const { count: existing } = await svc
      .from("test_product_set_discount")
      .select("id", { count: "exact", head: true })
      .eq("test_week_start", ws);

    if (!existing) {
      // Pull candidate products. We don't have a unified product table here,
      // so we use collection_suggestions as the addressable id space and
      // synthesise minimal baseline values. Replace with a real product
      // source when one is wired in.
      const { data: candidates } = await svc
        .from("collection_suggestions")
        .select("id, suggested_title")
        .neq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(TEST_SET_SIZE * 3);

      // Exclude products already in the previous week
      const prevWeek = new Date(new Date(ws).getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const { data: prev } = await svc
        .from("test_product_set_discount")
        .select("product_id")
        .eq("test_week_start", prevWeek);
      const skip = new Set((prev ?? []).map((r) => r.product_id));

      const picked = (candidates ?? []).filter((c) => !skip.has(c.id)).slice(0, TEST_SET_SIZE);
      if (picked.length > 0) {
        await svc.from("test_product_set_discount").insert(
          picked.map((p) => ({
            product_id: p.id,
            product_title: (p as any).suggested_title ?? null,
            test_week_start: ws,
            test_week_end: we,
            weekly_velocity_baseline: 0, // filled in by sales sync if available
          })),
        );
      }
    }

    // 5) Assign products round-robin to variants
    const { data: testProducts } = await svc
      .from("test_product_set_discount")
      .select("product_id")
      .eq("test_week_start", ws);

    const assignmentRows: any[] = [];
    const tp = testProducts ?? [];
    for (let i = 0; i < tp.length; i++) {
      const v = inserted[i % inserted.length];
      assignmentRows.push({
        test_week_start: ws,
        product_id: tp[i].product_id,
        variant_id: v.variant_id,
        experiment_id: v.id,
      });
    }
    if (assignmentRows.length > 0) {
      // Upsert: same product in same week shouldn't double-assign
      await svc.from("discount_variant_assignments").upsert(assignmentRows, {
        onConflict: "test_week_start,product_id",
      });
    }

    await svc
      .from("discount_strategy_log")
      .update({
        run_completed_at: new Date().toISOString(),
        experiments_ran: inserted.length,
        notes: {
          inserted_variant_ids: inserted.map((v) => v.variant_id),
          test_set_week: ws,
          assignments: assignmentRows.length,
        },
      })
      .eq("id", runId!);

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, variants: inserted.length, products_assigned: assignmentRows.length, week: ws }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("discount-optimizer-start error:", msg);
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
