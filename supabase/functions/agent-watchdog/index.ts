// Agent 1 — Watchdog Agent.
//
// Phase 1: Manual trigger. Accepts a file upload, calls parse-invoice,
// classifies extracted products into auto-approved vs. flagged based on the
// supplier's confidence_score / correction_rate, writes an agent_runs row,
// and returns a summary the UI uses to render an in-app notification.
//
// Body shape:
//   {
//     trigger_type?: 'manual' | 'email' | 'scheduled',  // default 'manual'
//     supplier_profile_id?: string,                      // optional, looked up by name otherwise
//     supplier_name?: string,
//     file_base64: string,
//     file_name: string,
//     mime_type?: string,
//   }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRODUCT_CONFIDENCE_HIGH = 0.9; // per-product threshold for "auto-approved"

interface SupplierProfile {
  id: string;
  supplier_name: string;
  confidence_score: number | null;
  correction_rate: number | null;
  auto_publish_eligible: boolean | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  let runId: string | null = null;
  let admin = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const {
      trigger_type = "manual",
      supplier_profile_id,
      supplier_name,
      file_base64,
      file_name,
      mime_type,
    } = body ?? {};

    if (!file_base64 || !file_name) {
      return json({ error: "file_base64 and file_name are required" }, 400);
    }
    if (!["manual", "email", "scheduled"].includes(trigger_type)) {
      return json({ error: "invalid trigger_type" }, 400);
    }

    // Resolve supplier profile (optional)
    let profile: SupplierProfile | null = null;
    if (supplier_profile_id) {
      const { data } = await admin
        .from("supplier_profiles")
        .select("id, supplier_name, confidence_score, correction_rate, auto_publish_eligible")
        .eq("user_id", userId)
        .eq("id", supplier_profile_id)
        .maybeSingle();
      profile = (data as SupplierProfile) ?? null;
    } else if (supplier_name) {
      const { data } = await admin
        .from("supplier_profiles")
        .select("id, supplier_name, confidence_score, correction_rate, auto_publish_eligible")
        .eq("user_id", userId)
        .ilike("supplier_name", supplier_name)
        .maybeSingle();
      profile = (data as SupplierProfile) ?? null;
    }

    // Create the run row up-front so we have an audit even on failure
    const { data: runRow, error: runErr } = await admin
      .from("agent_runs")
      .insert({
        user_id: userId,
        trigger_type,
        supplier_name: profile?.supplier_name ?? supplier_name ?? null,
        supplier_profile_id: profile?.id ?? null,
        invoice_filename: file_name,
        status: "running",
        human_review_required: !(profile?.auto_publish_eligible ?? false),
      })
      .select("id")
      .single();

    if (runErr || !runRow) {
      return json({ error: `Could not create agent_runs row: ${runErr?.message}` }, 500);
    }
    runId = runRow.id;

    // Call parse-invoice
    const parseResp = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        fileContent: file_base64,
        fileName: file_name,
        fileType: mime_type ?? "application/pdf",
        supplierName: profile?.supplier_name ?? supplier_name ?? null,
      }),
    });

    if (!parseResp.ok) {
      const text = await parseResp.text();
      await admin
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: `parse-invoice ${parseResp.status}: ${text.slice(0, 500)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      return json({ error: "Parse failed", details: text }, 502);
    }

    const parseJson = await parseResp.json();
    const products: any[] = Array.isArray(parseJson?.products)
      ? parseJson.products
      : Array.isArray(parseJson?.data?.products)
        ? parseJson.data.products
        : [];

    // Classify products
    let autoApproved = 0;
    let flagged = 0;
    for (const p of products) {
      const conf = pickConfidence(p);
      if (conf >= PRODUCT_CONFIDENCE_HIGH) autoApproved++;
      else flagged++;
    }
    const total = products.length;

    // Resolve supplier name from parse output if it wasn't provided up-front.
    // Falls back through the common fields parse-invoice + product rows expose.
    const resolvedSupplierName: string | null =
      profile?.supplier_name ??
      parseJson?.supplier ??
      parseJson?.supplier_name ??
      parseJson?.data?.supplier ??
      parseJson?.data?.supplier_name ??
      products[0]?.vendor ??
      products[0]?.supplier ??
      products[0]?.supplier_name ??
      products[0]?.brand ??
      supplier_name ??
      null;

    // Determine final status
    const supplierEligible = !!profile?.auto_publish_eligible;
    const allAutoApproved = total > 0 && autoApproved === total;
    const status = total === 0
      ? "awaiting_review"
      : supplierEligible && allAutoApproved
        ? "awaiting_review" // still requires the merchant to tap "Auto-publish"
        : "awaiting_review";

    await admin
      .from("agent_runs")
      .update({
        supplier_name: resolvedSupplierName,
        products_extracted: total,
        products_auto_approved: autoApproved,
        products_flagged: flagged,
        human_review_required: !supplierEligible || flagged > 0,
        status,
        completed_at: new Date().toISOString(),
        metadata: {
          parse_summary: {
            document_type: parseJson?.document_type ?? null,
            layout: parseJson?.layout_type ?? null,
          },
        },
      })
      .eq("id", runId);

    return json({
      success: true,
      run_id: runId,
      supplier_name: resolvedSupplierName,
      products_extracted: total,
      products_auto_approved: autoApproved,
      products_flagged: flagged,
      auto_publish_available: supplierEligible && flagged === 0 && total > 0,
      supplier_confidence: profile?.confidence_score ?? null,
      products,
    });
  } catch (err) {
    console.error("[agent-watchdog] error", err);
    if (runId) {
      try {
        await admin
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: String(err?.message ?? err).slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      } catch (_) { /* swallow */ }
    }
    return json({ error: String(err?.message ?? err) }, 500);
  }
});

function pickConfidence(p: any): number {
  // Try common shapes the parser returns
  const candidates = [
    p?.confidence,
    p?.overall_confidence,
    p?.field_confidence?.overall,
    p?.scores?.overall,
  ];
  for (const c of candidates) {
    if (typeof c === "number") return c > 1 ? c / 100 : c;
  }
  return 0.5;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
