// gmail-refresh-token — exchanges the stored refresh_token for a fresh
// access_token. Called by scan-gmail-inbox before any Gmail API request
// when the cached access_token has < 5 min left.
//
// Body: { user_id: string }
// Returns: { access_token, expires_at }

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

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!clientId || !clientSecret) {
    return json({ error: "Missing GOOGLE_CLIENT_ID/SECRET" }, 500);
  }

  try {
    const { user_id } = await req.json().catch(() => ({}));
    if (!user_id) return json({ error: "user_id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: conn, error: connErr } = await admin
      .from("gmail_connections")
      .select("refresh_token")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (connErr || !conn) {
      return json({ error: "No active Gmail connection" }, 404);
    }

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      console.error("[gmail-refresh-token] failed", t);
      return json({ error: "Refresh failed", details: t.slice(0, 300) }, 502);
    }

    const tokens = await tokenResp.json() as {
      access_token: string;
      expires_in: number;
    };
    const expiresAt = new Date(
      Date.now() + (tokens.expires_in - 30) * 1000,
    ).toISOString();

    await admin
      .from("gmail_connections")
      .update({
        access_token: tokens.access_token,
        expires_at: expiresAt,
      })
      .eq("user_id", user_id);

    return json({ access_token: tokens.access_token, expires_at: expiresAt });
  } catch (err) {
    console.error("[gmail-refresh-token] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
