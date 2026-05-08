// Verifies a Shopify Custom App Admin API token by calling /admin/api/{ver}/shop.json
// and persists it to shopify_connections + platform_connections so the rest of the app
// (which already supports both OAuth and direct tokens) treats it identically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_VERSION = "2025-01";

function cleanDomain(input: string): string {
  let d = (input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d.includes(".myshopify.com") && d.length > 0) {
    d = `${d}.myshopify.com`;
  }
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify the calling user from their JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const rawDomain: string = body?.shop_domain ?? body?.domain ?? "";
    let accessToken: string = (body?.access_token ?? "").trim();
    const clientId: string = (body?.client_id ?? "").trim();
    const clientSecret: string = (body?.client_secret ?? "").trim();

    const shop_domain = cleanDomain(rawDomain);
    if (!shop_domain || !shop_domain.endsWith(".myshopify.com")) {
      return new Response(
        JSON.stringify({ error: "Invalid store domain. Use yourstore.myshopify.com" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If no access token, try client_credentials grant (Shopify Dev Dashboard apps)
    if (!accessToken && clientId && clientSecret) {
      const tokenRes = await fetch(
        `https://${shop_domain}/admin/oauth/access_token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );
      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => "");
        console.error("client_credentials exchange failed", tokenRes.status, errText);
        return new Response(
          JSON.stringify({
            error: `Client credentials rejected (${tokenRes.status}). Check the Client ID, Client Secret, and that the app is installed on this store.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const tokenJson = await tokenRes.json().catch(() => ({} as Record<string, unknown>));
      accessToken = String(tokenJson?.access_token ?? "").trim();
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "Shopify did not return an access_token from client_credentials grant." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!accessToken || accessToken.length < 10) {
      return new Response(
        JSON.stringify({ error: "Provide either an Admin API access token or client_id + client_secret" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify the token with Shopify
    const shopRes = await fetch(
      `https://${shop_domain}/admin/api/${API_VERSION}/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    if (!shopRes.ok) {
      const errText = await shopRes.text().catch(() => "");
      console.error("Shopify shop.json verify failed", shopRes.status, errText);
      return new Response(
        JSON.stringify({
          error:
            "Token rejected — check the domain and token, and confirm the Custom App has read_products, write_products, read_inventory, write_inventory, read_locations scopes.",
          shopify_status: shopRes.status,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const shopJson = await shopRes.json();
    const shopName: string = shopJson?.shop?.name ?? shop_domain;

    // Persist using service role (bypasses RLS, but we scope by userId)
    const admin = createClient(supabaseUrl, serviceKey);
    const updatedAt = new Date().toISOString();

    const { error: shopifyErr } = await admin
      .from("shopify_connections")
      .upsert(
        {
          user_id: userId,
          store_url: shop_domain,
          access_token: accessToken,
          api_version: API_VERSION,
          shop_name: shopName,
          updated_at: updatedAt,
        },
        { onConflict: "user_id" },
      );
    if (shopifyErr) {
      console.error("shopify_connections upsert failed", shopifyErr);
      return new Response(
        JSON.stringify({ error: `Save failed: ${shopifyErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mirror to platform_connections so the rest of the app sees it consistently
    await admin
      .from("platform_connections")
      .delete()
      .eq("user_id", userId)
      .eq("platform", "shopify");

    const { error: platErr } = await admin
      .from("platform_connections")
      .insert({
        user_id: userId,
        platform: "shopify",
        shop_domain,
        access_token: accessToken,
        is_active: true,
        needs_reauth: false,
      });
    if (platErr) {
      console.error("platform_connections insert failed", platErr);
      // Try upsert as fallback in case row already exists
      const { error: upsertErr } = await admin
        .from("platform_connections")
        .upsert({
          user_id: userId,
          platform: "shopify",
          shop_domain,
          access_token: accessToken,
          is_active: true,
          needs_reauth: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,platform" });

      if (upsertErr) {
        console.error("platform_connections upsert also failed:", upsertErr);
        return new Response(
          JSON.stringify({
            error: `Connection saved to Shopify but UI sync failed: ${upsertErr.message}. Try refreshing.`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        shop_name: shopName,
        shop_domain,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("shopify-custom-app-verify error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
