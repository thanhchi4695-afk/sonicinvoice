// ══════════════════════════════════════════════════════════
// reprocess-invoice
// Re-runs invoice extraction on the original uploaded file
// using the user's *current* (improved) supplier rules.
//
// Security:
//  - Caller must be authenticated.
//  - We verify the invoice_patterns row belongs to the caller
//    before downloading the file and replacing the metrics.
// ══════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const invoicePatternId: string | undefined = body?.invoice_pattern_id;
    if (!invoicePatternId || typeof invoicePatternId !== "string") {
      return new Response(JSON.stringify({ error: "invoice_pattern_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load + verify ownership of the invoice_patterns row.
    const { data: pattern, error: patternErr } = await supabase
      .from("invoice_patterns")
      .select(
        "id, user_id, supplier_profile_id, original_file_path, original_file_mime, original_filename, column_map, layout_fingerprint, format_type",
      )
      .eq("id", invoicePatternId)
      .eq("user_id", userId)
      .maybeSingle();

    if (patternErr || !pattern) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!pattern.original_file_path) {
      return new Response(
        JSON.stringify({
          error: "No original file stored for this invoice. Originals are only kept for invoices uploaded after re-processing was enabled.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Download the original file from storage.
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("invoice-originals")
      .download(pattern.original_file_path);
    if (dlErr || !fileBlob) {
      return new Response(JSON.stringify({ error: "Original file unavailable" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Convert to base64 + invoke parse-invoice with the current supplier rules.
    const arrayBuf = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    const base64 = btoa(binary);

    const parseResp = await supabase.functions.invoke("parse-invoice", {
      body: {
        file_base64: base64,
        file_mime: pattern.original_file_mime || "application/octet-stream",
        file_name: pattern.original_filename || "invoice",
        // Tell parse-invoice to use saved column map / fingerprint so it
        // benefits from the current (improved) rules.
        fingerprintMatch: pattern.layout_fingerprint
          ? {
              layout_fingerprint: pattern.layout_fingerprint,
              column_map: pattern.column_map || {},
              source: "fingerprint_match",
            }
          : undefined,
      },
    });

    if (parseResp.error) {
      return new Response(
        JSON.stringify({ error: `Re-extraction failed: ${parseResp.error.message || "unknown"}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Reset quality metrics on the existing pattern row — the user
    //    will review the re-extracted data fresh.
    await supabase
      .from("invoice_patterns")
      .update({
        match_method: "fingerprint_match",
        review_duration_seconds: null,
        edit_count: 0,
        rows_deleted: 0,
        rows_added: 0,
        processing_quality_score: null,
        fields_corrected: [],
        exported_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pattern.id);

    return new Response(
      JSON.stringify({
        success: true,
        invoice_pattern_id: pattern.id,
        extracted: parseResp.data || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("reprocess-invoice error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Re-process failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
