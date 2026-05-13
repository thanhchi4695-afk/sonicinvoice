// scan-outlook-inbox — Microsoft Graph mirror of scan-gmail-inbox.
// Discovers attachments in the user's Outlook inbox and writes invoice-like
// ones into gmail_found_invoices (provider='outlook'). Per-user only.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_MESSAGES_PER_SCAN = 500;
const PAGE_SIZE = 50;
// 180 days ago in ISO 8601
const since = () => new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();

const INVOICE_KEYWORDS = /(invoice|tax invoice|purchase order|packing slip|receipt|statement|bill)/i;
const INVOICE_FILE_RE = /\.(pdf|xlsx?|csv|jpe?g|png|heic|webp)$/i;

interface Conn {
  id: string;
  user_id: string;
  email_address: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const { data: conns, error } = await admin
      .from("outlook_connections")
      .select("id, user_id, email_address, access_token, refresh_token, expires_at")
      .eq("user_id", userData.user.id)
      .eq("is_active", true);
    if (error) throw error;
    if (!conns || conns.length === 0) return json({ error: "No Outlook connection" }, 404);

    const results = [];
    for (const c of conns as Conn[]) {
      try {
        const r = await scanOne(admin, c);
        results.push({ email: c.email_address, ...r });
      } catch (err) {
        console.error("[scan-outlook] failed", c.email_address, err);
        results.push({ email: c.email_address, error: String((err as Error)?.message ?? err) });
      }
    }

    const aggregate = results.reduce((acc, r: any) => {
      acc.emails_scanned += r.emails_scanned ?? 0;
      if (Array.isArray(r.invoices_found)) acc.invoices_found.push(...r.invoices_found);
      if (r.error) acc.errors.push({ email: r.email, error: r.error });
      return acc;
    }, { emails_scanned: 0, invoices_found: [] as any[], errors: [] as any[], accounts: results.length });
    return json(aggregate);
  } catch (err) {
    console.error("[scan-outlook] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function refreshToken(admin: any, conn: Conn): Promise<string> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
      scope: "offline_access User.Read Mail.Read",
    }),
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const t = await resp.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const expiresAt = new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString();
  await admin.from("outlook_connections").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? conn.refresh_token,
    expires_at: expiresAt,
  }).eq("id", conn.id);
  return t.access_token;
}

async function scanOne(admin: any, conn: Conn) {
  let token = conn.access_token;
  const expiresMs = new Date(conn.expires_at).getTime();
  if (Number.isFinite(expiresMs) && expiresMs - Date.now() < 5 * 60 * 1000) {
    token = await refreshToken(admin, conn);
  }

  // Get supplier domain map
  const { data: supplierRows } = await admin
    .from("supplier_profiles")
    .select("supplier_name, email_domains")
    .eq("user_id", conn.user_id);
  const domainToSupplier = new Map<string, string>();
  for (const s of (supplierRows ?? []) as Array<{ supplier_name: string; email_domains: string[] | null }>) {
    for (const d of s.email_domains ?? []) if (d) domainToSupplier.set(d.toLowerCase(), s.supplier_name);
  }

  // Query: hasAttachments true, last 180 days
  const filter = `hasAttachments eq true and receivedDateTime ge ${since()}`;
  const select = "id,subject,from,receivedDateTime,hasAttachments";
  let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=${encodeURIComponent(select)}&$top=${PAGE_SIZE}&$orderby=receivedDateTime desc`;

  const messages: any[] = [];
  while (url && messages.length < MAX_MESSAGES_PER_SCAN) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Graph list failed: ${r.status} ${t.slice(0, 200)}`);
    }
    const j = await r.json() as { value: any[]; "@odata.nextLink"?: string };
    for (const m of j.value ?? []) {
      if (messages.length >= MAX_MESSAGES_PER_SCAN) break;
      messages.push(m);
    }
    url = j["@odata.nextLink"] ?? null;
  }

  const invoicesFound: any[] = [];
  for (const m of messages) {
    const subject: string = m.subject ?? "(no subject)";
    const fromEmail: string = m.from?.emailAddress?.address?.toLowerCase() ?? "";
    const domain = fromEmail.split("@")[1] ?? "";
    const supplierName = domainToSupplier.get(domain) ?? null;

    // Quick subject filter to keep noise down
    const looksRelevant = supplierName !== null || INVOICE_KEYWORDS.test(subject);
    if (!looksRelevant) continue;

    // Fetch attachments list
    const attResp = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${m.id}/attachments?$select=id,name,contentType,size`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!attResp.ok) continue;
    const attJson = await attResp.json() as { value: any[] };
    const attachments = (attJson.value ?? [])
      .filter((a) => a.name && INVOICE_FILE_RE.test(a.name))
      .map((a) => ({
        attachment_id: a.id,
        filename: a.name,
        mime_type: a.contentType,
        size: a.size,
      }));
    if (attachments.length === 0) continue;

    const row = {
      user_id: conn.user_id,
      provider: "outlook",
      connection_id: conn.id,
      message_id: m.id,
      from_email: fromEmail || null,
      subject,
      received_at: m.receivedDateTime ?? new Date().toISOString(),
      supplier_name: supplierName,
      known_supplier: supplierName !== null,
      attachments,
    };

    const { error: upErr } = await admin
      .from("gmail_found_invoices")
      .upsert(row, { onConflict: "user_id,message_id", ignoreDuplicates: false });
    if (upErr) console.error("[scan-outlook] upsert failed", upErr);
    else invoicesFound.push({ message_id: m.id, subject, from_email: fromEmail });
  }

  await admin.from("outlook_connections").update({ last_checked_at: new Date().toISOString() }).eq("id", conn.id);

  return { emails_scanned: messages.length, invoices_found: invoicesFound };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
