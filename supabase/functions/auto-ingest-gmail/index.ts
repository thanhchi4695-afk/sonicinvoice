// auto-ingest-gmail — parallel pipeline that pulls invoice PDF attachments
// from the user's connected Gmail and writes one row per attachment into
// `invoice_uploads` (source='gmail') + uploads the PDF to invoice-originals.
// Body: { user_id?: string, max?: number }  (user_id required when called from cron)
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

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
  const std = pad.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Part = { mimeType?: string; filename?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };
function findPdfAttachments(part: Part | undefined): Array<{ filename: string; attachmentId: string }> {
  const out: Array<{ filename: string; attachmentId: string }> = [];
  if (!part) return out;
  const walk = (p: Part) => {
    if (p.body?.attachmentId && p.filename && /\.pdf$/i.test(p.filename)) {
      out.push({ filename: p.filename, attachmentId: p.body.attachmentId });
    }
    p.parts?.forEach(walk);
  };
  walk(part);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const max = Math.min(Number(body?.max) || 10, 25);

    // Resolve user_id: from body (cron) or from JWT
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

    // Settings
    const { data: settings } = await admin
      .from("auto_ingest_settings")
      .select("gmail_enabled, gmail_query")
      .eq("user_id", userId).maybeSingle();
    if (!settings?.gmail_enabled) return json({ skipped: true, reason: "gmail disabled" });
    const query = settings.gmail_query || "has:attachment filename:pdf (invoice OR receipt OR statement)";

    const accessToken = await getAccessToken(userId);
    if (!accessToken) return json({ error: "no Gmail access token" }, 401);
    const gh = { Authorization: `Bearer ${accessToken}` };

    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`;
    const listRes = await fetch(listUrl, { headers: gh });
    if (!listRes.ok) return json({ error: "Gmail list failed", status: listRes.status, body: (await listRes.text()).slice(0, 300) }, 502);
    const { messages = [] } = await listRes.json() as { messages?: Array<{ id: string }> };

    const created: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const m of messages) {
      try {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: gh });
        if (!msgRes.ok) { errors.push({ id: m.id, error: `get ${msgRes.status}` }); continue; }
        const msg = await msgRes.json();
        const headers = (msg.payload?.headers ?? []) as Array<{ name: string; value: string }>;
        const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value ?? "";
        const from = headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
        const dateHdr = headers.find(h => h.name.toLowerCase() === "date")?.value;
        const supplier = (from.match(/^(?:"?([^"<]+?)"?\s*)?(?:<([^>]+)>)?$/)?.[1] ?? from).trim();
        const invoiceDate = dateHdr ? new Date(dateHdr).toISOString().slice(0, 10) : null;
        const attachments = findPdfAttachments(msg.payload);
        if (attachments.length === 0) { skipped.push(m.id); continue; }

        for (const att of attachments) {
          const sourceRef = `${m.id}:${att.attachmentId}`;
          const { data: existing } = await admin
            .from("invoice_uploads").select("id")
            .eq("user_id", userId).eq("source", "gmail").eq("source_ref", sourceRef).maybeSingle();
          if (existing) { skipped.push(sourceRef); continue; }

          const aRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/attachments/${att.attachmentId}`, { headers: gh });
          if (!aRes.ok) { errors.push({ id: sourceRef, error: `att ${aRes.status}` }); continue; }
          const aJson = await aRes.json() as { data?: string };
          if (!aJson.data) { errors.push({ id: sourceRef, error: "no data" }); continue; }
          const bytes = b64urlToBytes(aJson.data);

          const safeName = att.filename.replace(/[^\w.\-]+/g, "_");
          const path = `${userId}/gmail/${m.id}_${att.attachmentId}_${safeName}`;
          const up = await admin.storage.from("invoice-originals").upload(path, bytes, {
            contentType: "application/pdf", upsert: true,
          });
          if (up.error) { errors.push({ id: sourceRef, error: `upload ${up.error.message}` }); continue; }

          const { data: ins, error: insErr } = await admin.from("invoice_uploads").insert({
            user_id: userId,
            source: "gmail",
            source_ref: sourceRef,
            original_filename: att.filename,
            storage_bucket: "invoice-originals",
            storage_path: path,
            supplier,
            invoice_date: invoiceDate,
            status: "pending",
            metadata: { gmail_message_id: m.id, subject, from },
          }).select("id").single();
          if (insErr) { errors.push({ id: sourceRef, error: insErr.message }); continue; }
          created.push(ins.id);
        }
      } catch (e) {
        errors.push({ id: m.id, error: String((e as Error).message ?? e) });
      }
    }

    await admin.from("auto_ingest_settings")
      .update({ gmail_last_polled_at: new Date().toISOString() })
      .eq("user_id", userId);

    return json({ ok: true, scanned: messages.length, created: created.length, skipped: skipped.length, errors });
  } catch (err) {
    console.error("[auto-ingest-gmail]", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
