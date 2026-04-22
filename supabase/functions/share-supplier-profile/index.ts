// ──────────────────────────────────────────────────────────────
// Privileged writer for shared_supplier_profiles
//
// Clients have no INSERT/UPDATE on the table — only this function
// (running with service-role) can contribute to the shared pool.
//
// Body:
//   {
//     supplier_name, supplier_abn, detected_pattern, column_map,
//     gst_treatment, has_rrp, sku_format, size_in_sku, colour_in_name,
//     correction_rate
//   }
//
// Privacy: this function explicitly strips any pricing / qty / row
// data even if the client accidentally sends it. Only the structural
// template is persisted.
// ──────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(name: string): string {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 &-]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) Validate caller is signed in (use anon client just to read the JWT)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Check user opted in to share
    const admin = createClient(supabaseUrl, serviceRole);
    const { data: settings } = await admin
      .from("user_brain_settings")
      .select("contribute_shared")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settings && settings.contribute_shared === false) {
      return new Response(JSON.stringify({ skipped: "user opted out" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const supplier_name = String(body.supplier_name || "").trim();
    if (!supplier_name) {
      return new Response(JSON.stringify({ error: "supplier_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = normalize(supplier_name);

    // 3) Strip to ONLY structural fields — never persist business data
    const safe = {
      supplier_name,
      supplier_name_normalized: normalized,
      supplier_abn: body.supplier_abn || null,
      detected_pattern: body.detected_pattern || null,
      column_map: body.column_map || {},
      gst_treatment: body.gst_treatment || null,
      has_rrp: !!body.has_rrp,
      sku_format: body.sku_format || null,
      size_in_sku: !!body.size_in_sku,
      colour_in_name: !!body.colour_in_name,
    };

    // 4) Upsert: bump counters, recompute averages
    const { data: existing } = await admin
      .from("shared_supplier_profiles")
      .select("id, contributing_users, total_invoices_processed, avg_correction_rate")
      .eq("supplier_name_normalized", normalized)
      .maybeSingle();

    const correctionRate = Number(body.correction_rate) || 0;

    if (existing) {
      const newTotal = (existing.total_invoices_processed || 0) + 1;
      const newAvg = existing.avg_correction_rate == null
        ? correctionRate
        : ((Number(existing.avg_correction_rate) * (newTotal - 1)) + correctionRate) / newTotal;
      const verified = newTotal >= 3 && newAvg < 0.10;

      await admin.from("shared_supplier_profiles").update({
        ...safe,
        total_invoices_processed: newTotal,
        avg_correction_rate: newAvg,
        confidence_score: Math.max(50, Math.round(100 - newAvg * 100)),
        is_verified: verified,
        last_updated: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await admin.from("shared_supplier_profiles").insert({
        ...safe,
        contributing_users: 1,
        total_invoices_processed: 1,
        avg_correction_rate: correctionRate,
        confidence_score: 60,
        is_verified: false,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("share-supplier-profile error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "share failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
