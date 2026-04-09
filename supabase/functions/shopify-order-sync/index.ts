import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { verifyShopifySessionToken, extractShopDomain } from "../_shared/verify-session-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let userId: string | null = null;

    const bearerToken = authHeader.replace("Bearer ", "");

    // Try Shopify session token first
    const sessionPayload = await verifyShopifySessionToken(bearerToken);
    if (sessionPayload) {
      const shop = extractShopDomain(sessionPayload.dest || sessionPayload.iss);
      const { data: conn } = await supabaseAdmin
        .from("shopify_connections")
        .select("user_id")
        .eq("store_url", shop)
        .single();
      if (conn) userId = conn.user_id;
    }

    // Fallback: Supabase JWT
    if (!userId) {
      const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Shopify connection
    const { data: conn, error: connError } = await supabaseAdmin
      .from("shopify_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (connError || !conn) {
      return new Response(JSON.stringify({ error: "No Shopify connection found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const sinceDate = body.since || null; // ISO date string, optional
    const { store_url, access_token, api_version } = conn;
    const baseUrl = `https://${store_url}/admin/api/${api_version}`;

    // Fetch orders with pagination
    const allLineItems: Array<{
      order_ref: string;
      sold_at: string;
      product_id: string | null;
      variant_id: string | null;
      sku: string | null;
      quantity: number;
      revenue: number;
      cost: number;
      title: string;
    }> = [];

    let pageUrl = `${baseUrl}/orders.json?status=any&limit=250&fields=id,name,created_at,line_items,financial_status`;
    if (sinceDate) {
      pageUrl += `&created_at_min=${sinceDate}`;
    }

    let pageCount = 0;
    const MAX_PAGES = 20; // Safety limit: 5000 orders max

    while (pageUrl && pageCount < MAX_PAGES) {
      const resp = await fetch(pageUrl, {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": access_token,
        },
      });

      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: "Failed to fetch orders", details: errData }), {
          status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const orders = data.orders || [];

      for (const order of orders) {
        // Skip refunded/voided orders
        if (order.financial_status === "refunded" || order.financial_status === "voided") continue;

        for (const li of order.line_items || []) {
          allLineItems.push({
            order_ref: order.name || String(order.id),
            sold_at: order.created_at,
            product_id: li.product_id ? String(li.product_id) : null,
            variant_id: li.variant_id ? String(li.variant_id) : null,
            sku: li.sku || null,
            quantity: li.quantity || 1,
            revenue: parseFloat(li.price || "0") * (li.quantity || 1),
            cost: 0, // Will try to enrich below
            title: li.title || "",
          });
        }
      }

      // Check for next page via Link header
      const linkHeader = resp.headers.get("link") || "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      pageUrl = nextMatch ? nextMatch[1] : "";
      pageCount++;
    }

    if (allLineItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        synced: 0,
        message: "No orders found to sync",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to match variant costs from our variants table
    const skus = [...new Set(allLineItems.filter(li => li.sku).map(li => li.sku!))];
    let costMap: Record<string, number> = {};

    if (skus.length > 0) {
      // Fetch in batches of 100
      for (let i = 0; i < skus.length; i += 100) {
        const batch = skus.slice(i, i + 100);
        const { data: variants } = await supabaseAdmin
          .from("variants")
          .select("sku, cost")
          .eq("user_id", userId)
          .in("sku", batch);
        if (variants) {
          for (const v of variants) {
            if (v.sku && v.cost > 0) costMap[v.sku] = v.cost;
          }
        }
      }
    }

    // Build upsert rows
    const rows = allLineItems.map((li) => {
      const unitCost = li.sku && costMap[li.sku] ? costMap[li.sku] : 0;
      return {
        user_id: userId!,
        order_ref: li.order_ref,
        sold_at: li.sold_at,
        product_id: null as string | null, // We don't have internal product IDs mapped
        variant_id: null as string | null,
        quantity_sold: li.quantity,
        revenue: li.revenue,
        cost_of_goods: unitCost * li.quantity,
        source: "shopify",
      };
    });

    // Deduplicate: check existing order_refs to avoid duplicates
    const orderRefs = [...new Set(rows.map(r => r.order_ref))];
    const existingRefs = new Set<string>();

    for (let i = 0; i < orderRefs.length; i += 100) {
      const batch = orderRefs.slice(i, i + 100);
      const { data: existing } = await supabaseAdmin
        .from("sales_data")
        .select("order_ref")
        .eq("user_id", userId)
        .eq("source", "shopify")
        .in("order_ref", batch);
      if (existing) {
        for (const e of existing) {
          if (e.order_ref) existingRefs.add(e.order_ref);
        }
      }
    }

    const newRows = rows.filter(r => !existingRefs.has(r.order_ref));

    if (newRows.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        synced: 0,
        skipped: rows.length,
        message: "All orders already synced",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert in batches of 500
    let inserted = 0;
    for (let i = 0; i < newRows.length; i += 500) {
      const batch = newRows.slice(i, i + 500);
      const { error: insertError } = await supabaseAdmin
        .from("sales_data")
        .insert(batch);
      if (insertError) {
        console.error("Insert error:", insertError);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      synced: inserted,
      skipped: rows.length - newRows.length,
      total_orders: allLineItems.length,
      message: `Synced ${inserted} new line items from Shopify orders`,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Order sync error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
