// gmail-oauth-callback — receives Google's redirect after the user grants
// gmail.readonly scope. Exchanges the auth code for tokens, fetches the
// user's email address, upserts into gmail_connections, and redirects the
// browser back to the app with ?gmail=connected.
//
// Public route (verify_jwt = false) — Google calls it without our JWT.
// We rely on the `state` parameter being the Supabase user_id sent at
// the start of the OAuth flow.

import { createClient } from "npm:@supabase/supabase-js@2";

const APP_BASE_URL =
  Deno.env.get("APP_URL")?.replace(/\/$/, "") ?? "https://sonicinvoices.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // user_id
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=${errorParam}`);
  }
  if (!code || !state) {
    return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=missing_code`);
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!clientId || !clientSecret) {
    return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=missing_secrets`);
  }

  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;

  try {
    // 1. Exchange code → tokens
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      console.error("[gmail-oauth-callback] token exchange failed", t);
      return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=token_exchange`);
    }
    const tokens = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    if (!tokens.refresh_token) {
      // Likely already authorised previously — Google only returns
      // a refresh_token on the first consent. We force prompt=consent on
      // the auth URL to avoid this, but bail loudly if it ever happens.
      return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=no_refresh_token`);
    }

    // 2. Get the user's Gmail address
    const profileResp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profileResp.ok) {
      return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=profile_fetch`);
    }
    const profile = await profileResp.json() as { emailAddress: string };

    // 3. Upsert connection
    const admin = createClient(supabaseUrl, serviceKey);
    const expiresAt = new Date(
      Date.now() + (tokens.expires_in - 30) * 1000,
    ).toISOString();

    const { error: upsertErr } = await admin
      .from("gmail_connections")
      .upsert(
        {
          user_id: state,
          email_address: profile.emailAddress,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          is_active: true,
        },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      console.error("[gmail-oauth-callback] upsert failed", upsertErr);
      return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=db_write`);
    }

    return redirect(
      `${APP_BASE_URL}/dashboard?gmail=connected&email=${encodeURIComponent(profile.emailAddress)}`,
    );
  } catch (err) {
    console.error("[gmail-oauth-callback] error", err);
    return redirect(`${APP_BASE_URL}/dashboard?gmail=error&reason=exception`);
  }
});

function redirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}
