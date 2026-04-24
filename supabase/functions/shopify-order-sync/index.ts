import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { verifyShopifySessionToken, extractShopDomain } from "../_shared/verify-session-token.ts";
import { ensureValidToken, ShopifyReauthRequiredError, type ShopifyConnectionRow } from "../_shared/shopify-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SyncResult {
  user_id: string;
  shop: string;
  synced: number;
  skipped: number;
  total: number;
  error?: string;
}

async function syncOrdersForUser(
  supabaseAdmin: any,
  userId: string,
  conn: { store_url: string; access_token: string; api_version: string; shop_name: string | null },
  sinceDate: string | null,
): Promise<SyncResult> {
  const { store_url, access_token, api_version } = conn;
  const baseUrl = `https://${store_url}/admin/api/${api_version}`;

  const allLineItems: Array<{
    order_ref: string;
    sold_at: string;
    sku: string | null;
    quantity: number;
    revenue: number;
  }> = [];

  let pageUrl = `${baseUrl}/orders.json?status=any&limit=250&fields=id,name,created_at,line_items,financial_status`;
  if (sinceDate) pageUrl += `&created_at_min=${sinceDate}`;

  let pageCount = 0;
  const MAX_PAGES = 20;

  while (pageUrl && pageCount < MAX_PAGES) {
    const resp = await fetch(pageUrl, {
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
    });

    if (resp.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!resp.ok) {
      return { user_id: userId, shop: store_url, synced: 0, skipped: 0, total: 0, error: `Shopify ${resp.status}` };
    }

    const data = await resp.json();
    for (const order of data.orders || []) {
      if (order.financial_status === "refunded" || order.financial_status === "voided") continue;
      for (const li of order.line_items || []) {
        allLineItems.push({
          order_ref: order.name || String(order.id),
          sold_at: order.created_at,
          sku: li.sku || null,
          quantity: li.quantity || 1,
          revenue: parseFloat(li.price || "0") * (li.quantity || 1),
        });
      }
    }

    const linkHeader = resp.headers.get("link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : "";
    pageCount++;
  }

  if (allLineItems.length === 0) {
    return { user_id: userId, shop: store_url, synced: 0, skipped: 0, total: 0 };
  }

  // Enrich costs from variants table
  const skus = [...new Set(allLineItems.filter(li => li.sku).map(li => li.sku!))];
  const costMap: Record<string, number> = {};
  for (let i = 0; i < skus.length; i += 100) {
    const batch = skus.slice(i, i + 100);
    const { data: variants } = await supabaseAdmin
      .from("variants").select("sku, cost").eq("user_id", userId).in("sku", batch);
    if (variants) for (const v of variants) if (v.sku && v.cost > 0) costMap[v.sku] = v.cost;
  }

  const rows = allLineItems.map((li) => ({
    user_id: userId,
    order_ref: li.order_ref,
    sold_at: li.sold_at,
    product_id: null,
    variant_id: null,
    quantity_sold: li.quantity,
    revenue: li.revenue,
    cost_of_goods: (li.sku && costMap[li.sku] ? costMap[li.sku] : 0) * li.quantity,
    source: "shopify",
  }));

  // Deduplicate
  const orderRefs = [...new Set(rows.map(r => r.order_ref))];
  const existingRefs = new Set<string>();
  for (let i = 0; i < orderRefs.length; i += 100) {
    const batch = orderRefs.slice(i, i + 100);
    const { data: existing } = await supabaseAdmin
      .from("sales_data").select("order_ref")
      .eq("user_id", userId).eq("source", "shopify").in("order_ref", batch);
    if (existing) for (const e of existing) if (e.order_ref) existingRefs.add(e.order_ref);
  }

  const newRows = rows.filter(r => !existingRefs.has(r.order_ref));
  if (newRows.length === 0) {
    return { user_id: userId, shop: store_url, synced: 0, skipped: rows.length, total: allLineItems.length };
  }

  let inserted = 0;
  for (let i = 0; i < newRows.length; i += 500) {
    const batch = newRows.slice(i, i + 500);
    const { error } = await supabaseAdmin.from("sales_data").insert(batch);
    if (!error) inserted += batch.length;
    else console.error(`Insert error for user ${userId}:`, error);
  }

  return { user_id: userId, shop: store_url, synced: inserted, skipped: rows.length - newRows.length, total: allLineItems.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const sinceDate = body.since || null;

    // Determine mode: single-user (authenticated) or cron (all users)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader) {
      const bearerToken = authHeader.replace("Bearer ", "");

      // Try Shopify session token
      const sessionPayload = await verifyShopifySessionToken(bearerToken);
      if (sessionPayload) {
        const shop = extractShopDomain(sessionPayload.dest || sessionPayload.iss);
        const { data: c } = await supabaseAdmin
          .from("shopify_connections").select("user_id").eq("store_url", shop).single();
        if (c) userId = c.user_id;
      }

      // Fallback: Supabase JWT
      if (!userId) {
        const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await supabaseUser.auth.getUser();
        if (user) userId = user.id;
      }
    }

    // Single-user mode
    if (userId) {
      const { data: conn } = await supabaseAdmin
        .from("shopify_connections").select("*").eq("user_id", userId).single();

      if (!conn) {
        return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await syncOrdersForUser(supabaseAdmin, userId, conn, sinceDate);
      return new Response(JSON.stringify({
        success: true,
        synced: result.synced,
        skipped: result.skipped,
        total_orders: result.total,
        message: result.error || `Synced ${result.synced} new line items from Shopify orders`,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cron mode: sync all users with Shopify connections
    const { data: connections } = await supabaseAdmin
      .from("shopify_connections").select("user_id, store_url, access_token, api_version, shop_name");

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No Shopify connections to sync", results: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default to last 2 days for cron
    const cronSince = sinceDate || new Date(Date.now() - 2 * 86400000).toISOString();
    const results: SyncResult[] = [];

    for (const conn of connections) {
      try {
        const result = await syncOrdersForUser(supabaseAdmin, conn.user_id, conn, cronSince);
        results.push(result);
        console.log(`Order sync for ${conn.store_url}: ${result.synced} new, ${result.skipped} skipped`);
      } catch (err: any) {
        results.push({ user_id: conn.user_id, shop: conn.store_url, synced: 0, skipped: 0, total: 0, error: err.message });
        console.error(`Order sync failed for ${conn.store_url}:`, err.message);
      }
      // Rate limit between stores
      await new Promise((r) => setTimeout(r, 500));
    }

    const totalSynced = results.reduce((s, r) => s + r.synced, 0);
    return new Response(JSON.stringify({
      success: true,
      stores: results.length,
      total_synced: totalSynced,
      results,
      message: `Cron sync complete: ${totalSynced} new line items across ${results.length} stores`,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Order sync error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
