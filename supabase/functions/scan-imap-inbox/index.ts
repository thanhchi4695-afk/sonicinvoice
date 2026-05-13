// scan-imap-inbox — searches the user's IMAP inbox for invoice-like emails
// with attachments in the last 180 days, and writes them into
// gmail_found_invoices (provider='imap'). Per-user only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.155";
import { decryptString } from "../_shared/imap-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_MESSAGES_PER_SCAN = 150;
const FUNCTION_BUDGET_MS = 45_000;
const CONNECT_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 4_000;
const SUBJECT_TERMS = ["invoice", "tax invoice", "purchase order", "packing slip", "receipt", "statement", "bill"];
const INVOICE_FILE_RE = /\.(pdf|xlsx?|csv|jpe?g|png|heic|webp)$/i;

interface Conn {
  id: string;
  user_id: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_tls: boolean;
  imap_username: string;
  password_encrypted: string;
  password_iv: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin: any = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const onlyConnectionId = typeof body?.connection_id === "string" ? body.connection_id : null;

    let q = admin
      .from("imap_connections")
      .select("id, user_id, email_address, imap_host, imap_port, imap_tls, imap_username, password_encrypted, password_iv")
      .eq("user_id", userData.user.id)
      .eq("is_active", true);
    if (onlyConnectionId) q = q.eq("id", onlyConnectionId);
    const { data: conns, error } = await q;
    if (error) throw error;
    if (!conns || conns.length === 0) return json({ error: "No IMAP connection" }, 404);

    const supplierMap = await loadSupplierMap(admin, userData.user.id);

    const results = [];
    for (const c of conns as Conn[]) {
      try {
        const r = await scanOne(admin, c, supplierMap);
        results.push({ email: c.email_address, ...r });
      } catch (err) {
        console.error("[scan-imap] failed", c.email_address, err);
        results.push({ email: c.email_address, error: String((err as Error)?.message ?? err) });
      }
    }
    const aggregate = results.reduce((acc, r: any) => {
      acc.emails_scanned += r.emails_scanned ?? 0;
      if (Array.isArray(r.invoices_found)) acc.invoices_found.push(...r.invoices_found);
      if (r.error) acc.errors.push({ email: r.email, error: r.error });
      if (r.warning) acc.warnings.push({ email: r.email, warning: r.warning });
      return acc;
    }, { emails_scanned: 0, invoices_found: [] as any[], errors: [] as any[], warnings: [] as any[], accounts: results.length });
    return json(aggregate);
  } catch (err) {
    console.error("[scan-imap] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function loadSupplierMap(admin: any, userId: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from("supplier_profiles")
    .select("supplier_name, email_domains")
    .eq("user_id", userId);
  const m = new Map<string, string>();
  for (const s of (data ?? []) as Array<{ supplier_name: string; email_domains: string[] | null }>) {
    for (const d of s.email_domains ?? []) if (d) m.set(d.toLowerCase(), s.supplier_name);
  }
  return m;
}

async function scanOne(admin: any, conn: Conn, supplierMap: Map<string, string>) {
  const startedAt = Date.now();
  const password = await decryptString(conn.password_encrypted, conn.password_iv);
  const client = new ImapFlow({
    host: conn.imap_host,
    port: conn.imap_port,
    secure: !!conn.imap_tls,
    auth: { user: conn.imap_username, pass: password },
    logger: false,
    socketTimeout: 15000,
  });

  const invoicesFound: any[] = [];
  let scanned = 0;
  let partialReason: string | null = null;

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, `IMAP connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`);
  } catch (err) {
    try { await client.logout(); } catch { /* */ }
    throw err;
  }
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const sinceDate = new Date(Date.now() - 180 * 24 * 3600 * 1000);

      // OR together subject terms in IMAP SEARCH. Combine: SINCE date AND (OR ...) AND HAS-ATTACHMENT-ish
      // imapflow accepts an object: { since, or: [{subject: 'invoice'}, ...] }
      const searchCriteria: any = {
        since: sinceDate,
        or: SUBJECT_TERMS.map((t) => ({ subject: t })),
      };
      const uids = await withTimeout(
        client.search(searchCriteria, { uid: true }),
        SEARCH_TIMEOUT_MS,
        `IMAP search timed out after ${SEARCH_TIMEOUT_MS / 1000}s`,
      );
      const recent = (uids ?? []).slice(-MAX_MESSAGES_PER_SCAN).reverse();

      for (const uid of recent) {
        if (Date.now() - startedAt > FUNCTION_BUDGET_MS) {
          partialReason = `Stopped early to avoid timeout after ${scanned} email(s); press Rescan to continue.`;
          break;
        }
        scanned++;
        let msg: any = null;
        try {
          msg = await withTimeout(
            client.fetchOne(uid, { envelope: true, bodyStructure: true, internalDate: true }, { uid: true }),
            FETCH_TIMEOUT_MS,
            `Timed out reading message ${uid}`,
          );
        } catch (err) {
          console.warn("[scan-imap] skipped slow message", conn.email_address, uid, String((err as Error)?.message ?? err));
          continue;
        }
        if (!msg) continue;

        const fromAddr = msg.envelope?.from?.[0];
        const fromEmail = fromAddr ? `${fromAddr.mailbox ?? ""}@${fromAddr.host ?? ""}`.toLowerCase() : "";
        const subject = msg.envelope?.subject ?? "(no subject)";
        const domain = fromEmail.split("@")[1] ?? "";
        const supplierName = supplierMap.get(domain) ?? null;

        const attachments = collectAttachments(msg.bodyStructure);
        if (attachments.length === 0) continue;

        const messageId = msg.envelope?.messageId ?? `imap:${conn.id}:${uid}`;
        const row = {
          user_id: conn.user_id,
          provider: "imap",
          connection_id: conn.id,
          message_id: messageId,
          from_email: fromEmail || null,
          subject,
          received_at: (msg.envelope?.date ?? msg.internalDate ?? new Date()).toISOString?.() ?? new Date().toISOString(),
          supplier_name: supplierName,
          known_supplier: supplierName !== null,
          attachments: attachments.map((a) => ({
            attachment_id: `${uid}|${a.part}`, // composite for fetcher
            filename: a.filename,
            mime_type: a.mime,
            size: a.size,
          })),
        };

        const { error: upErr } = await admin
          .from("gmail_found_invoices")
          .upsert(row, { onConflict: "user_id,message_id", ignoreDuplicates: false });
        if (upErr) console.error("[scan-imap] upsert failed", upErr);
        else invoicesFound.push({ message_id: messageId, subject, from_email: fromEmail });
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* */ }
  }

  await admin.from("imap_connections").update({ last_checked_at: new Date().toISOString() }).eq("id", conn.id);
  return { emails_scanned: scanned, invoices_found: invoicesFound, partial: !!partialReason, warning: partialReason };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function collectAttachments(node: any, out: Array<{ part: string; filename: string; mime: string; size: number }> = []): typeof out {
  if (!node) return out;
  const part = node.part ?? "1";
  const dispo = (node.disposition ?? "").toLowerCase();
  const filename =
    node.dispositionParameters?.filename ||
    node.parameters?.name ||
    null;
  const isAttach = dispo === "attachment" || (!!filename && INVOICE_FILE_RE.test(filename));
  if (isAttach && filename) {
    out.push({
      part,
      filename,
      mime: `${node.type ?? "application"}/${node.subtype ?? "octet-stream"}`,
      size: node.size ?? 0,
    });
  }
  if (Array.isArray(node.childNodes)) {
    for (const c of node.childNodes) collectAttachments(c, out);
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
