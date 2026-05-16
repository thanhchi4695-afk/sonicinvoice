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
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
  let userId = claims?.claims?.sub ? String(claims.claims.sub) : "";
  let userEmail = claims?.claims?.email ? String(claims.claims.email) : "";

  if (!userId) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    userId = userData?.user?.id ?? "";
    userEmail = userData?.user?.email ?? "";
    if (userErr || !userId) {
      console.warn("sonic-agent-proxy auth failed", {
        claimsError: claimsErr?.message,
        userError: userErr?.message,
        hasAuthorizationHeader: true,
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!userId) {
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
      "Authorization": `Bearer ${AGENT_KEY}`,
      "X-Sonic-Agent-Key": AGENT_KEY,
      "x-api-key": AGENT_KEY,
      "x-user-id": userId,
      ...(userEmail ? { "x-user-email": userEmail } : {}),
    },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
  });

  if (!upstream.ok) {
    console.warn("sonic-agent-proxy upstream failed", {
      status: upstream.status,
      contentType: upstream.headers.get("Content-Type"),
      upstreamPath: subPath,
    });
  }

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
