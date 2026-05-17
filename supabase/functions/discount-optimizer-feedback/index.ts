// Records actual sales feedback for a product currently under variant assignment.
// Called by the sales-sync job (or manually) for products in the weekly test set.
//
// Payload: { product_id, units_sold, revenue, margin, discount_applied_pct, competitor_price? }
// Idempotent on (experiment_id, product_id, observation_date).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function weekStart(d = new Date()): string {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) {
    return new Response(JSON.stringify({ error: "Auth required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const productId: string | undefined = body?.product_id;
    if (!productId) {
      return new Response(JSON.stringify({ error: "product_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const ws = weekStart();
    const { data: assignment } = await svc
      .from("discount_variant_assignments")
      .select("variant_id, experiment_id")
      .eq("product_id", productId)
      .eq("test_week_start", ws)
      .maybeSingle();

    if (!assignment) {
      return new Response(JSON.stringify({ ok: true, skipped: "not in test set" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: baseline } = await svc
      .from("test_product_set_discount")
      .select("weekly_velocity_baseline")
      .eq("product_id", productId)
      .eq("test_week_start", ws)
      .maybeSingle();

    const { error } = await svc.from("discount_strategy_feedback").upsert(
      {
        experiment_id: assignment.experiment_id,
        variant_id: assignment.variant_id,
        product_id: productId,
        units_sold_during_test: Number(body.units_sold ?? 0),
        revenue_during_test: Number(body.revenue ?? 0),
        margin_during_test: Number(body.margin ?? 0),
        discount_applied_pct: Number(body.discount_applied_pct ?? 0),
        competitor_price_at_test: body.competitor_price != null ? Number(body.competitor_price) : null,
        baseline_velocity: baseline?.weekly_velocity_baseline ?? 0,
        observation_date: (body.observation_date as string) ?? new Date().toISOString().slice(0, 10),
      },
      { onConflict: "experiment_id,product_id,observation_date" },
    );
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, variant_id: assignment.variant_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
