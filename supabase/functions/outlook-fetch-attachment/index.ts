// outlook-fetch-attachment — downloads a single Outlook attachment and
// returns base64. Refreshes token if needed.
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const admin: any = createClient(supabaseUrl, serviceKey);
    const { data: conn } = await admin
      .from("outlook_connections")
      .select("id, access_token, refresh_token, expires_at")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!conn) return json({ error: "No Outlook connection" }, 404);

    let token = conn.access_token as string;
    const expiresMs = new Date(conn.expires_at).getTime();
    if (Number.isFinite(expiresMs) && expiresMs - Date.now() < 5 * 60 * 1000) {
      token = await refresh(admin, conn);
    }

    const r = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${message_id}/attachments/${attachment_id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "Graph fetch failed", details: t.slice(0, 200) }, 502);
    }
    const j = await r.json() as { contentBytes?: string; "@odata.type"?: string; name?: string; contentType?: string };
    if (!j.contentBytes) return json({ error: "Attachment has no contentBytes (item attachment?)" }, 415);

    return json({ data_base64: j.contentBytes, mime_type: j.contentType, filename: j.name });
  } catch (err) {
    console.error("[outlook-fetch-attachment] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function refresh(admin: any, conn: any): Promise<string> {
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
  if (!resp.ok) throw new Error("Token refresh failed");
  const t = await resp.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const expiresAt = new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString();
  await admin.from("outlook_connections").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? conn.refresh_token,
    expires_at: expiresAt,
  }).eq("id", conn.id);
  return t.access_token;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
