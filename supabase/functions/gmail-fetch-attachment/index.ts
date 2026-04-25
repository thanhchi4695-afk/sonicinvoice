// gmail-fetch-attachment — downloads a single Gmail attachment for the
// authenticated user and returns the raw bytes as base64 so the UI can
// hand it to agent-watchdog. Refreshes the access token if needed.
//
// Body: { message_id: string, attachment_id: string }
// Returns: { data_base64: string, mime_type?: string, filename?: string }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { message_id, attachment_id } = body ?? {};
    if (!message_id || !attachment_id) {
      return json({ error: "message_id and attachment_id required" }, 400);
    }

    const admin: any = createClient(supabaseUrl, serviceKey);
    const { data: conn, error: connErr } = await admin
      .from("gmail_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (connErr || !conn) return json({ error: "No Gmail connection" }, 404);

    let accessToken = conn.access_token as string;
    const expiresMs = new Date(conn.expires_at).getTime();
    if (Number.isFinite(expiresMs) && expiresMs - Date.now() < 5 * 60 * 1000) {
      accessToken = await refreshAccessToken(admin, userId, conn.refresh_token);
    }

    const attResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${attachment_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!attResp.ok) {
      const t = await attResp.text();
      return json({ error: "Gmail fetch failed", details: t.slice(0, 200) }, 502);
    }
    const attJson = await attResp.json() as { data: string; size: number };

    // Gmail returns URL-safe base64; convert to standard base64 for downstream consumers
    const std = attJson.data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);

    return json({ data_base64: padded });
  } catch (err) {
    console.error("[gmail-fetch-attachment] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function refreshAccessToken(
  admin: any,
  userId: string,
  refreshToken: string,
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
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error("Token refresh failed");
  const tokens = await resp.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(
    Date.now() + (tokens.expires_in - 30) * 1000,
  ).toISOString();
  await admin
    .from("gmail_connections")
    .update({ access_token: tokens.access_token, expires_at: expiresAt })
    .eq("user_id", userId);
  return tokens.access_token;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
