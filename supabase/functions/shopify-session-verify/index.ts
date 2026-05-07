/**
 * Shopify Session Token Verification
 *
 * When the app runs embedded inside Shopify Admin, App Bridge provides
 * a session token (JWT signed with SHOPIFY_API_SECRET). This function
 * verifies that token and returns real Supabase access/refresh tokens.
 *
 * REQUIRED: Disable JWT verification in Supabase Dashboard for this function:
 *   Edge Functions → shopify-session-verify → Settings → uncheck "Enforce JWT Verification"
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_KEY           = Deno.env.get("SHOPIFY_API_KEY")!;
const SHOPIFY_API_SECRET        = Deno.env.get("SHOPIFY_API_SECRET")!;

type VerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: "malformed" | "bad_signature" | "aud_mismatch" | "expired" | "error"; detail?: string; tokenAud?: string };

async function verifySessionToken(token: string): Promise<VerifyResult> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(SHOPIFY_API_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const signatureInput = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify("HMAC", key, signature, signatureInput);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    if (!valid) {
      console.warn("Session token bad signature. token aud=", payload?.aud, "expected aud=", SHOPIFY_API_KEY);
      return { ok: false, reason: "bad_signature", tokenAud: payload?.aud };
    }

    if (payload.aud !== SHOPIFY_API_KEY) {
      console.warn("Session token aud mismatch:", payload.aud, "!=", SHOPIFY_API_KEY);
      return { ok: false, reason: "aud_mismatch", tokenAud: payload?.aud };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp + 10 < now) {
      console.warn("Session token expired");
      return { ok: false, reason: "expired" };
    }

    return { ok: true, payload };
  } catch (err) {
    console.error("Session token verification error:", err);
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

function extractShopDomain(issOrDest: string): string {
  try { return new URL(issOrDest).hostname; } catch { return issOrDest; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body         = await req.json();
    const sessionToken = body.session_token;

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "Missing session_token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await verifySessionToken(sessionToken);
    if (!result.ok) {
      const expectedAud = SHOPIFY_API_KEY;
      const errorMessages: Record<string, string> = {
        malformed: "Session token is malformed (not a valid JWT).",
        bad_signature: "Session token signature is invalid — SHOPIFY_API_SECRET in the backend does not match the app that issued the token.",
        aud_mismatch: `Session token was issued for a different Shopify app (aud=${result.tokenAud}, expected ${expectedAud}). Open the production app, not a separate testing app.`,
        expired: "Session token has expired — reload the app from Shopify Admin.",
        error: `Session token verification error: ${result.detail || "unknown"}`,
      };
      return new Response(
        JSON.stringify({
          error: errorMessages[result.reason],
          reason: result.reason,
          token_aud: result.tokenAud,
          expected_aud: expectedAud,
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const payload = result.payload;

    const shop = extractShopDomain((payload.dest || payload.iss) as string);
    console.log("Session verified for shop:", shop);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conn } = await supabaseAdmin
      .from("shopify_connections")
      .select("user_id, shop_name")
      .eq("store_url", shop)
      .single();

    if (!conn) {
      return new Response(
        JSON.stringify({ error: "App not installed for this shop", needs_install: true }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // supabase-js v2 doesn't expose createSession on auth.admin in this runtime.
    // Use generateLink with type=magiclink — it embeds an access_token + refresh_token
    // in the action_link's URL hash (#access_token=...&refresh_token=...).
    const { data: userRow, error: userErr } =
      await supabaseAdmin.auth.admin.getUserById(conn.user_id);
    if (userErr || !userRow?.user?.email) {
      console.error("Failed to load user:", userErr);
      return new Response(
        JSON.stringify({ error: "Failed to load user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: userRow.user.email,
      });

    if (linkErr || !linkData?.properties?.action_link) {
      console.error("Failed to generate link:", linkErr);
      return new Response(
        JSON.stringify({ error: "Failed to issue session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse tokens from the hash fragment of the action_link
    const actionUrl = new URL(linkData.properties.action_link);
    const hash      = new URLSearchParams(actionUrl.hash.replace(/^#/, ""));
    let accessToken  = hash.get("access_token");
    let refreshToken = hash.get("refresh_token");

    // Fallback: some Supabase versions return token_hash instead — verify it
    // server-side to mint a real session.
    if (!accessToken || !refreshToken) {
      const tokenHash = linkData.properties.hashed_token;
      if (tokenHash) {
        const { data: verified, error: verifyErr } =
          await supabaseAdmin.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (verifyErr || !verified?.session) {
          console.error("verifyOtp failed:", verifyErr);
          return new Response(
            JSON.stringify({ error: "Failed to mint session" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        accessToken  = verified.session.access_token;
        refreshToken = verified.session.refresh_token;
      }
    }

    if (!accessToken || !refreshToken) {
      return new Response(
        JSON.stringify({ error: "Could not extract session tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        access_token:  accessToken,
        refresh_token: refreshToken,
        shop,
        shop_name: conn.shop_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Session verify error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});