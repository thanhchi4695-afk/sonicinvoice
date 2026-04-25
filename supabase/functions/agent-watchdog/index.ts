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

    // Two auth modes:
    //   (a) User JWT  → resolve userId via auth.getUser() (manual UI calls)
    //   (b) Service-role + X-User-Id header → trusted cron / scan-gmail-inbox
    let userId: string | null = null;
    const sidecarUser = req.headers.get("X-User-Id");
    if (sidecarUser && authHeader === `Bearer ${serviceKey}`) {
      userId = sidecarUser;
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return json({ error: "Not authenticated" }, 401);
      }
      userId = userData.user.id;
    }

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

    // Call the 3-stage pipeline (classify → extract → validate).
    // Falls back to plain parse-invoice automatically if Stage 1/3 fail.
    const parseResp = await fetch(`${supabaseUrl}/functions/v1/classify-extract-validate`, {
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

    // Debug — what shape did parse-invoice actually return?
    console.log("[agent-watchdog] parse keys:", Object.keys(parseJson || {}));
    if (products[0]) {
      console.log("[agent-watchdog] product[0] keys:", Object.keys(products[0]));
      console.log("[agent-watchdog] product[0].vendor:", products[0]?.vendor);
      console.log("[agent-watchdog] product[0].supplier:", products[0]?.supplier);
      console.log("[agent-watchdog] product[0].brand:", products[0]?.brand);
    }

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
    // Falls back through the common fields parse-invoice + product rows expose,
    // and finally tries to derive a supplier from the filename (e.g. "jantzen-ss25.pdf").
    const filenameSupplier = guessSupplierFromFilename(file_name);
    console.log("[agent-watchdog] product[0] sample:", JSON.stringify(products[0] ?? {}, null, 2)?.slice(0, 400));
    console.log("[agent-watchdog] parse supplier field:", parseJson?.supplier, "| filename guess:", filenameSupplier);

    const candidate: string | null =
      profile?.supplier_name ??
      parseJson?.supplier ??
      parseJson?.supplier_name ??
      parseJson?.data?.supplier ??
      parseJson?.data?.supplier_name ??
      products[0]?.vendor ??
      products[0]?.supplier ??
      products[0]?.supplier_name ??
      products[0]?.brand ??
      filenameSupplier ??
      supplier_name ??
      null;
    // Normalise empty strings to null so the UI shows "Unknown supplier"
    // rather than a blank, and the agent_runs row stores a real value.
    const resolvedSupplierName: string | null =
      typeof candidate === "string" && candidate.trim().length > 0
        ? candidate.trim()
        : null;
    console.log("[agent-watchdog] resolved supplier_name:", resolvedSupplierName);

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
          products,
        },
      })
      .eq("id", runId);

    // Phase 3 — Optionally auto-publish to Shopify when ALL of the following hold:
    //   - user.automation_auto_publish = true
    //   - supplier.auto_publish_eligible = true
    //   - products_flagged === 0 (clean extraction)
    let autoPublishedNow = false;
    let publishingResult: any = null;
    if (supplierEligible && flagged === 0 && total > 0) {
      const { data: settingsRow } = await admin
        .from("user_settings")
        .select("automation_auto_publish")
        .eq("user_id", userId)
        .maybeSingle();
      if (settingsRow?.automation_auto_publish) {
        try {
          const pubResp = await fetch(
            `${supabaseUrl}/functions/v1/publishing-agent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
                "X-User-Id": userId,
              },
              body: JSON.stringify({ run_id: runId, user_id: userId }),
            },
          );
          publishingResult = await pubResp.json().catch(() => ({}));
          autoPublishedNow = !!publishingResult?.published;
        } catch (e) {
          console.error("[agent-watchdog] auto-publish failed", e);
        }
      }
    }

    // Agent 3 — fire-and-forget enrichment for any products written to the
    // catalog during this run (auto-publish path or supplier-managed inserts).
    try {
      const { data: writtenProducts } = await admin
        .from("products")
        .select("id")
        .eq("user_id", userId)
        .gte("updated_at", runRow ? new Date(Date.now() - 5 * 60_000).toISOString() : new Date().toISOString())
        .order("updated_at", { ascending: false })
        .limit(Math.max(total, 1));
      const productIds = (writtenProducts || []).map((p: any) => p.id);
      if (productIds.length > 0) {
        fetch(`${supabaseUrl}/functions/v1/auto-enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ user_id: userId, product_ids: productIds, run_id: runId }),
        }).catch((e) => console.warn("[watchdog] enrich fire failed:", e?.message));
      }
    } catch (e) {
      console.warn("[watchdog] enrich query failed:", (e as Error)?.message);
    }

    return json({
      success: true,
      run_id: runId,
      supplier_name: resolvedSupplierName,
      products_extracted: total,
      products_auto_approved: autoApproved,
      products_flagged: flagged,
      auto_publish_available: supplierEligible && flagged === 0 && total > 0,
      auto_published: autoPublishedNow,
      publishing_result: publishingResult,
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

// Best-effort supplier guess from filename. Returns Title-cased brand name or null.
// Matches against a small list of common AU boutique brands; extend as needed.
function guessSupplierFromFilename(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const lower = fileName.toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/\bjantzen\b/, "Jantzen"],
    [/\bsea\s*level\b/, "Sea Level"],
    [/\btigerlily\b/, "Tigerlily"],
    [/\bseafolly\b/, "Seafolly"],
    [/\bbillabong\b/, "Billabong"],
    [/\brip\s*curl\b/, "Rip Curl"],
    [/\broxy\b/, "Roxy"],
    [/\bquiksilver\b/, "Quiksilver"],
    [/\bzimmermann\b/, "Zimmermann"],
    [/\bcamilla\b/, "Camilla"],
    [/\bspell\b/, "Spell"],
  ];
  for (const [rx, name] of known) {
    if (rx.test(lower)) return name;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
