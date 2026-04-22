// ──────────────────────────────────────────────────────────────
// drive-seed-one — Downloads + classifies a SINGLE Google Drive
// file by ID, then upserts the resulting structural template into
// BOTH the shared community pool and the caller's personal
// supplier_intelligence row. Designed to be called many times in
// parallel from the client (one request per selected file) so the
// UI can show per-file progress with no log diving.
//
// Body: { fileId: string, fileName?: string }
// Returns: { ok, supplier_name, detected_pattern, confidence, source }
// ──────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(name: string): string {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9 &-]/g, "");
}

function getFileType(mimeType: string, fileName: string): string | null {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const valid = ["pdf", "jpg", "jpeg", "png", "webp"];
  if (valid.includes(ext)) return ext === "jpg" ? "jpeg" : ext;
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpeg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return null;
}

async function downloadDriveFile(fileId: string): Promise<{ base64: string; mimeType: string; fileName: string }> {
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const resp = await fetch(downloadUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Could not download file ${fileId} (status ${resp.status})`);

  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const disposition = resp.headers.get("content-disposition") || "";
  const nameMatch = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)/i);
  const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : `file_${fileId}`;

  const buffer = await resp.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mimeType: contentType, fileName };
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

    const body = await req.json().catch(() => ({}));
    const fileId = String(body?.fileId || "").trim();
    const hintedName = body?.fileName ? String(body.fileName) : null;
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      return new Response(JSON.stringify({ error: "valid fileId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Download file
    const { base64, mimeType, fileName } = await downloadDriveFile(fileId);
    const displayName = hintedName || fileName;
    const fileType = getFileType(mimeType, fileName);
    if (!fileType) {
      return new Response(JSON.stringify({
        ok: false, fileName: displayName, error: `unsupported format (${mimeType})`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (base64.length > 13_500_000) {
      return new Response(JSON.stringify({
        ok: false, fileName: displayName, error: "file too large (>10MB)",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Classify via existing universal classifier
    const classifyResp = await fetch(`${supabaseUrl}/functions/v1/classify-invoice-pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ fileContent: base64, fileType, fileName: displayName }),
    });
    if (!classifyResp.ok) {
      const txt = await classifyResp.text();
      return new Response(JSON.stringify({
        ok: false, fileName: displayName, error: `classify failed (${classifyResp.status}): ${txt.slice(0, 120)}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const cdata = await classifyResp.json();
    const c = cdata.classification || {};
    const supplierName = String(c.supplier_name || "").trim();
    const confidence = Number(c.confidence) || 0;

    if (!supplierName || confidence < 50) {
      return new Response(JSON.stringify({
        ok: false, fileName: displayName,
        error: `low-confidence classification (${supplierName || "unknown supplier"}, ${confidence}%)`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const normalized = normalize(supplierName);
    const safeStructural = {
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

    const admin = createClient(supabaseUrl, serviceRole);

    // 3a) Upsert into shared pool
    const { data: existingShared } = await admin
      .from("shared_supplier_profiles")
      .select("id, total_invoices_processed")
      .eq("supplier_name_normalized", normalized)
      .maybeSingle();

    if (existingShared) {
      await admin.from("shared_supplier_profiles").update({
        ...safeStructural,
        total_invoices_processed: (existingShared.total_invoices_processed || 0) + 1,
        last_updated: new Date().toISOString(),
      }).eq("id", existingShared.id);
    } else {
      await admin.from("shared_supplier_profiles").insert({
        ...safeStructural,
        contributing_users: 1,
        total_invoices_processed: 1,
        avg_correction_rate: 0,
        confidence_score: 60,
        is_verified: false,
      });
    }

    // 3b) Upsert into THIS user's personal supplier_intelligence — so the
    //     next invoice from this supplier is recognised instantly.
    const personalSafe = {
      user_id: user.id,
      supplier_name: supplierName,
      column_map: c.column_map || {},
      detected_pattern: c.detected_pattern || null,
      gst_on_cost: c.gst_treatment === "ex" ? false : true,
      confidence_score: 70, // seeded from a known good template
      is_shared_origin: false,
      last_match_method: "drive_seed",
      last_invoice_date: new Date().toISOString(),
    };

    const { data: existingPersonal } = await admin
      .from("supplier_intelligence")
      .select("id, invoice_count, column_map")
      .eq("user_id", user.id)
      .ilike("supplier_name", supplierName)
      .maybeSingle();

    if (existingPersonal) {
      const mergedMap = {
        ...((existingPersonal.column_map as Record<string, string> | null) || {}),
        ...(c.column_map || {}),
      };
      await admin.from("supplier_intelligence").update({
        ...personalSafe,
        column_map: mergedMap,
        invoice_count: (existingPersonal.invoice_count || 0) + 1,
        confidence_score: Math.min(95, 70 + (existingPersonal.invoice_count || 0) * 2),
      }).eq("id", existingPersonal.id);
    } else {
      await admin.from("supplier_intelligence").insert({
        ...personalSafe,
        invoice_count: 1,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      fileName: displayName,
      supplier_name: supplierName,
      detected_pattern: c.detected_pattern || null,
      confidence,
      source: existingShared ? "shared_updated" : "shared_new",
      personal: existingPersonal ? "updated" : "created",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("drive-seed-one error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "seed failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
