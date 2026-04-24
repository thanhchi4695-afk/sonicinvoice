// ──────────────────────────────────────────────────────────────
// drive-worker — Background runner invoked by pg_cron every ~30s.
// Claims up to BATCH_SIZE queued processing_queue rows where
// source='drive', downloads each file from Google Drive (handles
// the >25MB virus-scan interstitial), uploads to invoice-originals
// storage, and writes a stub invoice_patterns row with
// review_status='pending_review' so the user can find them in
// Processing History.
//
// Auth: this function expects to be called by pg_cron with the
// service-role key (or anon key — we use service role internally).
// No JWT required.
// ──────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5;
const MAX_FILE_BYTES = 15_000_000; // 15MB cap

async function downloadDriveFile(fileId: string): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  // Step 1: hit the public download endpoint
  const url1 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  let res = await fetch(url1, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
  let ct = res.headers.get("content-type") || "";

  // Step 2: handle the >25MB virus-scan interstitial
  if (ct.includes("text/html")) {
    const html = await res.text();
    const tokenMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
    const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
    if (tokenMatch && uuidMatch) {
      const confirmUrl = `${url1}&confirm=${tokenMatch[1]}&uuid=${uuidMatch[1]}`;
      res = await fetch(confirmUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
      ct = res.headers.get("content-type") || "";
    } else {
      throw new Error("Drive returned an interstitial page; file may not be public");
    }
  }

  if (!res.ok) {
    throw new Error(`Drive returned HTTP ${res.status}`);
  }
  if (ct.includes("text/html")) {
    throw new Error("Drive returned HTML — file is likely not shared as 'Anyone with the link'");
  }

  const dispo = res.headers.get("content-disposition") || "";
  const nameMatch = dispo.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)/i);
  const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : `drive_${fileId}`;

  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType: ct || "application/octet-stream", fileName };
}

function pickExtension(contentType: string, fallbackName: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const ext = fallbackName.split(".").pop()?.toLowerCase();
  if (ext && ["pdf", "png", "webp", "jpg", "jpeg"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "pdf";
}

interface QueueRow {
  id: string;
  user_id: string;
  drive_file_id: string | null;
  file_name: string;
  source_url: string | null;
}

async function processOne(admin: any, row: QueueRow): Promise<void> {
  if (!row.drive_file_id) {
    await admin.from("processing_queue").update({
      status: "failed",
      error: "missing drive_file_id",
      finished_at: new Date().toISOString(),
    }).eq("id", row.id);
    return;
  }

  try {
    const { bytes, contentType, fileName } = await downloadDriveFile(row.drive_file_id);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`File too large (${(bytes.byteLength / 1_000_000).toFixed(1)}MB > 15MB)`);
    }

    const ext = pickExtension(contentType, row.file_name || fileName);
    const safeName = (row.file_name || fileName).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const storagePath = `${row.user_id}/drive/${row.id}_${safeName}`;

    const { error: upErr } = await admin.storage
      .from("invoice-originals")
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (upErr) throw new Error(`storage: ${upErr.message}`);

    // Create a stub invoice_patterns row so it shows up in Processing History
    // as "pending review" — the user can open it to run the full extraction.
    const { data: pattern, error: patErr } = await admin
      .from("invoice_patterns")
      .insert({
        user_id: row.user_id,
        original_filename: row.file_name || fileName,
        original_file_path: storagePath,
        original_file_mime: contentType,
        review_status: "pending_review",
        match_method: "drive_import",
        sample_headers: [],
        column_map: {},
      })
      .select("id")
      .single();
    if (patErr) throw new Error(`pattern: ${patErr.message}`);

    await admin.from("processing_queue").update({
      status: "done",
      finished_at: new Date().toISOString(),
      pattern_id: pattern.id,
      storage_path: storagePath,
      file_size_bytes: bytes.byteLength,
    }).eq("id", row.id);

    console.log(`[drive-worker] ✓ ${row.file_name} → ${storagePath} (pattern ${pattern.id})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error(`[drive-worker] ✗ ${row.file_name}: ${msg}`);
    await admin.from("processing_queue").update({
      status: "failed",
      error: msg.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", row.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    // Claim up to BATCH_SIZE oldest queued drive items by flipping status
    // atomically. We do this with a SELECT … then UPDATE to mark them as
    // processing so concurrent worker runs don't double-process.
    const { data: candidates, error: selErr } = await admin
      .from("processing_queue")
      .select("id, user_id, drive_file_id, file_name, source_url")
      .eq("status", "queued")
      .eq("source", "drive")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (selErr) throw selErr;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "nothing to do" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = candidates.map((c) => c.id);
    const { data: claimed, error: claimErr } = await admin
      .from("processing_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        attempts: 1,
      })
      .in("id", ids)
      .eq("status", "queued") // optimistic: only update those still queued
      .select("id, user_id, drive_file_id, file_name, source_url");
    if (claimErr) throw claimErr;

    const claimedRows = (claimed || []) as QueueRow[];
    if (claimedRows.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "all candidates were taken" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run sequentially to keep memory low; drive downloads are I/O bound but
    // small batches keep us under the 50s function ceiling.
    const job = (async () => {
      for (const row of claimedRows) {
        await processOne(admin, row);
      }
    })();

    // Best-effort background work; respond immediately.
    // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    } else {
      await job;
    }

    return new Response(
      JSON.stringify({ processed: claimedRows.length, ids: claimedRows.map((r) => r.id) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("drive-worker error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "worker failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
