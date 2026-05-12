// imap-fetch-attachment — downloads a single attachment from the user's
// IMAP mailbox and returns base64.
//
// Body: { message_id: string (the row's message_id stored in DB),
//         attachment_id: string ("<uid>|<part>") }

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.155";
import { decryptString } from "../_shared/imap-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const { message_id, attachment_id } = body ?? {};
    if (!message_id || !attachment_id) return json({ error: "message_id and attachment_id required" }, 400);

    const [uidStr, part] = String(attachment_id).split("|");
    const uid = Number(uidStr);
    if (!uid || !part) return json({ error: "Invalid attachment_id" }, 400);

    const admin: any = createClient(supabaseUrl, serviceKey);

    // Find which IMAP connection this message belongs to
    const { data: row } = await admin
      .from("gmail_found_invoices")
      .select("connection_id")
      .eq("user_id", userData.user.id)
      .eq("message_id", message_id)
      .eq("provider", "imap")
      .maybeSingle();
    if (!row?.connection_id) return json({ error: "Found-invoice row missing connection_id" }, 404);

    const { data: conn } = await admin
      .from("imap_connections")
      .select("imap_host, imap_port, imap_tls, imap_username, password_encrypted, password_iv")
      .eq("id", row.connection_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!conn) return json({ error: "No IMAP connection" }, 404);

    const password = await decryptString(conn.password_encrypted, conn.password_iv);
    const client = new ImapFlow({
      host: conn.imap_host,
      port: conn.imap_port,
      secure: !!conn.imap_tls,
      auth: { user: conn.imap_username, pass: password },
      logger: false,
      socketTimeout: 30000,
    });

    let bytes: Uint8Array | null = null;
    let mime = "application/octet-stream";
    let filename: string | undefined;

    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const dl = await client.download(String(uid), part, { uid: true });
        if (!dl?.content) throw new Error("Empty attachment download");
        // Stream the readable to a buffer
        const reader = dl.content as any;
        const chunks: Uint8Array[] = [];
        if (typeof reader[Symbol.asyncIterator] === "function") {
          for await (const chunk of reader) {
            chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
          }
        } else if (reader.getReader) {
          const r = reader.getReader();
          while (true) {
            const { done, value } = await r.read();
            if (done) break;
            chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
          }
        } else {
          throw new Error("Unsupported download stream");
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const buf = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) { buf.set(c, o); o += c.length; }
        bytes = buf;
        mime = (dl as any).meta?.contentType ?? mime;
        filename = (dl as any).meta?.filename;
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { /* */ }
    }

    if (!bytes) return json({ error: "Attachment not found" }, 404);

    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const data_base64 = btoa(bin);

    return json({ data_base64, mime_type: mime, filename });
  } catch (err) {
    console.error("[imap-fetch-attachment] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
