import { createClient } from "npm:@supabase/supabase-js@2";
import { tokenResponseToConnectionColumns } from "../_shared/shopify-token.ts";
import { getShopifyAppByShop, getPrimaryShopifyApp, type ShopifyAppCreds } from "../_shared/shopify-apps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function resolveApp(shop: string): Promise<ShopifyAppCreds> {
  const pinned = await getShopifyAppByShop(shop);
  const app = pinned ?? getPrimaryShopifyApp();
  if (!app) throw new Error("No Shopify app credentials configured");
  console.log(`[shopify-oauth] shop=${shop} -> app=${app.label} key=${app.apiKey.slice(0, 6)}…`);
  return app;
}
const APP_URL = Deno.env.get("APP_URL") || "https://sonicinvoice.lovable.app";

const SCOPES = "read_products,write_products,read_orders,read_inventory,write_inventory";
const API_VERSION = "2025-01";

function getRedirectUri(req: Request): string {
  // Build callback URL pointing to this same edge function
  return `${SUPABASE_URL}/functions/v1/shopify-auth-callback`;
}

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyHmac(query: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = query.get("hmac");
  if (!hmac) return false;

  const params = new URLSearchParams(query);
  params.delete("hmac");
  params.sort();
  const message = params.toString();

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const computed = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
  return computed === hmac;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    // POST /shopify-oauth — initiate OAuth
    if (req.method === "POST" && action !== "callback") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing authorization" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
      if (!anonKey) {
        return new Response(JSON.stringify({ error: "Server misconfigured: missing anon key" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const supabaseUser = createClient(SUPABASE_URL, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const shop = (body.shop || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (!shop || !shop.includes(".myshopify.com")) {
        return new Response(JSON.stringify({ error: "Invalid store URL. Must be yourstore.myshopify.com" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const nonce = generateNonce();
      const state = `${user.id}:${nonce}`;

      // Store nonce in supabase for verification
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabaseAdmin.from("shopify_oauth_states").upsert({
        user_id: user.id,
        nonce,
        shop,
        created_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      const redirectUri = getRedirectUri(req);
      const app = await resolveApp(shop);
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${app.apiKey}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

      return new Response(JSON.stringify({ install_url: installUrl }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /shopify-oauth?action=callback — handle Shopify callback
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const shop = url.searchParams.get("shop") || "";
      const state = url.searchParams.get("state") || "";

      if (!code || !shop || !state) {
        return new Response("Missing required parameters", { status: 400 });
      }

      // Resolve credentials by shop, then verify HMAC with that secret.
      const app = await resolveApp(shop);
      const valid = await verifyHmac(url.searchParams, app.apiSecret);
      if (!valid) {
        return new Response("Invalid HMAC signature", { status: 403 });
      }

      // Parse state
      const [userId, nonce] = state.split(":");
      if (!userId || !nonce) {
        return new Response("Invalid state parameter", { status: 400 });
      }

      // Verify nonce
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: storedState } = await supabaseAdmin
        .from("shopify_oauth_states")
        .select("nonce, shop")
        .eq("user_id", userId)
        .single();

      if (!storedState || storedState.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }

      // Exchange code for access token (request expiring offline token)
      const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: app.apiKey,
          client_secret: app.apiSecret,
          code,
          expiring: true,
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error("Token exchange failed:", errText);
        return new Response("Failed to get access token", { status: 500 });
      }

      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return new Response("No access token in response", { status: 500 });
      }

      const tokenCols = tokenResponseToConnectionColumns(tokenData);

      // Fetch shop info
      const shopResp = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      const shopData = shopResp.ok ? await shopResp.json() : { shop: {} };
      const shopName = shopData.shop?.name || shop;

      // Save connection
      const cleanUrl = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
      await supabaseAdmin.from("shopify_connections").upsert({
        user_id: userId,
        store_url: cleanUrl,
        access_token: accessToken,
        api_version: API_VERSION,
        shop_name: shopName,
        updated_at: new Date().toISOString(),
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
      }, { onConflict: "user_id" });

      // Mirror into platform_connections so unified consumers see the new tokens
      await supabaseAdmin.from("platform_connections").delete()
        .eq("user_id", userId)
        .eq("platform", "shopify");

      await supabaseAdmin.from("platform_connections").insert({
        user_id: userId,
        platform: "shopify",
        shop_domain: cleanUrl,
        access_token: accessToken,
        refresh_token: tokenCols.refresh_token,
        token_expires_at: tokenCols.token_expires_at,
        refresh_token_expires_at: tokenCols.refresh_token_expires_at,
        needs_reauth: false,
        is_active: true,
      });

      // Clean up nonce
      await supabaseAdmin.from("shopify_oauth_states").delete().eq("user_id", userId);

      // Redirect back to app using stable APP_URL
      const redirectTarget = `${APP_URL}/?shopify_connected=1`;

      return new Response(null, {
        status: 302,
        headers: { Location: redirectTarget },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Shopify OAuth error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
