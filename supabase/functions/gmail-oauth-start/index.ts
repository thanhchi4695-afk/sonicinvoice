// gmail-oauth-start — builds Google's OAuth authorize URL using the
// server-side GOOGLE_CLIENT_ID secret and 302-redirects the browser.
// Front-end just opens this in the same tab; no build secret needed.
//
// Auth: requires the user's JWT so we can put their user_id in `state`.

import { createClient } from "npm:@supabase/supabase-js@2";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return json({ error: "GOOGLE_CLIENT_ID not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData?.user) return json({ error: "Not authenticated" }, 401);

  const callbackUrl = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", userData.user.id);

  // Return URL as JSON so the front-end can do window.location.href = url.
  // (Returning a 302 from a fetch() doesn't navigate the browser.)
  return json({ url: authUrl.toString() });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
