// Phase 4 — Approve or reject an AI-Brain hypothesis.
// Approval is mandatory before any auto-generated A/B test is deployed.
// All actions are recorded in auto_test_audit for a full audit trail.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: claims, error: aerr } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
  if (aerr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.claims.sub as string;

  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const hypothesisId = String(body?.hypothesis_id ?? "");
  const action = String(body?.action ?? ""); // "approve" | "reject"
  const reason = body?.reason ? String(body.reason) : null;

  if (!hypothesisId || !["approve", "reject"].includes(action)) {
    return new Response(JSON.stringify({ error: "hypothesis_id and action ('approve'|'reject') required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Load hypothesis & verify ownership
  const { data: h, error: herr } = await svc.from("auto_test_hypotheses")
    .select("*").eq("id", hypothesisId).eq("user_id", userId).maybeSingle();
  if (herr || !h) {
    return new Response(JSON.stringify({ error: "Hypothesis not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (h.status !== "awaiting_approval" && h.status !== "pending") {
    return new Response(JSON.stringify({ error: `Cannot ${action} a hypothesis in status '${h.status}'` }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();

  if (action === "reject") {
    await svc.from("auto_test_hypotheses").update({
      status: "rejected", rejected_reason: reason, approved_by: userId, approved_at: now,
    }).eq("id", hypothesisId);
    await svc.from("auto_test_audit").insert({
      user_id: userId, hypothesis_id: hypothesisId, action: "rejected",
      actor: "merchant", actor_user_id: userId, snapshot: h, reason,
    });
    return new Response(JSON.stringify({ ok: true, status: "rejected" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // approve -> create the actual A/B test entry per hypothesis type
  let experimentId: string | null = null;
  try {
    if (h.hypothesis_type === "seo_title" || h.hypothesis_type === "meta_description" || h.hypothesis_type === "collection_description") {
      // Defer the heavy lifting to seo-ab-optimizer-start by inserting a queued experiment row directly.
      const proposal = (() => { try { return JSON.parse(h.proposed_value ?? "{}"); } catch { return { value: h.proposed_value }; } })();
      const { data: exp } = await svc.from("seo_ab_experiments").insert({
        user_id: userId,
        collection_id: h.target_id,
        variant_id: "auto-" + hypothesisId.slice(0, 8),
        seo_title: proposal.title ?? proposal.seo_title ?? null,
        meta_description: proposal.meta ?? proposal.meta_description ?? null,
        h1_tag: proposal.h1 ?? null,
        status: "queued",
      }).select("id").maybeSingle();
      experimentId = exp?.id ?? null;
    } else if (h.hypothesis_type === "discount_strategy") {
      const { data: exp } = await svc.from("discount_strategy_experiments").insert({
        user_id: userId,
        product_id: h.target_id,
        proposed_params: h.proposed_value,
        status: "queued",
      }).select("id").maybeSingle();
      experimentId = exp?.id ?? null;
    }
  } catch (e) {
    // Non-fatal — still mark as approved so merchant decision is recorded; orchestrator will retry.
    await svc.from("auto_test_audit").insert({
      user_id: userId, hypothesis_id: hypothesisId, action: "deploy_error",
      actor: "system", reason: e instanceof Error ? e.message : String(e), snapshot: h,
    });
  }

  await svc.from("auto_test_hypotheses").update({
    status: "testing",
    auto_created: true,
    approved_by: userId,
    approved_at: now,
    deployed_at: now,
    experiment_id: experimentId,
  }).eq("id", hypothesisId);

  await svc.from("auto_test_audit").insert([
    { user_id: userId, hypothesis_id: hypothesisId, action: "approved", actor: "merchant", actor_user_id: userId, snapshot: h, reason },
    { user_id: userId, hypothesis_id: hypothesisId, action: "deployed", actor: "system", snapshot: { experiment_id: experimentId, hypothesis_type: h.hypothesis_type, target_id: h.target_id, proposed_value: h.proposed_value } },
  ]);

  return new Response(JSON.stringify({ ok: true, status: "testing", experiment_id: experimentId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
