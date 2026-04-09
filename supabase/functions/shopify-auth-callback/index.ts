import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_KEY     = Deno.env.get("SHOPIFY_API_KEY")!;
const SHOPIFY_API_SECRET  = Deno.env.get("SHOPIFY_API_SECRET")!;
const API_VERSION         = "2025-01";
const APP_URL             = Deno.env.get("APP_URL") || "https://sonicinvoice.lovable.app";

function generateToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2,"0")).join("");
}

async function verifyHmac(query: URLSearchParams): Promise<boolean> {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const params = new URLSearchParams(query);
  params.delete("hmac");
  params.sort();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, encoder.encode(params.toString())
  );
  const computed = Array.from(
    new Uint8Array(sig), b => b.toString(16).padStart(2,"0")
  ).join("");
  return computed === hmac;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url   = new URL(req.url);
    const code  = url.searchParams.get("code")  || "";
    const shop  = url.searchParams.get("shop")  || "";
    const state = url.searchParams.get("state") || "";

    if (!code || !shop || !state) {
      return new Response("Missing required parameters", { status: 400 });
    }

    const valid = await verifyHmac(url.searchParams);
    if (!valid) {
      return new Response("Invalid HMAC signature", { status: 403 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const isLoginFlow = state.startsWith("login:");

    if (isLoginFlow) {
      const nonce = state.replace("login:", "");
      const { data: stored } = await supabase
        .from("shopify_oauth_states")
        .select("nonce, shop")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .single();

      if (!stored || stored.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }
    } else {
      const [userId, nonce] = state.split(":");
      if (!userId || !nonce) {
        return new Response("Invalid state parameter", { status: 400 });
      }
      const { data: stored } = await supabase
        .from("shopify_oauth_states")
        .select("nonce")
        .eq("user_id", userId)
        .single();

      if (!stored || stored.nonce !== nonce) {
        return new Response("Invalid or expired state", { status: 403 });
      }
    }

    // Exchange code for access token
    const tokenResp = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:     SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          code,
        }),
      }
    );

    if (!tokenResp.ok) {
      console.error("Token exchange failed:", await tokenResp.text());
      return new Response("Failed to get access token", { status: 500 });
    }

    const { access_token: accessToken } = await tokenResp.json();
    if (!accessToken) {
      return new Response("No access token in response", { status: 500 });
    }

    // Fetch shop info
    const shopResp = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/shop.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }
    );
    const shopData = shopResp.ok ? await shopResp.json() : { shop: {} };
    const shopEmail = shopData.shop?.email ||
      `${shop.replace(".myshopify.com", "")}@shopify-login.local`;
    const shopName = shopData.shop?.name || shop;
    const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (isLoginFlow) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(u => u.email === shopEmail);

      let userId: string;
      if (existing) {
        userId = existing.id;
      } else {
        const { data: newUser, error } =
          await supabase.auth.admin.createUser({
            email: shopEmail,
            password: generateToken(),
            email_confirm: true,
            user_metadata: {
              shop, shop_name: shopName, auth_provider: "shopify"
            },
          });
        if (error || !newUser?.user) {
          console.error("Failed to create user:", error);
          return new Response("Failed to create user", { status: 500 });
        }
        userId = newUser.user.id;
      }

      await supabase.from("shopify_connections").upsert({
        user_id:      userId,
        store_url:    cleanShop,
        access_token: accessToken,
        api_version:  API_VERSION,
        shop_name:    shopName,
        updated_at:   new Date().toISOString(),
      }, { onConflict: "user_id" });

      const loginToken = generateToken();
      await supabase.from("shopify_login_tokens").insert({
        token:        loginToken,
        user_id:      userId,
        shop:         cleanShop,
        access_token: accessToken,
      });

      await supabase.from("shopify_oauth_states")
        .delete()
        .eq("user_id", "00000000-0000-0000-0000-000000000000");

      return new Response(null, {
        status: 302,
        headers: { Location: `${APP_URL}/?shopify_login=${loginToken}` },
      });

    } else {
      const [userId] = state.split(":");
      await supabase.from("shopify_connections").upsert({
        user_id:      userId,
        store_url:    cleanShop,
        access_token: accessToken,
        api_version:  API_VERSION,
        shop_name:    shopName,
        updated_at:   new Date().toISOString(),
      }, { onConflict: "user_id" });

      await supabase.from("shopify_oauth_states")
        .delete().eq("user_id", userId);

      return new Response(null, {
        status: 302,
        headers: { Location: `${APP_URL}/?shopify_connected=1` },
      });
    }

  } catch (err) {
    console.error("Callback error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
