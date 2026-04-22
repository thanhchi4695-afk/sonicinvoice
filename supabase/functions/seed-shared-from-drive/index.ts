// ──────────────────────────────────────────────────────────────
// One-off seeder: pulls a Google Drive folder of sample invoices,
// classifies each through the universal classifier, then writes
// anonymised structural templates into shared_supplier_profiles.
//
// Privacy: never stores prices, qty, customer data — ONLY the
// column_map + pattern + GST treatment + sku/colour flags.
//
// Body: { url: "<drive folder or file url>" }
// Returns: { processed, seeded, errors[] }
// ──────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(name: string): string {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 &-]/g, "");
}

interface DriveInvoice {
  fileName: string;
  base64: string;
  fileType: string;
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Fetch invoices via existing gdrive-fetch function
    const driveResp = await fetch(`${supabaseUrl}/functions/v1/gdrive-fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!driveResp.ok) {
      const txt = await driveResp.text();
      throw new Error(`gdrive-fetch failed [${driveResp.status}]: ${txt.slice(0, 200)}`);
    }

    const driveData = await driveResp.json();
    const invoices: DriveInvoice[] = driveData.invoices || [];

    if (invoices.length === 0) {
      return new Response(JSON.stringify({
        processed: 0, seeded: 0,
        errors: ["No invoices returned from Drive folder"],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceRole);

    // Process one invoice end-to-end (classify + upsert).
    const processInvoice = async (inv: DriveInvoice): Promise<{ ok: boolean; msg?: string }> => {
      try {
        const classifyResp = await fetch(`${supabaseUrl}/functions/v1/classify-invoice-pattern`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            fileContent: inv.base64,
            fileType: inv.fileType,
            fileName: inv.fileName,
          }),
        });

        if (!classifyResp.ok) {
          const txt = await classifyResp.text();
          return { ok: false, msg: `${inv.fileName}: classify failed (${classifyResp.status}) ${txt.slice(0, 120)}` };
        }

        const cdata = await classifyResp.json();
        const c = cdata.classification || {};
        const supplierName = String(c.supplier_name || "").trim();

        if (!supplierName || (Number(c.confidence) || 0) < 50) {
          return { ok: false, msg: `${inv.fileName}: low-confidence classification (skipped)` };
        }

        const normalized = normalize(supplierName);
        const safe = {
          supplier_name: supplierName,
          supplier_name_normalized: normalized,
          supplier_abn: c.supplier_abn || null,
          detected_pattern: c.detected_pattern || null,
          column_map: c.column_map || {},
          gst_treatment: c.gst_treatment || null,
          has_rrp: !!c.has_rrp,
          sku_format: c.sku_format || null,
          size_in_sku: !!c.size_in_sku,
          colour_in_name: !!c.colour_in_name,
        };

        const { data: existing } = await admin
          .from("shared_supplier_profiles")
          .select("id, total_invoices_processed, avg_correction_rate")
          .eq("supplier_name_normalized", normalized)
          .maybeSingle();

        if (existing) {
          const newTotal = (existing.total_invoices_processed || 0) + 1;
          await admin.from("shared_supplier_profiles").update({
            ...safe,
            total_invoices_processed: newTotal,
            last_updated: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await admin.from("shared_supplier_profiles").insert({
            ...safe,
            contributing_users: 1,
            total_invoices_processed: 1,
            avg_correction_rate: 0,
            confidence_score: 60,
            is_verified: false,
          });
        }

        console.log(`[seed] ✓ ${inv.fileName} → ${supplierName}`);
        return { ok: true };
      } catch (e) {
        return { ok: false, msg: `${inv.fileName}: ${e instanceof Error ? e.message : "unknown error"}` };
      }
    };

    // Run all invoices in parallel in the BACKGROUND so we can return immediately
    // and avoid the HTTP gateway timeout.
    const backgroundJob = (async () => {
      console.log(`[seed] starting background processing of ${invoices.length} invoices`);
      const results = await Promise.all(invoices.map(processInvoice));
      const seeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).map((r) => r.msg).filter(Boolean);
      console.log(`[seed] done — seeded ${seeded}/${invoices.length}`);
      if (failed.length) console.log(`[seed] errors:`, failed);
    })();

    // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob);
    }

    return new Response(JSON.stringify({
      accepted: true,
      processed: invoices.length,
      message: `Seeding ${invoices.length} invoices in the background. Check edge function logs for progress.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("seed-shared-from-drive error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "seed failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
