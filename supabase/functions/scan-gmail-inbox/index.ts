// scan-gmail-inbox — Phase 2 of the Watchdog Agent.
//
// Two call modes:
//   1. Manual / per-user from the UI (verify_jwt = false; we resolve the
//      user from the Authorization header):
//        POST /scan-gmail-inbox  { }  +  Authorization: Bearer <user JWT>
//   2. Cron / fan-out across all users (called by pg_cron with the
//      service-role bearer):
//        POST /scan-gmail-inbox  { scan_all_users: true }
//
// In Phase 2 this function ONLY discovers attachments and writes them to
// gmail_found_invoices. It does NOT trigger the watchdog automatically —
// the user does that from the UI.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GMAIL_QUERY =
  'has:attachment (invoice OR "tax invoice" OR "purchase order" OR "packing slip" OR receipt OR statement OR bill) newer_than:30d';

const INVOICE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

interface GmailConnection {
  user_id: string;
  email_address: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_email_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const scanAll = body?.scan_all_users === true;
    const autoProcess = body?.auto_process === true;

    // Resolve which connection(s) to scan
    let connections: GmailConnection[] = [];
    if (scanAll) {
      const { data, error } = await admin
        .from("gmail_connections")
        .select("user_id, email_address, access_token, refresh_token, expires_at")
        .eq("is_active", true);
      if (error) throw error;
      connections = (data ?? []) as GmailConnection[];
    } else {
      // Per-user call: identify the caller from the JWT
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Missing Authorization" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return json({ error: "Not authenticated" }, 401);
      }
      const { data, error } = await admin
        .from("gmail_connections")
        .select("user_id, email_address, access_token, refresh_token, expires_at")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "No Gmail connection" }, 404);
      connections = [data as GmailConnection];
    }

    const results = [];
    for (const conn of connections) {
      try {
        const r = await scanInbox(admin, conn, { autoProcess, supabaseUrl, serviceKey });
        results.push({ user_id: conn.user_id, ...r });
      } catch (err) {
        console.error("[scan-gmail-inbox] user failed", conn.user_id, err);
        results.push({
          user_id: conn.user_id,
          error: String((err as Error)?.message ?? err),
        });
      }
    }

    if (scanAll) {
      return json({ scanned_users: results.length, results });
    }
    // Single-user response shape the UI expects
    return json(results[0]);
  } catch (err) {
    console.error("[scan-gmail-inbox] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function scanInbox(
  admin: any,
  conn: GmailConnection,
  opts: { autoProcess: boolean; supabaseUrl: string; serviceKey: string },
) {
  // Look up the user's automation settings to decide whether to auto-trigger
  // the watchdog after upserting found invoices.
  let canAutoExtract = false;
  if (opts.autoProcess) {
    const { data: settingsRow } = await admin
      .from("user_settings")
      .select("automation_email_monitoring, automation_auto_extract")
      .eq("user_id", conn.user_id)
      .maybeSingle();
    canAutoExtract =
      !!settingsRow?.automation_email_monitoring &&
      !!settingsRow?.automation_auto_extract;
  }

  // 1. Refresh token if it's about to expire (or already has)
  let accessToken = conn.access_token;
  const expiresMs = new Date(conn.expires_at).getTime();
  if (Number.isFinite(expiresMs) && expiresMs - Date.now() < 5 * 60 * 1000) {
    accessToken = await refreshAccessToken(admin, conn);
  }

  // 2. List recent invoice-like emails
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", GMAIL_QUERY);
  listUrl.searchParams.set("maxResults", "20");

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listResp.ok) {
    const t = await listResp.text();
    throw new Error(`Gmail list failed: ${listResp.status} ${t.slice(0, 200)}`);
  }
  const listJson = await listResp.json() as { messages?: Array<{ id: string }> };
  const messageIds = (listJson.messages ?? []).map((m) => m.id);

  // 3. Load supplier email_domains for matching
  const { data: supplierRows } = await admin
    .from("supplier_profiles")
    .select("supplier_name, email_domains")
    .eq("user_id", conn.user_id);
  const domainToSupplier = new Map<string, string>();
  for (const s of (supplierRows ?? []) as Array<{ supplier_name: string; email_domains: string[] | null }>) {
    for (const d of s.email_domains ?? []) {
      if (d) domainToSupplier.set(d.toLowerCase(), s.supplier_name);
    }
  }

  // 4. Process each message: get headers + attachments
  const invoicesFound = [];
  let mostRecentId = conn.last_email_id ?? null;

  for (const messageId of messageIds) {
    const fullResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!fullResp.ok) continue;
    const msg = await fullResp.json();

    const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
    const headerVal = (n: string) =>
      headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;

    const fromRaw = headerVal("From") ?? "";
    const subject = headerVal("Subject") ?? "(no subject)";
    const dateStr = headerVal("Date");
    const fromEmail = extractEmail(fromRaw);
    const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
    const supplierName = domainToSupplier.get(domain) ?? null;

    const attachments = collectAttachments(msg.payload);
    if (attachments.length === 0) continue;

    const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

    const row = {
      user_id: conn.user_id,
      message_id: messageId,
      from_email: fromEmail || null,
      subject,
      received_at: receivedAt,
      supplier_name: supplierName,
      known_supplier: supplierName !== null,
      attachments,
    };

    // Upsert (user_id, message_id) so repeated scans are idempotent
    const { error: upErr } = await admin
      .from("gmail_found_invoices")
      .upsert(row, { onConflict: "user_id,message_id", ignoreDuplicates: false });
    if (upErr) console.error("[scan-gmail-inbox] upsert failed", upErr);

    // Auto-process: download attachment(s) and run watchdog if all conditions met.
    // - automation_email_monitoring AND automation_auto_extract for this user
    // - sender domain matches a known supplier OR filename looks invoice-like
    let processedHere = false;
    let agentRunIds: string[] = [];
    if (canAutoExtract && opts.autoProcess) {
      for (const att of attachments) {
        const looksInvoice =
          supplierName !== null ||
          /invoice|inv[\s_-]|order|po[\s_-]|purchase|packing|slip/i.test(att.filename);
        if (!looksInvoice) continue;
        try {
          const runId = await runWatchdogForAttachment({
            supabaseUrl: opts.supabaseUrl,
            serviceKey: opts.serviceKey,
            userId: conn.user_id,
            accessToken,
            messageId,
            attachment: att,
            supplierName,
          });
          if (runId) {
            agentRunIds.push(runId);
            processedHere = true;
          }
        } catch (err) {
          console.error("[scan-gmail-inbox] auto-process failed", messageId, err);
        }
      }
      if (processedHere) {
        await admin
          .from("gmail_found_invoices")
          .update({ processed: true, agent_run_id: agentRunIds[0] })
          .eq("user_id", conn.user_id)
          .eq("message_id", messageId);
      }
    }

    invoicesFound.push({
      message_id: messageId,
      from: fromEmail,
      subject,
      date: receivedAt,
      supplier_name: supplierName,
      known_supplier: supplierName !== null,
      attachment_count: attachments.length,
      attachments,
      auto_processed: processedHere,
      agent_run_ids: agentRunIds,
    });

    if (!mostRecentId) mostRecentId = messageId;
  }

  // 5. Update last_checked_at + last_email_id
  await admin
    .from("gmail_connections")
    .update({
      last_checked_at: new Date().toISOString(),
      last_email_id: mostRecentId,
    })
    .eq("user_id", conn.user_id);

  return {
    emails_scanned: messageIds.length,
    invoices_found: invoicesFound,
  };
}

function collectAttachments(part: any): Array<{
  filename: string;
  mime_type: string;
  attachment_id: string;
  size_bytes: number;
}> {
  const out: any[] = [];
  if (!part) return out;
  if (
    part.filename &&
    part.body?.attachmentId &&
    INVOICE_MIME_TYPES.has(part.mimeType)
  ) {
    out.push({
      filename: part.filename,
      mime_type: part.mimeType,
      attachment_id: part.body.attachmentId,
      size_bytes: part.body.size ?? 0,
    });
  }
  if (Array.isArray(part.parts)) {
    for (const p of part.parts) out.push(...collectAttachments(p));
  }
  return out;
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  return raw.trim();
}

async function refreshAccessToken(
  admin: any,
  conn: GmailConnection,
): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID/SECRET");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Token refresh failed: ${t.slice(0, 200)}`);
  }
  const tokens = await resp.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(
    Date.now() + (tokens.expires_in - 30) * 1000,
  ).toISOString();

  await admin
    .from("gmail_connections")
    .update({ access_token: tokens.access_token, expires_at: expiresAt })
    .eq("user_id", conn.user_id);

  return tokens.access_token;
}

// Auto-process helper: download an attachment from Gmail with the user's
// access token, then call agent-watchdog with the service-role key (since
// there's no user JWT available inside a cron-triggered context).
async function runWatchdogForAttachment(args: {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
  accessToken: string;
  messageId: string;
  attachment: { filename: string; mime_type: string; attachment_id: string };
  supplierName: string | null;
}): Promise<string | null> {
  // 1. Download attachment bytes (URL-safe base64 → standard base64)
  const attResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/attachments/${args.attachment.attachment_id}`,
    { headers: { Authorization: `Bearer ${args.accessToken}` } },
  );
  if (!attResp.ok) {
    console.error("[scan-gmail-inbox] attachment fetch failed", attResp.status);
    return null;
  }
  const attJson = await attResp.json() as { data?: string };
  if (!attJson.data) return null;
  const base64 = attJson.data.replace(/-/g, "+").replace(/_/g, "/");

  // 2. Call orchestrator (which wraps watchdog + classify + enrich + publish + learn)
  // with X-User-Id header so it can attribute the run from the cron path.
  const resp = await fetch(`${args.supabaseUrl}/functions/v1/agent-orchestrator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.serviceKey}`,
      "X-User-Id": args.userId,
    },
    body: JSON.stringify({
      trigger_type: "email",
      file_base64: base64,
      filename: args.attachment.filename,
      mime_type: args.attachment.mime_type,
      supplier_hint: args.supplierName ?? undefined,
    }),
  });
  if (!resp.ok) {
    console.error("[scan-gmail-inbox] orchestrator call failed", resp.status, await resp.text().catch(() => ""));
    return null;
  }
  const data = await resp.json().catch(() => ({}));
  return (data?.run_id as string) ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
