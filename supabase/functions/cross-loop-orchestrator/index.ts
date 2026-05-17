// Phase 4 — Cross-Loop Learning orchestrator (nightly 03:00 UTC).
// Gathers signals from prompt/discount/seo optimizers, learns business impact
// weights, detects conflicts, generates AI hypotheses for underperformers, and
// (optionally) auto-creates A/B tests for high-confidence hypotheses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Json = Record<string, unknown>;

const METRICS = ["ctr", "approval_rate", "velocity_gain", "margin_preservation"] as const;
type Metric = typeof METRICS[number];

async function listUsers(svc: ReturnType<typeof createClient>): Promise<string[]> {
  // All users who have either a Shopify connection or any optimizer activity.
  const ids = new Set<string>();
  const tables = [
    "shopify_connections",
    "prompt_experiment_feedback",
    "discount_strategy_feedback",
    "seo_ab_experiments",
  ];
  for (const t of tables) {
    try {
      const { data } = await svc.from(t).select("user_id").limit(1000);
      data?.forEach((r: any) => r.user_id && ids.add(r.user_id));
    } catch (_) { /* table may not exist; ignore */ }
  }
  return [...ids];
}

async function gatherSignals(svc: any, userId: string) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const out: any[] = [];

  // Approval rate from prompt feedback
  try {
    const { data } = await svc.from("prompt_experiment_feedback")
      .select("variant_id, experiment_type, approved, edited, created_at")
      .eq("user_id", userId).gte("created_at", since);
    if (data?.length) {
      const approved = data.filter((d: any) => d.approved).length;
      out.push({
        user_id: userId, signal_type: "approval_rate", source_optimizer: "prompt",
        signal_value: approved / data.length, revenue_impact_estimate: null,
        metadata: { samples: data.length },
      });
    }
  } catch (_) {}

  // Velocity & margin from discount feedback
  try {
    const { data } = await svc.from("discount_strategy_feedback")
      .select("variant_id, units_sold_during_test, revenue_during_test, margin_during_test, baseline_velocity, discount_applied_pct")
      .eq("user_id", userId).gte("created_at", since);
    if (data?.length) {
      const totalUnits = data.reduce((s: number, d: any) => s + Number(d.units_sold_during_test ?? 0), 0);
      const baseline = data.reduce((s: number, d: any) => s + Number(d.baseline_velocity ?? 0), 0);
      const margin = data.reduce((s: number, d: any) => s + Number(d.margin_during_test ?? 0), 0);
      const velocityGain = baseline > 0 ? (totalUnits - baseline) / baseline : 0;
      out.push({
        user_id: userId, signal_type: "velocity_gain", source_optimizer: "discount",
        signal_value: velocityGain, revenue_impact_estimate: data.reduce((s: number, d: any) => s + Number(d.revenue_during_test ?? 0), 0),
        metadata: { samples: data.length },
      });
      out.push({
        user_id: userId, signal_type: "margin_preservation", source_optimizer: "discount",
        signal_value: margin, revenue_impact_estimate: margin, metadata: { samples: data.length },
      });
    }
  } catch (_) {}

  // CTR from SEO AB experiments
  try {
    const { data } = await svc.from("seo_ab_experiments")
      .select("collection_id, variant_id, impressions, clicks, ctr, is_winner")
      .eq("user_id", userId).gte("created_at", since);
    if (data?.length) {
      const imp = data.reduce((s: number, d: any) => s + Number(d.impressions ?? 0), 0);
      const clk = data.reduce((s: number, d: any) => s + Number(d.clicks ?? 0), 0);
      const ctr = imp > 0 ? clk / imp : 0;
      out.push({
        user_id: userId, signal_type: "ctr", source_optimizer: "seo",
        signal_value: ctr, revenue_impact_estimate: null,
        metadata: { impressions: imp, clicks: clk, samples: data.length },
      });
    }
  } catch (_) {}

  if (out.length) await svc.from("cross_loop_signals").insert(out);
  return out;
}

async function updateWeights(svc: any, userId: string, signals: any[]) {
  // Simple revenue-weighted heuristic: weight = normalized |revenue_impact| per metric.
  // If no revenue data, fall back to defaults (CTR 0.4, velocity 0.3, margin 0.2, approval 0.1).
  const defaults: Record<Metric, number> = {
    ctr: 0.4, velocity_gain: 0.3, margin_preservation: 0.2, approval_rate: 0.1,
  };
  const sums: Record<string, number> = {};
  for (const s of signals) {
    const rev = Math.abs(Number(s.revenue_impact_estimate ?? 0));
    sums[s.signal_type] = (sums[s.signal_type] ?? 0) + rev;
  }
  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  const weights: Record<Metric, number> = { ...defaults };
  if (total > 0) {
    for (const m of METRICS) {
      const w = (sums[m] ?? 0) / total;
      weights[m] = w > 0 ? Math.max(0.05, w) : defaults[m] * 0.5;
    }
    // Renormalize
    const wt = METRICS.reduce((a, m) => a + weights[m], 0);
    METRICS.forEach(m => weights[m] = weights[m] / wt);
  }
  for (const m of METRICS) {
    await svc.from("business_impact_weights").upsert({
      user_id: userId, metric_name: m, weight: weights[m],
      sample_size: signals.length, last_updated: new Date().toISOString(),
    }, { onConflict: "user_id,metric_name" });
  }
  return weights;
}

async function detectConflicts(svc: any, userId: string, signals: any[], weights: Record<Metric, number>) {
  // Find signals from different optimizers on the same target window (here we use overall store-level).
  const byOpt: Record<string, any[]> = {};
  signals.forEach(s => { (byOpt[s.source_optimizer] ??= []).push(s); });
  const conflicts: any[] = [];
  // Pairwise: if approval_rate up but ctr down (or vice versa)
  const approval = byOpt.prompt?.find(s => s.signal_type === "approval_rate")?.signal_value ?? null;
  const ctr = byOpt.seo?.find(s => s.signal_type === "ctr")?.signal_value ?? null;
  if (approval !== null && ctr !== null) {
    const score = weights.approval_rate * approval + weights.ctr * ctr;
    if ((approval > 0.7 && ctr < 0.02) || (approval < 0.4 && ctr > 0.04)) {
      conflicts.push({
        user_id: userId, target_type: "store", target_id: userId,
        conflicting_optimizers: ["prompt", "seo"],
        conflict_summary: `approval_rate=${approval.toFixed(2)} vs ctr=${ctr.toFixed(3)}`,
        resolution_action: ctr * weights.ctr > approval * weights.approval_rate
          ? "prioritize_seo_signals" : "prioritize_prompt_signals",
        net_impact_score: score,
        details: { approval, ctr, weights },
      });
    }
  }
  if (conflicts.length) await svc.from("cross_loop_resolutions").insert(conflicts);
  return conflicts;
}

async function identifyUnderperformers(svc: any, userId: string) {
  const out: any[] = [];
  // SEO: experiments where CTR < 0.02 with >500 impressions
  try {
    const { data } = await svc.from("seo_ab_experiments")
      .select("id, collection_id, seo_title, meta_description, impressions, clicks, ctr")
      .eq("user_id", userId).gt("impressions", 500).lt("ctr", 0.02).limit(10);
    data?.forEach((d: any) => out.push({
      kind: "seo", target_id: d.collection_id, target_label: d.seo_title,
      current_value: JSON.stringify({ title: d.seo_title, meta: d.meta_description }),
      ctx: { impressions: d.impressions, clicks: d.clicks, ctr: d.ctr },
    }));
  } catch (_) {}
  // Discount: feedback rows with low velocity gain
  try {
    const { data } = await svc.from("discount_strategy_feedback")
      .select("product_id, units_sold_during_test, baseline_velocity, discount_applied_pct, margin_during_test")
      .eq("user_id", userId).limit(10);
    data?.forEach((d: any) => {
      const gain = d.baseline_velocity > 0 ? (d.units_sold_during_test - d.baseline_velocity) / d.baseline_velocity : 0;
      if (gain < 0.1) out.push({
        kind: "discount", target_id: d.product_id, target_label: `Product ${d.product_id}`,
        current_value: `discount=${d.discount_applied_pct}%`, ctx: { gain, ...d },
      });
    });
  } catch (_) {}
  return out.slice(0, 20);
}

async function generateHypotheses(userId: string, weights: Record<Metric, number>, underperformers: any[]) {
  if (!underperformers.length || !LOVABLE_API_KEY) return [];
  const prompt = `You are an autonomous e-commerce optimization agent for a Shopify boutique.
Generate concrete A/B test hypotheses for these underperformers.

Business impact weights (what drives revenue for this store):
${JSON.stringify(weights, null, 2)}

Underperformers (max 10):
${JSON.stringify(underperformers.slice(0, 10), null, 2)}

For each, output one hypothesis. Reply with a JSON array of objects with fields:
{ hypothesis_type: 'seo_title'|'meta_description'|'discount_strategy'|'collection_description',
  target_id: string, target_label: string, current_value: string, proposed_value: string,
  reasoning: string, expected_impact_pct: number, confidence: number /* 0..1 */ }
Return ONLY the JSON array, no prose.`;

  const tryModel = async (model: string) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? "[]";
    // Model may wrap in {hypotheses:[...]}
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { return []; }
    const arr = Array.isArray(parsed) ? parsed : (parsed.hypotheses ?? parsed.results ?? []);
    return Array.isArray(arr) ? arr : [];
  };

  try { return await tryModel("google/gemini-2.5-pro"); }
  catch { try { return await tryModel("google/gemini-2.5-flash"); } catch { return []; } }
}

async function storeAndMaybeAutoCreate(svc: any, userId: string, hypotheses: any[]) {
  if (!hypotheses.length) return { stored: 0, autoCreated: 0 };
  const { data: settings } = await svc.from("ai_brain_settings").select("*").eq("user_id", userId).maybeSingle();
  const autoEnabled = !!settings?.autonomous_enabled;
  const minConf = Number(settings?.min_confidence_for_auto ?? 0.9);
  const maxConcurrent = Number(settings?.max_concurrent_auto_tests ?? 3);
  const excluded: string[] = settings?.excluded_targets ?? [];

  // Count active auto tests
  const { count } = await svc.from("auto_test_hypotheses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("status", "testing");
  let activeCount = count ?? 0;

  let autoCreated = 0;
  const rows = hypotheses.slice(0, 20).map((h: any) => {
    const target = String(h.target_id ?? "");
    const conf = Number(h.confidence ?? 0);
    const canAuto = autoEnabled && conf >= minConf && activeCount < maxConcurrent && !excluded.includes(target);
    if (canAuto) { activeCount++; autoCreated++; }
    return {
      user_id: userId,
      hypothesis_type: String(h.hypothesis_type ?? "seo_title"),
      target_id: target,
      target_label: h.target_label ?? null,
      current_value: h.current_value ?? null,
      proposed_value: h.proposed_value ?? null,
      reasoning: h.reasoning ?? null,
      expected_impact_pct: Number(h.expected_impact_pct ?? 0),
      confidence: conf,
      status: canAuto ? "testing" : "pending",
      auto_created: canAuto,
    };
  });
  await svc.from("auto_test_hypotheses").insert(rows);
  return { stored: rows.length, autoCreated };
}

async function runForUser(svc: any, userId: string) {
  const startedAt = new Date().toISOString();
  const log: Json = { user_id: userId, started_at: startedAt };
  try {
    const signals = await gatherSignals(svc, userId);
    const weights = await updateWeights(svc, userId, signals);
    const conflicts = await detectConflicts(svc, userId, signals, weights);
    const underperformers = await identifyUnderperformers(svc, userId);
    const hypotheses = await generateHypotheses(userId, weights, underperformers);
    const { stored, autoCreated } = await storeAndMaybeAutoCreate(svc, userId, hypotheses);

    await svc.from("cross_loop_run_log").insert({
      user_id: userId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      signals_collected: signals.length,
      conflicts_resolved: conflicts.length,
      hypotheses_generated: stored,
      auto_tests_created: autoCreated,
      details: { weights, underperformers: underperformers.length },
    });
    return { ok: true, signals: signals.length, conflicts: conflicts.length, hypotheses: stored, autoCreated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await svc.from("cross_loop_run_log").insert({
      user_id: userId, started_at: startedAt, completed_at: new Date().toISOString(),
      error_message: msg,
    });
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Optional user_id in body for on-demand run; else iterate all.
  let targetUserId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.user_id) targetUserId = String(body.user_id);
    }
  } catch (_) {}

  try {
    const users = targetUserId ? [targetUserId] : await listUsers(svc);
    const results: any[] = [];
    for (const uid of users) results.push({ user_id: uid, ...(await runForUser(svc, uid)) });

    return new Response(JSON.stringify({ ok: true, runs: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
