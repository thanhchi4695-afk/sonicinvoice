// Karpathy Loop nightly prompt optimizer.
// 1) Reads the active variant for `collection_description`
// 2) Asks an LLM to generate 5–7 small variants
// 3) Inserts them inactive
// 4) Refreshes a held-constant 50-product test set weekly
// 5) For each variant × product, generates a draft `collection_suggestions`
//    row tagged with `prompt_variant_id` so merchants see them in the queue
//
// Promotion happens in `prompt-optimizer-evaluator`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const TEST_SET_SIZE = 50;
const VARIANTS_PER_RUN = 6;
const DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function weekStart(d = new Date()) {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // back to Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Optional auth: cron secret OR admin JWT. If neither matches and CRON_SECRET is set, reject.
  const provided = req.headers.get("x-cron-secret") ?? "";
  const userJwt = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && provided !== CRON_SECRET && !userJwt) {
    return new Response(JSON.stringify({ error: "Unauthorised" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const logInsert = await svc
    .from("prompt_optimizer_log")
    .insert({ experiment_type: "collection_description", run_started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = logInsert.data?.id;

  try {
    // 1) Active variant
    const { data: active, error: actErr } = await svc
      .from("prompt_experiments")
      .select("*")
      .eq("experiment_type", "collection_description")
      .eq("is_active", true)
      .order("promoted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (actErr) throw actErr;
    if (!active) throw new Error("No active prompt for collection_description (seed v0 missing)");

    // 2) Generate variants
    const sys = "You are a prompt engineering expert. Output STRICT JSON only.";
    const userPrompt = `Generate ${VARIANTS_PER_RUN} variations of the prompt below.
Each variation must make a SMALL change to ONE of: temperature (0.1–1.0), few_shot_examples (0–3), or instruction phrasing.
Return JSON: {"variants":[{"variant_id":"v1","prompt_template":"...","temperature":0.5,"few_shot_examples":[]}]}

ORIGINAL:
${active.prompt_template}`;

    const aiResp = await callAI({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 6000,
    });
    let parsedVariants: Array<{
      variant_id: string;
      prompt_template: string;
      temperature?: number;
      few_shot_examples?: unknown[];
    }> = [];
    try {
      const txt = getContent(aiResp).replace(/^```json\s*|\s*```$/g, "");
      const json = JSON.parse(txt);
      parsedVariants = Array.isArray(json?.variants) ? json.variants : [];
    } catch (e) {
      console.error("Variant JSON parse failed:", e);
    }
    if (parsedVariants.length === 0) {
      throw new Error("LLM returned no parseable variants");
    }

    // 3) Insert variants (uniquify variant_id by appending timestamp suffix)
    const stamp = Date.now().toString(36);
    const inserted: { id: string; variant_id: string; prompt_template: string; temperature: number }[] = [];
    for (let i = 0; i < parsedVariants.length; i++) {
      const v = parsedVariants[i];
      const variantId = `${v.variant_id || `v${i + 1}`}-${stamp}`;
      const { data: row, error } = await svc
        .from("prompt_experiments")
        .insert({
          experiment_type: "collection_description",
          variant_id: variantId,
          prompt_template: v.prompt_template,
          temperature: typeof v.temperature === "number" ? v.temperature : 0.7,
          few_shot_examples: v.few_shot_examples ?? [],
          parent_variant_id: active.variant_id,
          is_active: false,
        })
        .select("id, variant_id, prompt_template, temperature")
        .single();
      if (error) {
        console.error("Variant insert failed:", error);
        continue;
      }
      inserted.push(row as any);
    }

    // 4) Test product set — refresh weekly
    const ws = weekStart();
    const { count: existing } = await svc
      .from("test_product_set")
      .select("id", { count: "exact", head: true })
      .eq("set_week", ws);
    if (!existing) {
      const { data: products } = await svc
        .from("collection_suggestions")
        .select("id, suggested_title")
        .neq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(TEST_SET_SIZE * 4);
      const pick = (products ?? []).slice(0, TEST_SET_SIZE);
      if (pick.length > 0) {
        await svc.from("test_product_set").insert(
          pick.map((p, idx) => ({
            set_week: ws,
            product_id: p.id,
            position: idx,
            metadata: { title: (p as any).suggested_title ?? null },
          })),
        );
      }
    }

    // 5) For brevity in Phase 1 we record the variant set but do NOT pre-generate
    //    50×N draft suggestions here — that would blow the function timeout.
    //    Instead, `seo-collection-engine` will rotate variants for incoming requests
    //    via the active-variants pool, and feedback flows back through the trigger.
    //    Phase 2 can add a queued batch generator.

    await svc
      .from("prompt_optimizer_log")
      .update({
        run_completed_at: new Date().toISOString(),
        experiments_ran: inserted.length,
        notes: { inserted_variant_ids: inserted.map((v) => v.variant_id), test_set_week: ws },
      })
      .eq("id", runId!);

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, variants_inserted: inserted.length, test_set_week: ws }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("prompt-optimizer-cron error:", msg);
    if (runId) {
      await svc
        .from("prompt_optimizer_log")
        .update({ run_completed_at: new Date().toISOString(), error_message: msg })
        .eq("id", runId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
