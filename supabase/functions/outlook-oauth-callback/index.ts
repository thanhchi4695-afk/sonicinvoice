// outlook-oauth-callback — exchanges code for tokens, fetches mailbox address,
// upserts into outlook_connections, redirects back to /dashboard.
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_BASE_URL = Deno.env.get("APP_URL")?.replace(/\/$/, "") ?? "https://sonicinvoices.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const [userId, originB64] = (state ?? "").split("|");
  let returnOrigin = APP_BASE_URL;
  if (originB64) {
    try {
      const decoded = atob(originB64);
      if (/^https?:\/\//.test(decoded)) returnOrigin = decoded.replace(/\/$/, "");
    } catch { /* */ }
  }

  if (errorParam) return redirect(`${returnOrigin}/dashboard?outlook=error&reason=${errorParam}`);
  if (!code || !state) return redirect(`${returnOrigin}/dashboard?outlook=error&reason=missing_code`);

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!clientId || !clientSecret) {
    return redirect(`${returnOrigin}/dashboard?outlook=error&reason=missing_secrets`);
  }

  const redirectUri = `${supabaseUrl}/functions/v1/outlook-oauth-callback`;

  try {
    const tokenResp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "offline_access User.Read Mail.Read",
      }),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      console.error("[outlook-oauth-callback] token exchange failed", t);
      return redirect(`${returnOrigin}/dashboard?outlook=error&reason=token_exchange`);
    }
    const tokens = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    if (!tokens.refresh_token) {
      return redirect(`${returnOrigin}/dashboard?outlook=error&reason=no_refresh_token`);
    }

    const meResp = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meResp.ok) return redirect(`${returnOrigin}/dashboard?outlook=error&reason=profile_fetch`);
    const me = await meResp.json() as { mail?: string; userPrincipalName?: string };
    const emailAddress = me.mail || me.userPrincipalName;
    if (!emailAddress) return redirect(`${returnOrigin}/dashboard?outlook=error&reason=no_email`);

    const admin = createClient(supabaseUrl, serviceKey);
    const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();

    const { error: upsertErr } = await admin
      .from("outlook_connections")
      .upsert({
        user_id: userId,
        email_address: emailAddress,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        is_active: true,
      }, { onConflict: "user_id,email_address" });

    if (upsertErr) {
      console.error("[outlook-oauth-callback] upsert failed", upsertErr);
      return redirect(`${returnOrigin}/dashboard?outlook=error&reason=db_write`);
    }

    return redirect(`${returnOrigin}/dashboard?outlook=connected&email=${encodeURIComponent(emailAddress)}`);
  } catch (err) {
    console.error("[outlook-oauth-callback] error", err);
    return redirect(`${returnOrigin}/dashboard?outlook=error&reason=exception`);
  }
});

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url } });
}
