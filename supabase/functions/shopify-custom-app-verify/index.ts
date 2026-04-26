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
    const accessToken: string = (body?.access_token ?? "").trim();

    const shop_domain = cleanDomain(rawDomain);
    if (!shop_domain || !shop_domain.endsWith(".myshopify.com")) {
      return new Response(
        JSON.stringify({ error: "Invalid store domain. Use yourstore.myshopify.com" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!accessToken || accessToken.length < 10) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Admin API access token" }),
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
      // non-fatal — shopify_connections is the source of truth
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
