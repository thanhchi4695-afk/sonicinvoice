// parse-invoice-silent — Silent training pipeline.
//
// HARD GUARANTEE: This function NEVER writes to public.invoices,
// public.parse_jobs, public.products, or any live data table.
// It only writes to: training_parses, training_logs, brand_patterns.
//
// Input (service-role only): { found_invoice_id: uuid, attachment_index?: number }
// Called by: silent-training-dispatcher (cron) and admin "Run silent parse now" button.

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.155";
import { decryptString } from "../_shared/imap-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const ENV_CRON_SECRET = Deno.env.get("CRON_SECRET");
let CACHED_CRON_SECRET: string | null = null;
async function getCronSecret(admin: any): Promise<string | null> {
  if (CACHED_CRON_SECRET) return CACHED_CRON_SECRET;
  if (ENV_CRON_SECRET) { CACHED_CRON_SECRET = ENV_CRON_SECRET; return CACHED_CRON_SECRET; }
  try {
    const { data } = await admin.rpc("get_cron_secret");
    if (typeof data === "string" && data.length > 0) { CACHED_CRON_SECRET = data; return data; }
  } catch { /* */ }
  return null;
}

const SILENT_MODEL = "google/gemini-2.5-flash";
const SILENT_FALLBACK_MODEL = "google/gemini-2.5-pro";

const SILENT_PROMPT = `You are an invoice training parser. Analyze this invoice/PO/packing slip and return STRICT JSON. No markdown, no commentary.

{
  "supplier": string | null,
  "document_type": "tax_invoice" | "purchase_order" | "packing_slip" | "credit_note" | "receipt" | "unknown",
  "invoice_date": "YYYY-MM-DD" | null,
  "currency": string | null,
  "fields_detected": [string],
  "products": [
    {
      "product_name": string | null,
      "style_number": string | null,
      "colour": string | null,
      "size": string | null,
      "quantity": number | null,
      "cost_price": number | null,
      "rrp": number | null,
      "barcode": string | null
    }
  ],
  "confidence": number
}

confidence is 0.0–1.0. Be honest; if you cannot extract products, return [] and a low confidence.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: any = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: either CRON_SECRET (env or vault) OR service-role bearer
  const authHeader = req.headers.get("authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const cronSecret = await getCronSecret(admin);
  const isAuthorized =
    (cronSecret && cronHeader === cronSecret) ||
    authHeader === `Bearer ${SERVICE_KEY}`;
  if (!isAuthorized) return json({ error: "Unauthorized" }, 401);


  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const foundInvoiceId: string | undefined = body?.found_invoice_id;
  const attachmentIndex: number = Number.isFinite(body?.attachment_index) ? body.attachment_index : 0;
  if (!foundInvoiceId) return json({ error: "found_invoice_id required" }, 400);

  // 1. Load discovered email
  const { data: found, error: foundErr } = await admin
    .from("gmail_found_invoices")
    .select("*")
    .eq("id", foundInvoiceId)
    .maybeSingle();
  if (foundErr || !found) return json({ error: "found_invoice not found" }, 404);

  // 2. Kill switch
  const { data: settings } = await admin
    .from("app_settings")
    .select("training_pipeline_enabled, daily_silent_parse_cap")
    .eq("singleton", true)
    .maybeSingle();
  if (!settings?.training_pipeline_enabled) {
    return json({ skipped: "training_pipeline_disabled" });
  }
  const dailyCap: number = settings.daily_silent_parse_cap ?? 500;

  // 3. Daily cap (workspace-wide today)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await admin
    .from("training_parses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  if ((todayCount ?? 0) >= dailyCap) {
    await markFound(admin, foundInvoiceId, "capped", "daily cap reached");
    return json({ skipped: "daily_cap_reached", todayCount });
  }

  // 4. Pick attachment
  const attachments: any[] = Array.isArray(found.attachments) ? found.attachments : [];
  const att = attachments[attachmentIndex];
  if (!att) {
    await markFound(admin, foundInvoiceId, "skipped", "no attachment");
    return json({ skipped: "no_attachment" });
  }

  await admin.from("gmail_found_invoices").update({
    silent_attempt_count: (found.silent_attempt_count ?? 0) + 1,
  }).eq("id", foundInvoiceId);

  try {
    // 5. Brand backoff check (sender domain → brand_pattern)
    const senderDomain = (found.from_email ?? "").toLowerCase().split("@")[1] ?? "";
    const candidateBrand = found.supplier_name ?? null;
    if (candidateBrand) {
      const { data: pattern } = await admin
        .from("brand_patterns")
        .select("id, paused_until, failed_streak")
        .eq("user_id", found.user_id)
        .ilike("brand_name", candidateBrand)
        .maybeSingle();
      if (pattern?.paused_until && new Date(pattern.paused_until) > new Date()) {
        await markFound(admin, foundInvoiceId, "skipped", `brand paused until ${pattern.paused_until}`);
        return json({ skipped: "brand_backoff", until: pattern.paused_until });
      }
    }

    // 6. Fetch attachment bytes
    const fetched = await fetchAttachment(admin, found, att);
    if (!fetched?.bytes?.byteLength) throw new Error("attachment fetch returned empty");
    const fileBytes = fetched.bytes;
    const emailAccount = fetched.emailAccount;

    // 7. SHA-256 dedup
    const sha = await sha256Hex(fileBytes);

    const { data: existing } = await admin
      .from("training_parses")
      .select("id")
      .eq("email_message_id", found.message_id)
      .eq("attachment_filename", att.filename)
      .eq("attachment_sha256", sha)
      .maybeSingle();
    if (existing) {
      await markFound(admin, foundInvoiceId, "duplicate", "sha256 already in training_parses");
      return json({ skipped: "duplicate", training_parse_id: existing.id });
    }

    // 8. Call AI silently
    const fileBase64 = bytesToBase64(fileBytes);
    const mime = att.mime_type || guessMime(att.filename);
    const aiResult = await callSilentAI(fileBase64, mime, att.filename);

    // 9. Insert training_parses row (NEVER live invoices)
    const brandDetected: string | null = aiResult.supplier ?? candidateBrand;
    const insertRow: any = {
      user_id: found.user_id,
      mailbox_provider: found.provider,
      mailbox_connection_id: found.connection_id,
      email_account: emailAccount,
      sender_domain: senderDomain || null,
      email_message_id: found.message_id,
      attachment_filename: att.filename,
      attachment_sha256: sha,
      attachment_mime: mime,
      attachment_bytes: fileBytes.byteLength,
      brand_detected: brandDetected,
      invoice_date: aiResult.invoice_date ?? null,
      document_type: aiResult.document_type ?? "unknown",
      products_extracted: aiResult.products ?? [],
      parse_confidence: aiResult.confidence ?? 0,
      fields_detected: aiResult.fields_detected ?? [],
      raw_text: null,
      parse_status: (aiResult.products?.length ?? 0) > 0 ? "ok" : "low_signal",
      error_message: null,
    };
    const { data: tpRow, error: tpErr } = await admin
      .from("training_parses")
      .insert(insertRow)
      .select("id")
      .single();
    if (tpErr) throw new Error(`training_parses insert failed: ${tpErr.message}`);

    // 10. Update brand_patterns counters
    if (brandDetected) {
      await upsertBrandPattern(admin, found.user_id, brandDetected, senderDomain, aiResult.confidence ?? 0, true);
    }

    // 11. Mark email row as silently processed
    await markFound(admin, foundInvoiceId, "ok", null);

    // 12. Log success
    await admin.from("training_logs").insert({
      user_id: found.user_id,
      mailbox_connection_id: found.connection_id,
      event_type: "silent_parse_ok",
      brand_name: brandDetected,
      severity: "info",
      message: `Silent parse ok: ${att.filename}`,
      metadata: { training_parse_id: tpRow.id, products: aiResult.products?.length ?? 0, confidence: aiResult.confidence },
    });

    return json({ ok: true, training_parse_id: tpRow.id, products: aiResult.products?.length ?? 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFound(admin, foundInvoiceId, "error", msg);

    // Increment failed streak on brand & maybe backoff 24h
    const candidateBrand = found.supplier_name ?? null;
    if (candidateBrand) {
      await incrementFailedStreak(admin, found.user_id, candidateBrand);
    }
    await admin.from("training_logs").insert({
      user_id: found.user_id,
      mailbox_connection_id: found.connection_id,
      event_type: "silent_parse_error",
      brand_name: candidateBrand,
      severity: "warn",
      message: msg.slice(0, 500),
      metadata: { found_invoice_id: foundInvoiceId, filename: att?.filename ?? null },
    });
    return json({ error: msg }, 200); // 200 so dispatcher doesn't retry hard
  }
});

// ─────────────────────────── helpers ───────────────────────────

async function markFound(admin: any, id: string, status: string, err: string | null) {
  await admin.from("gmail_found_invoices").update({
    silent_processed_at: new Date().toISOString(),
    silent_status: status,
    silent_last_error: err,
  }).eq("id", id);
}

async function upsertBrandPattern(
  admin: any, userId: string, brandName: string, senderDomain: string,
  confidence: number, success: boolean,
) {
  const { data: existing } = await admin
    .from("brand_patterns")
    .select("id, sample_count, avg_confidence, sender_domains, failed_streak")
    .eq("user_id", userId)
    .ilike("brand_name", brandName)
    .maybeSingle();

  if (existing) {
    const newCount = (existing.sample_count ?? 0) + 1;
    const oldAvg = Number(existing.avg_confidence ?? 0);
    const newAvg = (oldAvg * (existing.sample_count ?? 0) + confidence) / newCount;
    const domains: string[] = Array.isArray(existing.sender_domains) ? existing.sender_domains : [];
    if (senderDomain && !domains.includes(senderDomain)) domains.push(senderDomain);
    await admin.from("brand_patterns").update({
      sample_count: newCount,
      avg_confidence: Number(newAvg.toFixed(3)),
      sender_domains: domains,
      last_seen_at: new Date().toISOString(),
      failed_streak: success ? 0 : existing.failed_streak,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await admin.from("brand_patterns").insert({
      user_id: userId,
      brand_name: brandName,
      sample_count: 1,
      avg_confidence: Number(confidence.toFixed(3)),
      sender_domains: senderDomain ? [senderDomain] : [],
      last_seen_at: new Date().toISOString(),
      failed_streak: 0,
      is_global: false,
    });
  }
}

async function incrementFailedStreak(admin: any, userId: string, brandName: string) {
  const { data: existing } = await admin
    .from("brand_patterns")
    .select("id, failed_streak")
    .eq("user_id", userId)
    .ilike("brand_name", brandName)
    .maybeSingle();
  const newStreak = (existing?.failed_streak ?? 0) + 1;
  const update: any = { failed_streak: newStreak, updated_at: new Date().toISOString() };
  if (newStreak >= 3) {
    update.paused_until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  }
  if (existing) {
    await admin.from("brand_patterns").update(update).eq("id", existing.id);
  } else {
    await admin.from("brand_patterns").insert({
      user_id: userId, brand_name: brandName, failed_streak: newStreak,
      paused_until: update.paused_until ?? null, sample_count: 0, avg_confidence: 0,
    });
  }
}

// ─────────────────────────── attachment fetch ───────────────────────────

async function fetchAttachment(admin: any, found: any, att: any): Promise<{ bytes: Uint8Array; emailAccount: string | null }> {
  const provider = found.provider as string;
  if (provider === "gmail") return fetchGmail(admin, found, att);
  if (provider === "outlook") return fetchOutlook(admin, found, att);
  if (provider === "imap") return fetchImap(admin, found, att);
  throw new Error(`unsupported provider: ${provider}`);
}

async function loadGmailConn(admin: any, found: any) {
  // Try by connection_id first; fall back to user's active gmail conn (legacy rows)
  if (found.connection_id) {
    const { data } = await admin.from("gmail_connections")
      .select("id, email_address, access_token, refresh_token, expires_at")
      .eq("id", found.connection_id).maybeSingle();
    if (data) return data;
  }
  const { data } = await admin.from("gmail_connections")
    .select("id, email_address, access_token, refresh_token, expires_at")
    .eq("user_id", found.user_id).eq("is_active", true).limit(1).maybeSingle();
  return data;
}

async function fetchGmail(admin: any, found: any, att: any) {
  const conn = await loadGmailConn(admin, found);
  if (!conn) throw new Error("gmail connection not found");
  let token = conn.access_token;
  const expMs = new Date(conn.expires_at).getTime();
  if (Number.isFinite(expMs) && expMs - Date.now() < 5 * 60 * 1000) {
    token = await refreshGoogle(admin, conn.id, conn.refresh_token);
  }
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(found.message_id)}/attachments/${encodeURIComponent(att.attachment_id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`gmail attachment fetch ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json() as { data?: string };
  if (!j.data) throw new Error("gmail attachment empty");
  return { bytes: base64UrlToBytes(j.data), emailAccount: conn.email_address ?? null };
}

async function refreshGoogle(admin: any, connId: string, refreshToken: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`google refresh failed: ${await r.text()}`);
  const t = await r.json() as { access_token: string; expires_in: number };
  await admin.from("gmail_connections").update({
    access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString(),
  }).eq("id", connId);
  return t.access_token;
}

async function fetchOutlook(admin: any, found: any, att: any) {
  let conn: any = null;
  if (found.connection_id) {
    const { data } = await admin.from("outlook_connections")
      .select("id, email_address, access_token, refresh_token, expires_at")
      .eq("id", found.connection_id).maybeSingle();
    conn = data;
  }
  if (!conn) {
    const { data } = await admin.from("outlook_connections")
      .select("id, email_address, access_token, refresh_token, expires_at")
      .eq("user_id", found.user_id).eq("is_active", true).limit(1).maybeSingle();
    conn = data;
  }
  if (!conn) throw new Error("outlook connection not found");
  let token = conn.access_token;
  const expMs = new Date(conn.expires_at).getTime();
  if (Number.isFinite(expMs) && expMs - Date.now() < 5 * 60 * 1000) {
    const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
        client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
        scope: "offline_access User.Read Mail.Read",
      }),
    });
    if (!r.ok) throw new Error(`outlook refresh failed: ${(await r.text()).slice(0, 160)}`);
    const t = await r.json() as { access_token: string; refresh_token?: string; expires_in: number };
    token = t.access_token;
    await admin.from("outlook_connections").update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? conn.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString(),
    }).eq("id", conn.id);
  }
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${found.message_id}/attachments/${att.attachment_id}/$value`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`outlook attachment fetch ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), emailAccount: conn.email_address ?? null };
}

async function fetchImap(admin: any, found: any, att: any) {
  let conn: any = null;
  if (found.connection_id) {
    const { data } = await admin.from("imap_connections")
      .select("id, email_address, imap_host, imap_port, imap_tls, imap_username, password_encrypted, password_iv")
      .eq("id", found.connection_id).maybeSingle();
    conn = data;
  }
  if (!conn) {
    const { data } = await admin.from("imap_connections")
      .select("id, email_address, imap_host, imap_port, imap_tls, imap_username, password_encrypted, password_iv")
      .eq("user_id", found.user_id).eq("is_active", true).limit(1).maybeSingle();
    conn = data;
  }
  if (!conn) throw new Error("imap connection not found");
  const password = await decryptString(conn.password_encrypted, conn.password_iv);
  const [uidStr, part] = String(att.attachment_id).split("|");
  const uid = Number(uidStr);
  if (!Number.isFinite(uid) || !part) throw new Error("invalid imap attachment_id");

  const client = new ImapFlow({
    host: conn.imap_host, port: conn.imap_port, secure: !!conn.imap_tls,
    auth: { user: conn.imap_username, pass: password }, logger: false, socketTimeout: 30000,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const dl = await client.download(uid, part, { uid: true });
      if (!dl?.content) throw new Error("imap download empty");
      const chunks: Uint8Array[] = [];
      for await (const c of dl.content as AsyncIterable<Uint8Array>) chunks.push(c);
      const total = chunks.reduce((s, c) => s + c.byteLength, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      return { bytes: out, emailAccount: conn.email_address ?? null };
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch { /* */ } }
}

// ─────────────────────────── AI call ───────────────────────────

async function callSilentAI(fileBase64: string, mime: string, filename: string) {
  const userContent: any[] =
    mime === "application/pdf" || mime.startsWith("image/")
      ? [
          { type: "image_url", image_url: { url: `data:${mime};base64,${fileBase64}` } },
          { type: "text", text: `File: ${filename}\nReturn STRICT JSON only.` },
        ]
      : [{ type: "text", text: `File: ${filename}\n\nContent (base64-decoded preview):\n${tryDecodeText(fileBase64).slice(0, 6000)}\n\nReturn STRICT JSON only.` }];

  const body = {
    model: SILENT_MODEL,
    temperature: 0,
    max_tokens: 4000,
    messages: [
      { role: "system", content: SILENT_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  let r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    // fallback to pro
    r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model: SILENT_FALLBACK_MODEL }),
    });
    if (!r.ok) throw new Error(`AI gateway ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const j = await r.json();
  const raw: string = j.choices?.[0]?.message?.content ?? "";
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m?.[1] || raw).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      supplier: parsed.supplier ?? null,
      document_type: parsed.document_type ?? "unknown",
      invoice_date: parsed.invoice_date ?? null,
      currency: parsed.currency ?? null,
      fields_detected: Array.isArray(parsed.fields_detected) ? parsed.fields_detected : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    throw new Error(`AI returned invalid JSON: ${jsonStr.slice(0, 160)}`);
  }
}

// ─────────────────────────── utils ───────────────────────────

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tryDecodeText(b64: string): string {
  try { return atob(b64); } catch { return ""; }
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ext === "pdf" ? "application/pdf"
    : ext === "csv" ? "text/csv"
    : ext === "xlsx" || ext === "xls" ? "application/vnd.ms-excel"
    : ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : "application/octet-stream";
}
