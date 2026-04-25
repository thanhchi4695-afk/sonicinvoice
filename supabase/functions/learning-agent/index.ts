// Agent 5 — Learning Agent
// Runs after every accepted invoice. Updates the user's supplier_profiles
// row and contributes to the global shared_supplier_profiles network.
// Fire-and-forget from invoice-persistence.ts after persistParsedInvoice.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  user_id: string;
  supplier_name: string;
  document_id?: string | null;
  total_fields?: number; // optional — if omitted we estimate from document_lines
  correction_count?: number; // optional — if omitted we count from correction_log
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: ReqBody;
  try { body = await req.json(); } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { user_id, document_id } = body;
  const supplier_name = (body.supplier_name || "").trim();
  if (!user_id || !supplier_name) {
    return json({ error: "user_id and supplier_name required" }, 400);
  }
  console.log("[learning] start", { user_id, supplier_name, document_id });

  // ── Count corrections for this document if not supplied ───────────────
  let correctionCount = body.correction_count ?? 0;
  if (body.correction_count == null && document_id) {
    const { count } = await admin
      .from("correction_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .eq("invoice_id", document_id);
    correctionCount = count || 0;
  }

  // ── Estimate total_fields from document_lines if not supplied ─────────
  let totalFields = body.total_fields ?? 0;
  if (!totalFields && document_id) {
    const { count } = await admin
      .from("document_lines")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .eq("document_id", document_id);
    totalFields = (count || 0) * 6; // 6 key fields per line
  }
  if (totalFields <= 0) totalFields = Math.max(6, correctionCount * 6);

  const runCorrectionRate = Math.min(1, correctionCount / totalFields);
  console.log("[learning] rates", { correctionCount, totalFields, runCorrectionRate });

  // ── Step 1 — upsert user's supplier_profiles row ──────────────────────
  const { data: existingProfile } = await admin
    .from("supplier_profiles")
    .select("id, invoice_count, correction_rate")
    .eq("user_id", user_id)
    .ilike("supplier_name", supplier_name)
    .maybeSingle();

  let userInvoiceCount = 1;
  let userCorrectionRate = runCorrectionRate;
  let userConfidenceScore = 10;

  if (existingProfile?.id) {
    const prevCount = Number(existingProfile.invoice_count) || 0;
    const prevRate = Number(existingProfile.correction_rate) || 0;
    userInvoiceCount = prevCount + 1;
    userCorrectionRate = prevCount > 0
      ? (prevRate * prevCount + runCorrectionRate) / userInvoiceCount
      : runCorrectionRate;
    userConfidenceScore = Math.min(95, userInvoiceCount * 10);

    const { error: upErr } = await admin
      .from("supplier_profiles")
      .update({
        invoice_count: userInvoiceCount,
        correction_rate: userCorrectionRate,
        confidence_score: userConfidenceScore,
        auto_publish_eligible: userConfidenceScore >= 90 && userCorrectionRate <= 0.05,
        last_invoice_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingProfile.id);
    if (upErr) console.warn("[learning] supplier_profiles update failed:", upErr.message);
  } else {
    const { error: insErr } = await admin
      .from("supplier_profiles")
      .insert({
        user_id,
        supplier_name,
        invoice_count: 1,
        correction_rate: runCorrectionRate,
        confidence_score: 10,
        auto_publish_eligible: false,
        last_invoice_date: new Date().toISOString(),
      });
    if (insErr) console.warn("[learning] supplier_profiles insert failed:", insErr.message);
  }

  // ── Step 2 — contribute to shared_supplier_profiles ───────────────────
  const normalised = supplier_name.toLowerCase().trim();
  const { data: shared } = await admin
    .from("shared_supplier_profiles")
    .select("id, contributing_users, total_invoices_processed, avg_correction_rate, is_verified")
    .ilike("supplier_name", supplier_name)
    .maybeSingle();

  let sharedUpdated = false;
  let isVerified = false;

  if (shared?.id) {
    // Recompute contributing_users from supplier_profiles across all users
    const { data: contribRows } = await admin
      .from("supplier_profiles")
      .select("user_id")
      .ilike("supplier_name", supplier_name);
    const contributingUsers = new Set((contribRows || []).map((r: any) => r.user_id)).size || 1;

    const prevTotal = Number(shared.total_invoices_processed) || 0;
    const prevAvg = Number(shared.avg_correction_rate) || 0;
    const newTotal = prevTotal + 1;
    const newAvg = prevTotal > 0
      ? (prevAvg * prevTotal + runCorrectionRate) / newTotal
      : runCorrectionRate;
    const confidenceScore = Math.min(95, newTotal * 5);
    isVerified = contributingUsers >= 3 && newAvg <= 0.10 && newTotal >= 10;

    const wasVerified = shared.is_verified === true;

    const { error: shErr } = await admin
      .from("shared_supplier_profiles")
      .update({
        contributing_users: contributingUsers,
        total_invoices_processed: newTotal,
        avg_correction_rate: newAvg,
        confidence_score: confidenceScore,
        is_verified: isVerified,
        last_updated: new Date().toISOString(),
      })
      .eq("id", shared.id);
    if (shErr) console.warn("[learning] shared update failed:", shErr.message);
    else sharedUpdated = true;

    if (isVerified && !wasVerified) {
      console.log("[learning] supplier verified:", supplier_name,
        "contributing users:", contributingUsers,
        "avg correction rate:", newAvg);
    }
  } else {
    const { error: shInsErr } = await admin
      .from("shared_supplier_profiles")
      .insert({
        supplier_name,
        supplier_name_normalized: normalised,
        contributing_users: 1,
        total_invoices_processed: 1,
        avg_correction_rate: runCorrectionRate,
        confidence_score: 10,
        is_verified: false,
      });
    if (shInsErr) console.warn("[learning] shared insert failed:", shInsErr.message);
    else sharedUpdated = true;
  }

  const result = {
    supplier_name,
    user_invoice_count: userInvoiceCount,
    user_confidence_score: userConfidenceScore,
    user_correction_rate: userCorrectionRate,
    shared_profile_updated: sharedUpdated,
    is_verified: isVerified,
  };
  console.log("[learning] done", result);
  return json(result);
});
