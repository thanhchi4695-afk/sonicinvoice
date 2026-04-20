import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY")!;
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET")!;

const SCOPES = "read_products,write_products,read_orders,read_inventory,write_inventory";
const API_VERSION = "2025-01";

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyHmac(query: URLSearchParams): Promise<boolean> {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const params = new URLSearchParams(query);
  params.delete("hmac");
  params.sort();
  const message = params.toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
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
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── POST: Initiate Shopify OAuth login ──
    if (req.method === "POST" && action !== "callback" && action !== "exchange") {
      const body = await req.json();
      const shop = (body.shop || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (!shop || !shop.includes(".myshopify.com")) {
        return new Response(JSON.stringify({ error: "Invalid store URL. Must be yourstore.myshopify.com" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const nonce = generateNonce();
      // Use a special prefix to distinguish login from store-connect
      const state = `login:${nonce}`;

      await supabaseAdmin.from("shopify_oauth_states").upsert({
        user_id: "00000000-0000-0000-0000-000000000000", // placeholder for login flow
        nonce, shop,
        created_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      const redirectUri = `${SUPABASE_URL}/functions/v1/shopify-auth-callback`;
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

      return new Response(JSON.stringify({ install_url: installUrl }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: OAuth callback ──
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const shop = url.searchParams.get("shop") || "";
      const state = url.searchParams.get("state") || "";

      if (!code || !shop || !state) {
        return new Response("Missing required parameters", { status: 400 });
      }

      const valid = await verifyHmac(url.searchParams);
      if (!valid) {
        return new Response("Invalid HMAC signature", { status: 403 });
      }

      if (!state.startsWith("login:")) {
        return new Response("Invalid state for login flow", { status: 400 });
      }
      const nonce = state.replace("login:", "");

      // Verify nonce
      const { data: storedState } = await supabaseAdmin
        .from("shopify_oauth_states")
        .select("nonce, shop")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .single();

      if (!storedState || storedState.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }

      // Exchange code for access token
      const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          code,
        }),
      });

      if (!tokenResp.ok) {
        console.error("Token exchange failed:", await tokenResp.text());
        return new Response("Failed to get access token", { status: 500 });
      }

      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) return new Response("No access token in response", { status: 500 });

      // Fetch shop info for email/name
      const shopResp = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      const shopData = shopResp.ok ? await shopResp.json() : { shop: {} };
      const shopEmail = shopData.shop?.email || `${shop.replace(".myshopify.com", "")}@shopify-login.local`;
      const shopName = shopData.shop?.name || shop;

      // Create or get Supabase user
      let userId: string;
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find((u: { email?: string }) => u.email === shopEmail);

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const randomPass = generateToken();
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: shopEmail,
          password: randomPass,
          email_confirm: true,
          user_metadata: { shop, shop_name: shopName, auth_provider: "shopify" },
        });
        if (createErr || !newUser?.user) {
          console.error("Failed to create user:", createErr);
          return new Response("Failed to create user account", { status: 500 });
        }
        userId = newUser.user.id;
      }

      // Save Shopify connection
      const cleanUrl = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
      await supabaseAdmin.from("shopify_connections").upsert({
        user_id: userId,
        store_url: cleanUrl,
        access_token: accessToken,
        api_version: API_VERSION,
        shop_name: shopName,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      // Create one-time login token
      const loginToken = generateToken();
      await supabaseAdmin.from("shopify_login_tokens").insert({
        token: loginToken,
        user_id: userId,
        shop: cleanUrl,
        access_token: accessToken,
      });

      // Clean up nonce
      await supabaseAdmin.from("shopify_oauth_states")
        .delete().eq("user_id", "00000000-0000-0000-0000-000000000000");

      // Redirect to app with login token — always use APP_URL for stable redirects
      const appUrl = Deno.env.get("APP_URL") || "https://sonicinvoice.lovable.app";
      const redirectTarget = `${appUrl}/?shopify_login=${loginToken}`;

      return new Response(null, { status: 302, headers: { Location: redirectTarget } });
    }

    // ── POST: Exchange token for session ──
    if (req.method === "POST" && action === "exchange") {
      const body = await req.json();
      const token = body.token;
      if (!token) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up token
      const { data: loginData, error: tokenErr } = await supabaseAdmin
        .from("shopify_login_tokens")
        .select("*")
        .eq("token", token)
        .single();

      if (tokenErr || !loginData) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check token age (max 5 minutes)
      const tokenAge = Date.now() - new Date(loginData.created_at).getTime();
      if (tokenAge > 5 * 60 * 1000) {
        await supabaseAdmin.from("shopify_login_tokens").delete().eq("token", token);
        return new Response(JSON.stringify({ error: "Token expired" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete the one-time token before creating session
      await supabaseAdmin.from("shopify_login_tokens").delete().eq("token", token);

      // Use createSession() — the correct Supabase v2 way to issue tokens
      // for a known user_id. generateLink() in Supabase v2 returns a
      // token_hash inside a redirect URL, not access/refresh tokens directly,
      // so hashParams.get("access_token") always returns null.
      const { data: sessionData, error: sessionErr } =
        // deno-lint-ignore no-explicit-any
        await (supabaseAdmin.auth.admin as any).createSession({ user_id: loginData.user_id });

      if (sessionErr || !sessionData?.session) {
        console.error("Failed to create session:", sessionErr);
        return new Response(JSON.stringify({ error: "Failed to create session" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        access_token:  sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        shop: loginData.shop,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Shopify auth error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
