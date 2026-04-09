/**
 * Shopify Session Token Verification
 * 
 * When the app runs embedded inside Shopify Admin, App Bridge provides
 * a session token (JWT). This function verifies that token, looks up
 * or creates a Supabase user for the shop, and returns Supabase
 * access/refresh tokens so the frontend can authenticate seamlessly.
 *
 * Used for: Embedded app auth without login screen
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY")!;
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET")!;

// ─── JWT verification using SHOPIFY_API_SECRET ───────────────────────
// Shopify session tokens are JWTs signed with the app's API secret (HS256).
async function verifySessionToken(token: string): Promise<{
  iss: string; // https://{shop}.myshopify.com/admin
  dest: string; // https://{shop}.myshopify.com
  aud: string; // API key
  sub: string; // Shopify user ID
  exp: number;
  iat: number;
  nbf: number;
  jti: string;
} | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Verify signature (HS256)
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SHOPIFY_API_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureInput = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify("HMAC", key, signature, signatureInput);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    // Verify audience matches our API key
    if (payload.aud !== SHOPIFY_API_KEY) {
      console.warn("Session token audience mismatch:", payload.aud, "!=", SHOPIFY_API_KEY);
      return null;
    }

    // Verify not expired (with 10s leeway)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp + 10 < now) {
      console.warn("Session token expired");
      return null;
    }

    return payload;
  } catch (err) {
    console.error("Session token verification error:", err);
    return null;
  }
}

function extractShopDomain(issOrDest: string): string {
  // iss = https://store.myshopify.com/admin or dest = https://store.myshopify.com
  try {
    const url = new URL(issOrDest);
    return url.hostname;
  } catch {
    return issOrDest;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const sessionToken = body.session_token;

    if (!sessionToken) {
      return new Response(JSON.stringify({ error: "Missing session_token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Verify Shopify session token
    const payload = await verifySessionToken(sessionToken);
    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shop = extractShopDomain(payload.dest || payload.iss);
    const shopifyUserId = payload.sub;

    console.log("Session verified for shop:", shop, "user:", shopifyUserId);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 2: Check if we have a Shopify connection for this shop
    const { data: conn } = await supabaseAdmin
      .from("shopify_connections")
      .select("user_id, shop_name, store_url")
      .eq("store_url", shop)
      .single();

    if (!conn) {
      return new Response(JSON.stringify({ 
        error: "No connection found for this shop. Please install the app first.",
        needs_install: true
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 3: Get or verify the Supabase user
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(conn.user_id);
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "User account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: Create a direct session for this user
    const { data: sessionData, error: sessionErr } =
      await supabaseAdmin.auth.admin.createSession({
        user_id: conn.user_id,
      });

    if (sessionErr || !sessionData?.session) {
      console.error("Failed to create session:", sessionErr);
      return new Response(JSON.stringify({ error: "Failed to create session" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      shop,
      shop_name: conn.shop_name,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Session verify error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
