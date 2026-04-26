// Reports which OPTIONAL override env vars are configured.
// Returns only { name, configured } pairs — never the values themselves.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPTIONAL_OVERRIDES = [
  { name: "AI_GATEWAY_URL", group: "ai", default: "https://ai.gateway.lovable.dev/v1/chat/completions", purpose: "Override AI inference endpoint" },
  { name: "XERO_BASE_URL", group: "xero", default: "https://api.xero.com", purpose: "Xero API base" },
  { name: "XERO_TOKEN_URL", group: "xero", default: "https://identity.xero.com/connect/token", purpose: "Xero token exchange" },
  { name: "XERO_AUTH_URL", group: "xero", default: "https://login.xero.com/identity/connect/authorize", purpose: "Xero OAuth" },
  { name: "XERO_CONNECTIONS_URL", group: "xero", default: "https://api.xero.com/connections", purpose: "Xero connections" },
  { name: "MYOB_BASE_URL", group: "myob", default: "https://api.myob.com/accountright", purpose: "MYOB API base" },
  { name: "MYOB_TOKEN_URL", group: "myob", default: "https://secure.myob.com/oauth2/v1/authorize", purpose: "MYOB token" },
  { name: "MYOB_AUTH_URL", group: "myob", default: "https://secure.myob.com/oauth2/v1/authorize", purpose: "MYOB OAuth" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Verify caller is authenticated and an admin.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const items = OPTIONAL_OVERRIDES.map((s) => ({
      name: s.name,
      group: s.group,
      default: s.default,
      purpose: s.purpose,
      configured: Boolean(Deno.env.get(s.name)),
    }));

    return new Response(JSON.stringify({ items }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
