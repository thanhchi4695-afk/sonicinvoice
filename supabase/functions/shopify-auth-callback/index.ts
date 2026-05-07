/**
 * Shopify OAuth Callback — Clean URL Handler
 *
 * URL: https://xuaakgdkkrrsqxafffyj.supabase.co/functions/v1/shopify-auth-callback
 *
 * Why this exists: Shopify's Partner Dashboard rejects redirect URLs that
 * contain reserved query parameters like ?action=callback. This function
 * lives at a clean path so it can be registered as the redirect URL.
 *
 * REQUIRED: Disable JWT verification in Supabase Dashboard for this function:
 *   Edge Functions → shopify-auth-callback → Settings → uncheck "Enforce JWT Verification"
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { tokenResponseToConnectionColumns } from "../_shared/shopify-token.ts";
import { getShopifyAppByKey, getShopifyAppByShop, getPrimaryShopifyApp, type ShopifyAppCreds } from "../_shared/shopify-apps.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL                   = Deno.env.get("APP_URL") || "https://sonicinvoice.lovable.app";
const API_VERSION               = "2025-01";

async function resolveApp(shop: string, query: URLSearchParams): Promise<ShopifyAppCreds> {
  // Shopify includes client_id on app-initiated install/callback requests. Prefer
  // that over shop pinning so a merchant can reinstall from the Partner/Admin
  // install URL even if the app-specific shop pin is temporarily missing.
  const byClientId = await getShopifyAppByKey(query.get("client_id"));
  const pinned = byClientId ? null : await getShopifyAppByShop(shop);
  const app = byClientId ?? pinned ?? getPrimaryShopifyApp();
  if (!app) throw new Error("No Shopify app credentials configured");
  console.log(`[shopify-auth-callback] shop=${shop} -> app=${app.label} key=${app.apiKey.slice(0, 6)}…`);
  return app;
}

function generateToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyHmac(query: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const params = new URLSearchParams(query);
  params.delete("hmac");
  params.sort();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(params.toString()));
  const computed = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  return computed === hmac;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const url   = new URL(req.url);
    const code  = url.searchParams.get("code")  || "";
    const shop  = url.searchParams.get("shop")  || "";
    const state = url.searchParams.get("state") || "";

    if (!code || !shop) {
      return new Response("Missing required parameters (code, shop)", { status: 400 });
    }

    const app = await resolveApp(shop, url.searchParams);
    const valid = await verifyHmac(url.searchParams, app.apiSecret);
    if (!valid) {
      return new Response("Invalid HMAC signature", { status: 403 });
    }

    const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const isLoginFlow = state.startsWith("login:");
    const isConnectFlow = state.includes(":") && !isLoginFlow;
    // If state doesn't match our patterns, it's a Shopify-initiated install
    const isShopifyInitiated = !isLoginFlow && !isConnectFlow;

    // Validate state against DB only for self-initiated flows
    if (isLoginFlow) {
      const nonce = state.replace("login:", "");
      const { data: stored } = await supabase
        .from("shopify_oauth_states")
        .select("nonce")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .single();
      if (!stored || stored.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }
    } else if (isConnectFlow) {
      const [userId, nonce] = state.split(":");
      if (!userId || !nonce) return new Response("Invalid state parameter", { status: 400 });
      const { data: stored } = await supabase
        .from("shopify_oauth_states")
        .select("nonce")
        .eq("user_id", userId)
        .single();
      if (!stored || stored.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }
    }
    // For Shopify-initiated installs, HMAC verification is sufficient

    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: app.apiKey, client_secret: app.apiSecret, code, expiring: true }),
    });
    if (!tokenResp.ok) {
      console.error("Token exchange failed:", await tokenResp.text());
      return new Response("Failed to get access token", { status: 500 });
    }
    const tokenJson = await tokenResp.json();
    const { access_token: accessToken } = tokenJson;
    if (!accessToken) return new Response("No access token in response", { status: 500 });
    const tokenCols = tokenResponseToConnectionColumns(tokenJson);

    const shopResp = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    const shopData  = shopResp.ok ? await shopResp.json() : { shop: {} };
    const shopEmail = shopData.shop?.email || `${shop.replace(".myshopify.com", "")}@shopify-login.local`;
    const shopName  = shopData.shop?.name || shop;
    const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (isLoginFlow || isShopifyInitiated) {
      // Prefer the currently logged-in user (if a Supabase session JWT was
      // forwarded with the OAuth callback). This avoids forking a shadow
      // account when an existing merchant installs the app while logged in.
      let userId: string | null = null;

      const authHeader = req.headers.get("Authorization") || "";
      const bearer = authHeader.replace(/^Bearer\s+/i, "");
      if (bearer) {
        try {
          const { data: { user: sessionUser } } = await supabase.auth.getUser(bearer);
          if (sessionUser?.id) userId = sessionUser.id;
        } catch (e) {
          console.warn("Bearer present but getUser failed:", e);
        }
      }

      // Fall back to find/create-by-shop-email (headless install path)
      if (!userId) {
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existing = existingUsers?.users?.find((u: { email?: string }) => u.email === shopEmail);

        if (existing) {
          userId = existing.id;
        } else {
          const { data: newUser, error } = await supabase.auth.admin.createUser({
            email: shopEmail, password: generateToken(), email_confirm: true,
            user_metadata: { shop, shop_name: shopName, auth_provider: "shopify" },
          });
          if (error || !newUser?.user) {
            console.error("Failed to create user:", error);
            return new Response("Failed to create user", { status: 500 });
          }
          userId = newUser.user.id;
        }
      }

      await supabase.from("shopify_connections").upsert({
        user_id: userId, store_url: cleanShop, access_token: accessToken,
        api_version: API_VERSION, shop_name: shopName, updated_at: new Date().toISOString(),
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
      }, { onConflict: "user_id" });

      await supabase.from("platform_connections").delete()
        .eq("user_id", userId)
        .eq("platform", "shopify");

      await supabase.from("platform_connections").insert({
        user_id: userId,
        platform: "shopify",
        shop_domain: cleanShop,
        access_token: accessToken,
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
        is_active: true,
      });

      const loginToken = generateToken();
      await supabase.from("shopify_login_tokens").insert({
        token: loginToken, user_id: userId, shop: cleanShop, access_token: accessToken,
      });

      if (isLoginFlow) {
        await supabase.from("shopify_oauth_states")
          .delete().eq("user_id", "00000000-0000-0000-0000-000000000000");
      }

      // For embedded apps, redirect back into the Shopify Admin iframe
      const redirectUrl = isShopifyInitiated
        ? `https://${shop}/admin/apps/${app.apiKey}`
        : `${APP_URL}/?shopify_login=${loginToken}`;

      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });

    } else {
      // Connect flow: user already logged in, linking store
      const [userId] = state.split(":");
      await supabase.from("shopify_connections").upsert({
        user_id: userId, store_url: cleanShop, access_token: accessToken,
        api_version: API_VERSION, shop_name: shopName, updated_at: new Date().toISOString(),
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
      }, { onConflict: "user_id" });
      await supabase.from("platform_connections").delete()
        .eq("user_id", userId)
        .eq("platform", "shopify");
      await supabase.from("platform_connections").insert({
        user_id: userId,
        platform: "shopify",
        shop_domain: cleanShop,
        access_token: accessToken,
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
        is_active: true,
      });
      await supabase.from("shopify_oauth_states").delete().eq("user_id", userId);

      return new Response(null, {
        status: 302,
        headers: { Location: `${APP_URL}/?shopify_connected=1` },
      });
    }

  } catch (err) {
    console.error("Auth callback error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});