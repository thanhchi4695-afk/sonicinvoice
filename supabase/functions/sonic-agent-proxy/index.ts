// Streaming proxy: browser -> this edge fn -> Sonic Agent (Vercel).
// Keeps SONIC_AGENT_API_KEY server-side. Requires authed user (Supabase JWT).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const AGENT_URL = (Deno.env.get("SONIC_AGENT_URL") ?? "").replace(/\/+$/, "");
const AGENT_KEY = Deno.env.get("SONIC_AGENT_API_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!AGENT_URL || !AGENT_KEY) {
    return new Response(
      JSON.stringify({ error: "Sonic Agent not configured (missing SONIC_AGENT_URL or SONIC_AGENT_API_KEY)" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Validate caller JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Forward path after `/sonic-agent-proxy` (e.g. `/chat`) to the upstream agent.
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^.*\/sonic-agent-proxy/, "") || "/";
  const upstreamUrl = `${AGENT_URL}${subPath}${url.search}`;

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("Content-Type") ?? "application/json",
      "x-api-key": AGENT_KEY,
      "x-user-id": String(claims.claims.sub),
      ...(claims.claims.email ? { "x-user-email": String(claims.claims.email) } : {}),
    },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
  });

  // Stream the upstream response straight back (SSE-friendly).
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-cache",
    },
  });
});
