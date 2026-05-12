// imap-connect — tests an IMAP login (Yahoo by default) and, on success,
// saves an encrypted app-password connection record for the calling user.
//
// Body: {
//   email: string,
//   app_password: string,
//   provider?: "yahoo" | "icloud" | "outlook" | "custom",
//   imap_host?: string,
//   imap_port?: number,
//   imap_tls?: boolean,
//   imap_username?: string  // defaults to email
// }
//
// Returns: { ok: true, id, email_address } or { ok: false, error }

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.155";
import { encryptString } from "../_shared/imap-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRESETS: Record<string, { host: string; port: number; tls: boolean; label: string }> = {
  yahoo: { host: "imap.mail.yahoo.com", port: 993, tls: true, label: "yahoo" },
  icloud: { host: "imap.mail.me.com", port: 993, tls: true, label: "icloud" },
  outlook: { host: "outlook.office365.com", port: 993, tls: true, label: "outlook" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing Authorization" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim();
    const appPassword = String(body?.app_password ?? "");
    if (!email || !appPassword) return json({ ok: false, error: "email and app_password required" }, 400);

    const providerKey = String(body?.provider ?? "yahoo").toLowerCase();
    const preset = PRESETS[providerKey];
    const host = String(body?.imap_host ?? preset?.host ?? "");
    const port = Number(body?.imap_port ?? preset?.port ?? 993);
    const tls = body?.imap_tls ?? preset?.tls ?? true;
    const username = String(body?.imap_username ?? email);
    const label = preset?.label ?? providerKey;

    if (!host) return json({ ok: false, error: "imap_host required for custom provider" }, 400);

    // Test login
    const client = new ImapFlow({
      host,
      port,
      secure: !!tls,
      auth: { user: username, pass: appPassword },
      logger: false,
      socketTimeout: 15000,
    });
    try {
      await client.connect();
      await client.logout();
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      console.error("[imap-connect] login failed", host, msg);
      return json({ ok: false, error: `IMAP login failed: ${msg}` }, 401);
    }

    // Encrypt + upsert
    const enc = await encryptString(appPassword);
    const admin: any = createClient(supabaseUrl, serviceKey);
    const { data: row, error: upErr } = await admin
      .from("imap_connections")
      .upsert({
        user_id: userData.user.id,
        email_address: email,
        imap_host: host,
        imap_port: port,
        imap_tls: !!tls,
        imap_username: username,
        password_encrypted: enc.ciphertext,
        password_iv: enc.iv,
        provider_label: label,
        is_active: true,
      }, { onConflict: "user_id,email_address" })
      .select("id, email_address")
      .maybeSingle();
    if (upErr) {
      console.error("[imap-connect] upsert failed", upErr);
      return json({ ok: false, error: upErr.message }, 500);
    }
    return json({ ok: true, id: row?.id, email_address: row?.email_address });
  } catch (err) {
    console.error("[imap-connect] error", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
