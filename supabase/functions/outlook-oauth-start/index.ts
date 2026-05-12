// outlook-oauth-start — builds Microsoft's OAuth authorize URL using
// MICROSOFT_CLIENT_ID and 302-returns it as JSON for the front-end to navigate.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  if (!clientId) return json({ error: "MICROSOFT_CLIENT_ID not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData?.user) return json({ error: "Not authenticated" }, 401);

  let originHint = "";
  try {
    const body = await req.json().catch(() => ({}));
    originHint = (body?.origin as string) || "";
  } catch { /* */ }
  if (!originHint) originHint = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  try { originHint = new URL(originHint).origin; } catch { originHint = ""; }

  const statePayload = originHint
    ? `${userData.user.id}|${btoa(originHint)}`
    : userData.user.id;

  const callbackUrl = `${supabaseUrl}/functions/v1/outlook-oauth-callback`;
  const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", "offline_access User.Read Mail.Read");
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("state", statePayload);

  return json({ url: authUrl.toString() });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
