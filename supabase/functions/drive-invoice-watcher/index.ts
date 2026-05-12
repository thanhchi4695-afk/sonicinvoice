// Drive Invoice Watcher
// Cron-triggered. For each enabled drive_watch_settings row:
//   1. List recent files in the configured Drive folder via the connector gateway
//   2. Skip files already recorded in drive_ingested_files
//   3. Download each new file, base64 it, and forward to classify-extract-validate
//      using the service-role + X-User-Id sidecar pattern (impersonates the user)
//   4. Record the result in drive_ingested_files
//
// Triggered by pg_cron with header `x-cron-secret: <CRON_SECRET>` OR by an
// authenticated user requesting an immediate sync of their own folder.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY")!;

const DRIVE_GW = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

// Only these MIME types make sense as invoices.
const ALLOWED_MIMES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

interface WatchRow {
  id: string;
  user_id: string;
  folder_id: string;
  folder_name?: string | null;
  enabled: boolean;
  last_sync_at: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function driveFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${DRIVE_GW}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
      ...(init.headers || {}),
    },
  });
  return res;
}

async function listFolder(folderId: string, sinceIso: string | null): Promise<DriveFile[]> {
  // Build q clause
  const qParts = [`'${folderId}' in parents`, "trashed = false"];
  if (sinceIso) qParts.push(`modifiedTime > '${sinceIso}'`);
  const q = encodeURIComponent(qParts.join(" and "));
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size)");
  const url = `/files?q=${q}&fields=${fields}&pageSize=50&orderBy=modifiedTime`;
  const res = await driveFetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive list failed [${res.status}]: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.files || []) as DriveFile[];
}

async function downloadFileBase64(fileId: string): Promise<string> {
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive download failed [${res.status}]: ${txt.slice(0, 200)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  // Chunked base64 to avoid stack overflow on large files
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function getFolderName(folderId: string): Promise<string | null> {
  const fields = encodeURIComponent("id,name,mimeType");
  const res = await driveFetch(`/files/${folderId}?fields=${fields}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return typeof data?.name === "string" ? data.name : null;
}

async function processOneWatch(admin: any, watch: WatchRow): Promise<{ scanned: number; new: number; errors: number }> {
  const sinceIso = watch.last_sync_at;
  let scanned = 0;
  let added = 0;
  let errors = 0;

  const resolvedFolderName = await getFolderName(watch.folder_id).catch(() => null);
  if (resolvedFolderName && resolvedFolderName !== watch.folder_name) {
    await admin.from("drive_watch_settings").update({ folder_name: resolvedFolderName }).eq("id", watch.id);
  }

  let files: DriveFile[];
  try {
    files = await listFolder(watch.folder_id, sinceIso);
  } catch (err) {
    await admin.from("drive_watch_settings").update({
      last_error: err instanceof Error ? err.message : String(err),
    }).eq("id", watch.id);
    return { scanned: 0, new: 0, errors: 1 };
  }

  scanned = files.length;

  for (const file of files) {
    if (!ALLOWED_MIMES.has(file.mimeType)) continue;

    // Dedupe
    const { data: existing } = await admin
      .from("drive_ingested_files")
      .select("id")
      .eq("user_id", watch.user_id)
      .eq("drive_file_id", file.id)
      .maybeSingle();
    if (existing) continue;

    // Reserve the row first so concurrent runs don't double-process
    const { error: insertErr } = await admin.from("drive_ingested_files").insert({
      user_id: watch.user_id,
      folder_id: watch.folder_id,
      drive_file_id: file.id,
      drive_file_name: file.name,
      mime_type: file.mimeType,
      status: "processing",
    });
    if (insertErr) {
      // Likely unique-violation race — skip
      continue;
    }

    try {
      const base64 = await downloadFileBase64(file.id);

      // Call classify-extract-validate as the user (sidecar pattern).
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/classify-extract-validate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          "X-User-Id": watch.user_id,
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          fileContent: base64,
          fileName: file.name,
          fileType: file.mimeType,
          source: "google_drive_watcher",
          async: true,
        }),
      });

      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(`classify-extract-validate ${resp.status}: ${JSON.stringify(result).slice(0, 300)}`);
      }

      await admin.from("drive_ingested_files").update({
        status: "completed",
        parse_job_id: result?.jobId ?? result?.job_id ?? null,
      }).eq("user_id", watch.user_id).eq("drive_file_id", file.id).eq("folder_id", watch.folder_id);

      added += 1;
    } catch (err) {
      errors += 1;
      await admin.from("drive_ingested_files").update({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }).eq("user_id", watch.user_id).eq("drive_file_id", file.id).eq("folder_id", watch.folder_id);
    }
  }

  await admin.from("drive_watch_settings").update({
    last_sync_at: new Date().toISOString(),
    last_error: null,
    ...(resolvedFolderName ? { folder_name: resolvedFolderName } : {}),
  }).eq("id", watch.id);

  return { scanned, new: added, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const authBearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let dbCronSecret = "";
  if (cronHeader) {
    const { data: cfg } = await admin.from("cron_config").select("value").eq("key", "drive_watcher_secret").maybeSingle();
    dbCronSecret = (cfg as any)?.value || "";
  }
  const isCron =
    (!!CRON_SECRET && cronHeader === CRON_SECRET) ||
    (!!dbCronSecret && cronHeader === dbCronSecret) ||
    (!!SERVICE_KEY && authBearer === SERVICE_KEY);

  // Cron path: scan ALL enabled watch rows
  if (isCron) {
    const { data: rows, error } = await admin
      .from("drive_watch_settings")
      .select("id,user_id,folder_id,folder_name,enabled,last_sync_at")
      .eq("enabled", true);
    if (error) return jsonResponse({ error: error.message }, 500);

    const summary: Record<string, unknown>[] = [];
    for (const row of (rows || []) as WatchRow[]) {
      try {
        const r = await processOneWatch(admin, row);
        summary.push({ user_id: row.user_id, ...r });
      } catch (e) {
        summary.push({ user_id: row.user_id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return jsonResponse({ ok: true, watches: summary.length, summary });
  }

  // User path: authenticated user triggering an immediate sync of their own folder(s)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  // Optional: client may pass { folder_id } to sync just one folder; otherwise sync all enabled
  const body = await req.json().catch(() => ({} as any));
  const onlyFolderId: string | undefined = body?.folder_id;

  let q = admin
    .from("drive_watch_settings")
    .select("id,user_id,folder_id,folder_name,enabled,last_sync_at")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (onlyFolderId) q = q.eq("folder_id", onlyFolderId);
  const { data: rows, error: rowErr } = await q;
  if (rowErr) return jsonResponse({ error: rowErr.message }, 500);
  if (!rows || rows.length === 0) return jsonResponse({ error: "No drive watch configured" }, 404);

  // Run all in background to avoid request timeout
  // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime
  EdgeRuntime.waitUntil((async () => {
    for (const row of rows as WatchRow[]) {
      try { await processOneWatch(admin, row); }
      catch (e) { console.error("[drive-invoice-watcher] background error:", e); }
    }
  })());
  return jsonResponse({ ok: true, started: true, folders: rows.length, message: "Sync started in background. Refresh history in a minute." }, 202);
});
