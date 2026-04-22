// Sync barcodes from Lightspeed (product_catalog_cache) to Shopify variants.
// For each Lightspeed row with a barcode, find the matching Shopify variant by SKU
// and PUT the barcode if Shopify's barcode is currently empty.
//
// POST {} (auth header carries user identity)
// Returns: { updated, already_had_barcode, no_shopify_match, no_barcode_in_lightspeed, errors }

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ShopifyVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
}

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

    // 1. Load Shopify connection
    const { data: shopifyConn } = await supabase
      .from("shopify_connections")
      .select("store_url, access_token, api_version")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!shopifyConn?.store_url || !shopifyConn?.access_token) {
      return respond({ error: "No Shopify connection found" }, 404);
    }

    const shop = shopifyConn.store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const apiVersion = shopifyConn.api_version || "2024-10";
    const shopifyBase = `https://${shop}/admin/api/${apiVersion}`;
    const shopifyHeaders = {
      "X-Shopify-Access-Token": shopifyConn.access_token,
      "Content-Type": "application/json",
    };

    // 2. Load all Lightspeed cached rows with barcodes
    const { data: lsRows, error: lsErr } = await supabase
      .from("product_catalog_cache")
      .select("sku, barcode, product_title")
      .eq("user_id", user.id)
      .eq("platform", "lightspeed")
      .not("barcode", "is", null)
      .not("sku", "is", null);

    if (lsErr) throw new Error(`Catalog read failed: ${lsErr.message}`);

    if (!lsRows || lsRows.length === 0) {
      return respond({
        updated: 0,
        already_had_barcode: 0,
        no_shopify_match: 0,
        no_barcode_in_lightspeed: 0,
        errors: [],
        note: "No Lightspeed rows with barcodes found. Run 'Sync catalog' first.",
      });
    }

    // 3. Fetch all Shopify variants (paginated). Map by sku → variant.
    const skuMap = new Map<string, ShopifyVariant>();
    let pageInfo: string | null = null;
    let pageCount = 0;
    const MAX_PAGES = 50; // safety

    do {
      const url = pageInfo
        ? `${shopifyBase}/variants.json?limit=250&page_info=${pageInfo}`
        : `${shopifyBase}/variants.json?limit=250&fields=id,sku,barcode`;
      const res = await fetch(url, { headers: shopifyHeaders });
      if (!res.ok) {
        // Fallback: variants.json may not be globally listable on all plans;
        // walk products instead.
        if (res.status === 404 || res.status === 403) {
          await collectViaProducts(shopifyBase, shopifyHeaders, skuMap);
          break;
        }
        throw new Error(`Shopify variants fetch failed (${res.status})`);
      }
      const json = await res.json();
      const variants: ShopifyVariant[] = json.variants || [];
      for (const v of variants) {
        if (v.sku) skuMap.set(normalizeSku(v.sku), v);
      }
      // Pagination via Link header
      const link = res.headers.get("link") || res.headers.get("Link") || "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      pageInfo = next ? new URL(next[1]).searchParams.get("page_info") : null;
      pageCount++;
      if (pageCount >= MAX_PAGES) break;
      if (pageInfo) await new Promise(r => setTimeout(r, 500)); // rate-limit
    } while (pageInfo);

    // 4. Walk Lightspeed rows, push barcodes where appropriate
    let updated = 0;
    let already = 0;
    let noMatch = 0;
    let noBarcode = 0;
    const errors: { sku: string; reason: string }[] = [];

    for (const row of lsRows) {
      if (!row.barcode) { noBarcode++; continue; }
      if (!row.sku) { noMatch++; continue; }

      const variant = skuMap.get(normalizeSku(row.sku));
      if (!variant) { noMatch++; continue; }
      if (variant.barcode && variant.barcode.trim() !== "") { already++; continue; }

      try {
        const updateRes = await fetch(
          `${shopifyBase}/variants/${variant.id}.json`,
          {
            method: "PUT",
            headers: shopifyHeaders,
            body: JSON.stringify({
              variant: { id: variant.id, barcode: row.barcode },
            }),
          },
        );
        if (!updateRes.ok) {
          const txt = await updateRes.text();
          errors.push({ sku: row.sku, reason: `HTTP ${updateRes.status}: ${txt.slice(0, 120)}` });
        } else {
          updated++;
        }
        // Be polite to Shopify (2 calls/sec on standard, 4 on plus)
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        errors.push({ sku: row.sku, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return respond({
      updated,
      already_had_barcode: already,
      no_shopify_match: noMatch,
      no_barcode_in_lightspeed: noBarcode,
      errors,
    });
  } catch (err) {
    return respond({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

function normalizeSku(s: string): string {
  return s.trim().toUpperCase();
}

async function collectViaProducts(
  base: string,
  headers: Record<string, string>,
  skuMap: Map<string, ShopifyVariant>,
) {
  let pageInfo: string | null = null;
  let pages = 0;
  do {
    const url = pageInfo
      ? `${base}/products.json?limit=250&page_info=${pageInfo}`
      : `${base}/products.json?limit=250&fields=id,variants`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Shopify products fetch failed (${res.status})`);
    const json = await res.json();
    for (const p of json.products || []) {
      for (const v of (p.variants || []) as ShopifyVariant[]) {
        if (v.sku) skuMap.set(normalizeSku(v.sku), v);
      }
    }
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    pageInfo = next ? new URL(next[1]).searchParams.get("page_info") : null;
    pages++;
    if (pages >= 50) break;
    if (pageInfo) await new Promise(r => setTimeout(r, 500));
  } while (pageInfo);
}
