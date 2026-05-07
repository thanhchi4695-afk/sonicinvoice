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
import { tokenResponseToConnectionColumns } from "../_shared/shopify-token.ts";
import { getShopifyAppByKey, getAllShopifyApps, peekJwtPayload, type ShopifyAppCreds } from "../_shared/shopify-apps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION               = "2025-01";
const SCOPES                    = "read_products,write_products,read_orders,read_inventory,write_inventory";
const OFFLINE_TOKEN_TYPE        = "urn:shopify:params:oauth:token-type:offline-access-token";
const TOKEN_EXCHANGE_GRANT      = "urn:ietf:params:oauth:grant-type:token-exchange";

type VerifyResult =
  | { ok: true; payload: Record<string, unknown>; app: ShopifyAppCreds }
  | { ok: false; reason: "malformed" | "bad_signature" | "aud_mismatch" | "expired" | "error"; detail?: string; tokenAud?: string };

async function verifySessionToken(token: string): Promise<VerifyResult> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };

    // Multi-app routing: select credentials by token's aud claim.
    const peeked = peekJwtPayload(token) as Record<string, unknown> | null;
    const tokenAud = typeof peeked?.aud === "string" ? (peeked!.aud as string) : undefined;
    const app = await getShopifyAppByKey(tokenAud);
    if (!app) {
      console.warn("Session token aud has no matching app:", tokenAud);
      return { ok: false, reason: "aud_mismatch", tokenAud };
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(app.apiSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const signatureInput = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify("HMAC", key, signature, signatureInput);
    const payload = peeked ?? JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    if (!valid) {
      console.warn("Session token bad signature for app=", app.label, "aud=", tokenAud);
      return { ok: false, reason: "bad_signature", tokenAud };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp + 10 < now) {
      console.warn("Session token expired");
      return { ok: false, reason: "expired" };
    }

    return { ok: true, payload, app };
  } catch (err) {
    console.error("Session token verification error:", err);
    return { ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

function extractShopDomain(issOrDest: string): string {
  try { return new URL(issOrDest).hostname; } catch { return issOrDest; }
}

function buildInstallUrl(shop: string, app: ShopifyAppCreds): string {
  const redirectUri = `${SUPABASE_URL}/functions/v1/shopify-auth-callback`;
  return `https://${shop}/admin/oauth/authorize?client_id=${app.apiKey}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=embedded`;
}

function generateToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function completeEmbeddedInstall(supabaseAdmin: ReturnType<typeof createClient>, shop: string, app: ShopifyAppCreds, sessionToken: string) {
  const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.apiKey,
      client_secret: app.apiSecret,
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: OFFLINE_TOKEN_TYPE,
      expiring: "1",
    }),
  });
  if (!resp.ok) {
    console.warn(`[session-verify] embedded token exchange failed for ${shop}: ${resp.status} ${await resp.text()}`);
    return null;
  }
  const tokenJson = await resp.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) return null;

  const shopResp = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });
  const shopData = shopResp.ok ? await shopResp.json() : { shop: {} };
  const shopEmail = shopData.shop?.email || `${shop.replace(".myshopify.com", "")}@shopify-login.local`;
  const shopName = shopData.shop?.name || shop;

  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  let userId = existingUsers?.users?.find((u: { email?: string }) => u.email === shopEmail)?.id ?? null;
  if (!userId) {
    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
      email: shopEmail,
      password: generateToken(),
      email_confirm: true,
      user_metadata: { shop, shop_name: shopName, auth_provider: "shopify" },
    });
    if (error || !newUser?.user) throw new Error(`Failed to create Shopify user: ${error?.message ?? "unknown"}`);
    userId = newUser.user.id;
  }

  const tokenCols = tokenResponseToConnectionColumns(tokenJson);
  await supabaseAdmin.from("shopify_connections").upsert({
    user_id: userId,
    store_url: shop,
    access_token: accessToken,
    api_version: API_VERSION,
    shop_name: shopName,
    updated_at: new Date().toISOString(),
    refresh_token: tokenCols.refresh_token,
    token_expires_at: tokenCols.token_expires_at,
    refresh_token_expires_at: tokenCols.refresh_token_expires_at,
    needs_reauth: false,
  }, { onConflict: "user_id" });

  await supabaseAdmin.from("platform_connections").delete().eq("user_id", userId).eq("platform", "shopify");
  await supabaseAdmin.from("platform_connections").insert({
    user_id: userId,
    platform: "shopify",
    shop_domain: shop,
    access_token: accessToken,
    refresh_token: tokenCols.refresh_token,
    token_expires_at: tokenCols.token_expires_at,
    refresh_token_expires_at: tokenCols.refresh_token_expires_at,
    needs_reauth: false,
    is_active: true,
  });

  console.log(`[session-verify] completed embedded install for ${shop} via ${app.label}`);
  return { user_id: userId, shop_name: shopName };
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
      const knownAuds = (await getAllShopifyApps()).map((a) => `${a.label}:${a.apiKey}`);
      const errorMessages: Record<string, string> = {
        malformed: "Session token is malformed (not a valid JWT).",
        bad_signature: "Session token signature is invalid — none of the configured Shopify app secrets matched.",
        aud_mismatch: `Session token was issued for an unknown Shopify app (aud=${result.tokenAud}). Configured apps: ${knownAuds.join(", ") || "none"}.`,
        expired: "Session token has expired — reload the app from Shopify Admin.",
        error: `Session token verification error: ${result.detail || "unknown"}`,
      };
      return new Response(
        JSON.stringify({
          error: errorMessages[result.reason],
          reason: result.reason,
          token_aud: result.tokenAud,
          configured_apps: knownAuds,
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const payload = result.payload;

    const shop = extractShopDomain((payload.dest || payload.iss) as string);
    console.log("Session verified for shop:", shop);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let { data: conn } = await supabaseAdmin
      .from("shopify_connections")
      .select("user_id, shop_name")
      .eq("store_url", shop)
      .single();

    if (!conn) {
      conn = await completeEmbeddedInstall(supabaseAdmin, shop, result.app, sessionToken);
      if (!conn) {
        return new Response(
          JSON.stringify({
            error: "App not installed for this shop",
            needs_install: true,
            install_url: buildInstallUrl(shop, result.app),
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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
// redeploy: pick up SHOPIFY_API_KEY_2/_SECRET_2

// bump v2
