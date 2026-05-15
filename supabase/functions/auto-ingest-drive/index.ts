// auto-ingest-drive — parallel pipeline that pulls new PDFs from a configured
// Google Drive folder and writes one row per file into `invoice_uploads`
// (source='drive') + uploads the PDF to invoice-originals.
// Reuses the user's gmail_connections OAuth token (Google issues unified
// tokens; the Drive scope must have been granted at connect time).
// Body: { user_id?: string, max?: number }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function getAccessToken(userId: string): Promise<string | null> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: conn } = await admin
    .from("gmail_connections")
    .select("access_token, expires_at")
    .eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!conn) return null;
  const expiringSoon = !conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000;
  if (!expiringSoon) return conn.access_token;
  const refresh = await fetch(`${SUPABASE_URL}/functions/v1/gmail-refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!refresh.ok) return null;
  const { access_token } = await refresh.json();
  return access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const max = Math.min(Number(body?.max) || 25, 100);

    let userId: string | undefined = body?.user_id;
    if (!userId) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) {
        const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id;
      }
    }
    if (!userId) return json({ error: "user_id required" }, 401);

    const { data: settings } = await admin
      .from("auto_ingest_settings")
      .select("drive_enabled, drive_folder_id, drive_last_polled_at")
      .eq("user_id", userId).maybeSingle();
    if (!settings?.drive_enabled) return json({ skipped: true, reason: "drive disabled" });
    if (!settings.drive_folder_id) return json({ skipped: true, reason: "no folder configured" });

    const accessToken = await getAccessToken(userId);
    if (!accessToken) return json({ error: "no Google access token" }, 401);
    const gh = { Authorization: `Bearer ${accessToken}` };

    const since = settings.drive_last_polled_at;
    const qParts = [
      `'${settings.drive_folder_id}' in parents`,
      `mimeType='application/pdf'`,
      `trashed=false`,
    ];
    if (since) qParts.push(`modifiedTime > '${new Date(since).toISOString()}'`);
    const driveQ = qParts.join(" and ");

    const listUrl = `https://www.googleapis.com/drive/v3/files?` + new URLSearchParams({
      q: driveQ,
      pageSize: String(max),
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,size)",
    });
    const listRes = await fetch(listUrl, { headers: gh });
    if (!listRes.ok) return json({ error: "Drive list failed", status: listRes.status, body: (await listRes.text()).slice(0, 300) }, 502);
    const { files = [] } = await listRes.json() as { files?: Array<{ id: string; name: string; modifiedTime: string }> };

    const created: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const f of files) {
      try {
        const { data: existing } = await admin
          .from("invoice_uploads").select("id")
          .eq("user_id", userId).eq("source", "drive").eq("source_ref", f.id).maybeSingle();
        if (existing) { skipped.push(f.id); continue; }

        const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: gh });
        if (!dlRes.ok) { errors.push({ id: f.id, error: `download ${dlRes.status}` }); continue; }
        const bytes = new Uint8Array(await dlRes.arrayBuffer());

        const safeName = f.name.replace(/[^\w.\-]+/g, "_");
        const path = `${userId}/drive/${f.id}_${safeName}`;
        const up = await admin.storage.from("invoice-originals").upload(path, bytes, {
          contentType: "application/pdf", upsert: true,
        });
        if (up.error) { errors.push({ id: f.id, error: `upload ${up.error.message}` }); continue; }

        const { data: ins, error: insErr } = await admin.from("invoice_uploads").insert({
          user_id: userId,
          source: "drive",
          source_ref: f.id,
          original_filename: f.name,
          storage_bucket: "invoice-originals",
          storage_path: path,
          status: "pending",
          metadata: { drive_file_id: f.id, modified_time: f.modifiedTime },
        }).select("id").single();
        if (insErr) { errors.push({ id: f.id, error: insErr.message }); continue; }
        created.push(ins.id);
      } catch (e) {
        errors.push({ id: f.id, error: String((e as Error).message ?? e) });
      }
    }

    await admin.from("auto_ingest_settings")
      .update({ drive_last_polled_at: new Date().toISOString() })
      .eq("user_id", userId);

    return json({ ok: true, scanned: files.length, created: created.length, skipped: skipped.length, errors });
  } catch (err) {
    console.error("[auto-ingest-drive]", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
