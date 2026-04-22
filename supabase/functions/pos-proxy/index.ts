import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LS_X_CLIENT_ID = Deno.env.get("LS_X_CLIENT_ID") || "";
const LS_X_CLIENT_SECRET = Deno.env.get("LS_X_CLIENT_SECRET") || "";
const LS_X_REDIRECT_URI = (Deno.env.get("APP_URL") || "") + "/auth/lightspeed-x/callback";
// X-Series OAuth (X-Series / Vend uses secure.retail.lightspeed.app, NOT cloud.lightspeedapp.com)
//   Authorize: https://secure.retail.lightspeed.app/connect
//   Token:     https://{prefix}.retail.lightspeed.app/api/1.0/token
//   API base:  https://{prefix}.retail.lightspeed.app/api/2.0
const LS_X_AUTH_URL = "https://secure.retail.lightspeed.app/connect";
const LS_X_TOKEN_URL = (domain: string) =>
  `https://${domain}.retail.lightspeed.app/api/1.0/token`;

const LS_R_CLIENT_ID = Deno.env.get("LS_R_CLIENT_ID") || "";
const LS_R_CLIENT_SECRET = Deno.env.get("LS_R_CLIENT_SECRET") || "";
const LS_R_REDIRECT_URI = (Deno.env.get("APP_URL") || "") + "/auth/lightspeed-r/callback";
const LS_R_AUTH_URL = "https://cloud.lightspeedapp.com/oauth/authorize.php";
const LS_R_TOKEN_URL = "https://cloud.lightspeedapp.com/oauth/access_token.php";
const LS_R_BASE = "https://api.lightspeedapp.com/API/V3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { action, platform } = body;

    // ── OAuth: get auth URL ──
    if (action === "get_auth_url") {
      if (platform === "lightspeed_x") {
        const state = crypto.randomUUID();
        const url = `${LS_X_AUTH_URL}?` + new URLSearchParams({
          response_type: "code",
          client_id: LS_X_CLIENT_ID,
          redirect_uri: LS_X_REDIRECT_URI,
          state,
          scope: "read_products write_products read_inventory write_inventory",
        });
        return respond({ url, state });
      }
      if (platform === "lightspeed_r") {
        const state = crypto.randomUUID();
        const url = `${LS_R_AUTH_URL}?` + new URLSearchParams({
          response_type: "code",
          client_id: LS_R_CLIENT_ID,
          redirect_uri: LS_R_REDIRECT_URI,
          scope: "employee:all",
          state,
        });
        return respond({ url, state });
      }
    }

    // ── OAuth: exchange code for tokens ──
    if (action === "exchange_code") {
      const { code, domain_prefix } = body;

      if (platform === "lightspeed_x") {
        const tokenRes = await fetch(LS_X_TOKEN_URL(domain_prefix), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: LS_X_CLIENT_ID,
            client_secret: LS_X_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: LS_X_REDIRECT_URI,
          }),
        });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) {
          return respond({ error: "Token exchange failed", detail: tokens }, 400);
        }
        const expiresAt = new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString();
        await supabase.from("pos_connections").upsert({
          user_id: user.id,
          platform: "lightspeed_x",
          ls_x_domain_prefix: domain_prefix,
          ls_x_access_token: tokens.access_token,
          ls_x_refresh_token: tokens.refresh_token,
          ls_x_token_expires_at: expiresAt,
        }, { onConflict: "user_id,platform" });
        return respond({ success: true, domain: domain_prefix });
      }

      if (platform === "lightspeed_r") {
        const creds = btoa(`${LS_R_CLIENT_ID}:${LS_R_CLIENT_SECRET}`);
        const tokenRes = await fetch(LS_R_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${creds}`,
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: LS_R_REDIRECT_URI,
          }),
        });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) {
          return respond({ error: "Token exchange failed", detail: tokens }, 400);
        }
        const accountRes = await fetch(`${LS_R_BASE}/Account.json`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const accountData = await accountRes.json();
        const accountId = accountData?.Account?.accountID;

        const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();
        await supabase.from("pos_connections").upsert({
          user_id: user.id,
          platform: "lightspeed_r",
          ls_r_account_id: accountId,
          ls_r_access_token: tokens.access_token,
          ls_r_refresh_token: tokens.refresh_token,
          ls_r_token_expires_at: expiresAt,
        }, { onConflict: "user_id,platform" });
        return respond({ success: true, account_id: accountId });
      }
    }

    // ── PRODUCT LOOKUP ACTIONS ──
    const { data: conn } = await supabase
      .from("pos_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .single();

    if (!conn && platform !== "shopify") {
      return respond({ error: `No ${platform} connection found` }, 404);
    }

    // ═══ LIGHTSPEED X-SERIES ═══
    if (platform === "lightspeed_x" && conn) {
      const accessToken = await ensureValidTokenX(conn, supabase, user.id);
      const domain = conn.ls_x_domain_prefix;
      const xBase = `https://${domain}.retail.lightspeed.app`;
      const xHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      if (action === "search_by_sku") {
        const res = await fetch(
          `${xBase}/api/2.0/products?sku=${encodeURIComponent(body.sku)}`,
          { headers: xHeaders }
        );
        const data = await res.json();
        return respond({ products: data.data || [] });
      }

      if (action === "search_by_name") {
        const res = await fetch(
          `${xBase}/api/2.0/search?type=products&name=${encodeURIComponent(body.name)}`,
          { headers: xHeaders }
        );
        const data = await res.json();
        return respond({ products: data.data || [] });
      }

      if (action === "get_variant_family") {
        const res = await fetch(
          `${xBase}/api/3.0/products/${body.product_id}`,
          { headers: xHeaders }
        );
        const data = await res.json();
        return respond({ product: data.data });
      }

      if (action === "batch_lookup") {
        const { items } = body;
        const results: Record<string, unknown>[] = [];
        for (let i = 0; i < items.length; i += 5) {
          const batch = items.slice(i, i + 5);
          const batchResults = await Promise.all(
            batch.map(async (item: Record<string, string>) => {
              if (item.sku) {
                const res = await fetch(
                  `${xBase}/api/2.0/products?sku=${encodeURIComponent(item.sku)}`,
                  { headers: xHeaders }
                );
                const data = await res.json();
                if (data.data?.length > 0) return { item, found: data.data, searchType: "sku" };
              }
              if (item.styleNumber) {
                const res = await fetch(
                  `${xBase}/api/2.0/search?type=products&sku=${encodeURIComponent(item.styleNumber)}`,
                  { headers: xHeaders }
                );
                const data = await res.json();
                if (data.data?.length > 0) return { item, found: data.data, searchType: "style_prefix" };
              }
              if (item.styleName) {
                const res = await fetch(
                  `${xBase}/api/2.0/search?type=products&name=${encodeURIComponent(item.styleName)}`,
                  { headers: xHeaders }
                );
                const data = await res.json();
                if (data.data?.length > 0) return { item, found: data.data, searchType: "name" };
              }
              return { item, found: [], searchType: "none" };
            })
          );
          results.push(...batchResults);
          if (i + 5 < items.length) await new Promise(r => setTimeout(r, 200));
        }
        return respond({ results });
      }

      if (action === "update_inventory_x") {
        const { product_id, outlet_id, quantity_delta } = body;
        const currentRes = await fetch(
          `${xBase}/api/2.0/inventory?product_id=${product_id}&outlet_id=${outlet_id}`,
          { headers: xHeaders }
        );
        const currentData = await currentRes.json();
        const currentCount = currentData.data?.[0]?.count || 0;
        const newCount = currentCount + quantity_delta;
        const updateRes = await fetch(`${xBase}/api/2.0/inventory`, {
          method: "PUT",
          headers: xHeaders,
          body: JSON.stringify({ product_id, outlet_id, count: newCount }),
        });
        const updateData = await updateRes.json();
        return respond({ success: updateRes.ok, new_count: newCount, detail: updateData });
      }
    }

    // ═══ LIGHTSPEED R-SERIES ═══
    if (platform === "lightspeed_r" && conn) {
      const accessToken = await ensureValidTokenR(conn, supabase, user.id);
      const accountId = conn.ls_r_account_id;
      const rBase = `${LS_R_BASE}/Account/${accountId}`;
      const rHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      if (action === "search_by_sku") {
        const { sku } = body;
        const codeRes = await fetch(
          `${rBase}/Item.json?itemCode=${encodeURIComponent(sku)}&load_relations=["ItemMatrix","ItemShops"]`,
          { headers: rHeaders }
        );
        const codeData = await codeRes.json();
        if (codeData.Item) {
          return respond({
            items: Array.isArray(codeData.Item) ? codeData.Item : [codeData.Item],
            searchType: "itemCode",
          });
        }
        const skuRes = await fetch(
          `${rBase}/Item.json?customSku=${encodeURIComponent(sku)}&load_relations=["ItemMatrix","ItemShops"]`,
          { headers: rHeaders }
        );
        const skuData = await skuRes.json();
        return respond({
          items: skuData.Item ? (Array.isArray(skuData.Item) ? skuData.Item : [skuData.Item]) : [],
          searchType: "customSku",
        });
      }

      if (action === "search_by_name") {
        const res = await fetch(
          `${rBase}/Item.json?description=${encodeURIComponent(body.name)}&load_relations=["ItemMatrix"]`,
          { headers: rHeaders }
        );
        const data = await res.json();
        return respond({
          items: data.Item ? (Array.isArray(data.Item) ? data.Item : [data.Item]) : [],
        });
      }

      if (action === "get_item_matrix") {
        const res = await fetch(
          `${rBase}/ItemMatrix/${body.matrix_id}.json?load_relations=["Items","Attributes"]`,
          { headers: rHeaders }
        );
        const data = await res.json();
        return respond({ matrix: data.ItemMatrix });
      }

      if (action === "batch_lookup") {
        const { items } = body;
        const results: Record<string, unknown>[] = [];
        for (let i = 0; i < items.length; i += 3) {
          const batch = items.slice(i, i + 3);
          const batchResults = await Promise.all(
            batch.map(async (item: Record<string, string>) => {
              if (item.sku) {
                const res = await fetch(
                  `${rBase}/Item.json?itemCode=${encodeURIComponent(item.sku)}&load_relations=["ItemMatrix"]`,
                  { headers: rHeaders }
                );
                const data = await res.json();
                if (data.Item) {
                  return {
                    item,
                    found: Array.isArray(data.Item) ? data.Item : [data.Item],
                    searchType: "sku",
                  };
                }
              }
              if (item.styleName) {
                const res = await fetch(
                  `${rBase}/Item.json?description=${encodeURIComponent(item.styleName)}&load_relations=["ItemMatrix"]`,
                  { headers: rHeaders }
                );
                const data = await res.json();
                return {
                  item,
                  found: data.Item ? (Array.isArray(data.Item) ? data.Item : [data.Item]) : [],
                  searchType: "name",
                };
              }
              return { item, found: [], searchType: "none" };
            })
          );
          results.push(...batchResults);
          if (i + 3 < items.length) await new Promise(r => setTimeout(r, 350));
        }
        return respond({ results });
      }

      if (action === "update_inventory_r") {
        const { item_id, shop_id, new_quantity } = body;
        const res = await fetch(
          `${rBase}/ItemShop.json?itemID=${item_id}&shopID=${shop_id}`,
          { headers: rHeaders }
        );
        const shopData = await res.json();
        const itemShopID = shopData.ItemShop?.itemShopID;
        if (!itemShopID) return respond({ error: "ItemShop not found" }, 404);
        const updateRes = await fetch(`${rBase}/ItemShop/${itemShopID}.json`, {
          method: "PUT",
          headers: rHeaders,
          body: JSON.stringify({ count: new_quantity }),
        });
        return respond({ success: updateRes.ok });
      }
    }

    // ═══ SHOPIFY ═══
    if (platform === "shopify") {
      const { data: shopifyConn } = await supabase
        .from("shopify_connections")
        .select("shop_name, store_url")
        .eq("user_id", user.id)
        .maybeSingle();

      if (action === "check_connection") {
        return respond({
          connected: !!shopifyConn,
          shop: shopifyConn?.shop_name || shopifyConn?.store_url || null,
        });
      }
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (err) {
    return respond({
      error: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
});

// ── TOKEN REFRESH HELPERS ──

async function ensureValidTokenX(
  conn: Record<string, string>,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<string> {
  const expiresAt = new Date(conn.ls_x_token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return conn.ls_x_access_token;
  }
  const domain = conn.ls_x_domain_prefix;
  const tokenRes = await fetch(LS_X_TOKEN_URL(domain), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: LS_X_CLIENT_ID,
      client_secret: LS_X_CLIENT_SECRET,
      refresh_token: conn.ls_x_refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await tokenRes.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString();
  await supabase.from("pos_connections")
    .update({
      ls_x_access_token: tokens.access_token,
      ls_x_refresh_token: tokens.refresh_token || conn.ls_x_refresh_token,
      ls_x_token_expires_at: newExpiry,
    })
    .eq("user_id", userId).eq("platform", "lightspeed_x");
  return tokens.access_token;
}

async function ensureValidTokenR(
  conn: Record<string, string>,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<string> {
  const expiresAt = new Date(conn.ls_r_token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return conn.ls_r_access_token;
  }
  const creds = btoa(`${LS_R_CLIENT_ID}:${LS_R_CLIENT_SECRET}`);
  const tokenRes = await fetch(LS_R_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${creds}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.ls_r_refresh_token,
    }),
  });
  const tokens = await tokenRes.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();
  await supabase.from("pos_connections")
    .update({
      ls_r_access_token: tokens.access_token,
      ls_r_refresh_token: tokens.refresh_token || conn.ls_r_refresh_token,
      ls_r_token_expires_at: newExpiry,
    })
    .eq("user_id", userId).eq("platform", "lightspeed_r");
  return tokens.access_token;
}
