// Sync Shopify catalog into product_catalog_cache
// POST { user_id, shop_domain, access_token, mode?: "full" | "incremental", location_id? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ensureValidToken, ShopifyReauthRequiredError, type ShopifyConnectionRow } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_VERSION = "2024-01";

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  price: string | null;
  barcode: string | null;
  inventory_quantity: number | null;
  inventory_item_id: number;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  variants: ShopifyVariant[];
  options?: { name: string; values: string[] }[];
}

const SIZE_RE =
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|os|one\s?size|au\d{1,2}|us\d{1,2}|uk\d{1,2}|eu\d{2}|\d{1,2}(\.\d)?|\d{1,2}\s*(year|yr|y|month|months|m)|\d{1,2}\s*-\s*\d{1,2}\s*(month|months|m))$/i;

function isSizeToken(s: string): boolean {
  return SIZE_RE.test(s.trim());
}

function parseVariantTitle(
  title: string,
  optionNames: string[] = [],
  variant?: ShopifyVariant,
): { colour: string | null; size: string | null } {
  // Prefer Shopify option metadata when available
  if (variant && optionNames.length > 0) {
    const opts: Record<string, string | null | undefined> = {};
    optionNames.forEach((name, i) => {
      const key = name.toLowerCase();
      const val = (variant as any)[`option${i + 1}`];
      opts[key] = val;
    });
    const colour =
      opts["colour"] ?? opts["color"] ?? opts["shade"] ?? null;
    const size =
      opts["size"] ?? opts["length"] ?? opts["fit"] ?? null;
    if (colour || size) {
      return { colour: colour || null, size: size || null };
    }
  }

  if (!title || title === "Default Title") {
    return { colour: null, size: null };
  }

  const parts = title.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { colour: parts[0], size: parts.slice(1).join(" / ") };
  }
  if (parts.length === 1) {
    const single = parts[0];
    if (isSizeToken(single) || /^size\s+/i.test(single)) {
      return {
        colour: null,
        size: single.replace(/^size\s+/i, "").trim() || single,
      };
    }
    return { colour: single, size: null };
  }
  return { colour: null, size: null };
}

function parseLinkHeader(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    return url.searchParams.get("page_info");
  } catch {
    return null;
  }
}

async function shopifyFetch(
  shop: string,
  token: string,
  path: string,
): Promise<Response> {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 429) {
    // rate limited — back off briefly and retry once
    await new Promise((r) => setTimeout(r, 2000));
    return shopifyFetch(shop, token, path);
  }
  return res;
}

async function fetchProductsPage(
  shop: string,
  token: string,
  pageInfo: string | null,
  updatedAtMin: string | undefined,
): Promise<{ products: ShopifyProduct[]; nextPageInfo: string | null }> {
  const baseFields = "id,title,vendor,variants,options,updated_at";
  let path: string;
  if (pageInfo) {
    path = `/products.json?limit=250&fields=${baseFields}&page_info=${encodeURIComponent(pageInfo)}`;
  } else {
    const params = new URLSearchParams({ limit: "250", fields: baseFields });
    if (updatedAtMin) params.set("updated_at_min", updatedAtMin);
    path = `/products.json?${params.toString()}`;
  }
  const res = await shopifyFetch(shop, token, path);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Shopify products fetch failed (${res.status}): ${txt}`);
  }
  const json = await res.json();
  return {
    products: (json.products as ShopifyProduct[]) || [],
    nextPageInfo: parseLinkHeader(res.headers.get("link")),
  };
}

async function fetchInventoryLevels(
  shop: string,
  token: string,
  inventoryItemIds: number[],
  locationId?: string,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (inventoryItemIds.length === 0) return map;

  // Shopify caps inventory_item_ids at 50 per request
  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    const batch = inventoryItemIds.slice(i, i + 50);
    const params = new URLSearchParams({
      inventory_item_ids: batch.join(","),
      limit: "250",
    });
    if (locationId) params.set("location_ids", locationId);

    const res = await shopifyFetch(
      shop,
      token,
      `/inventory_levels.json?${params.toString()}`,
    );
    if (!res.ok) continue; // non-fatal — fall back to variant.inventory_quantity
    const json = await res.json();
    for (const lvl of json.inventory_levels || []) {
      // If multiple locations, sum quantities per inventory_item_id
      const prev = map.get(lvl.inventory_item_id) || 0;
      map.set(lvl.inventory_item_id, prev + (lvl.available || 0));
    }
  }

  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();

  try {
    const body = await req.json();
    const {
      user_id,
      shop_domain,
      access_token,
      mode = "full",
      location_id,
    } = body || {};

    if (!user_id) {
      return new Response(
        JSON.stringify({
          error: "Missing required field: user_id",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let resolvedShopDomain = shop_domain as string | undefined;
    let resolvedAccessToken = access_token as string | undefined;
    let resolvedLocationId = location_id as string | undefined;
    let lastSyncedAt: string | undefined;

    const { data: platformConn } = await supabase
      .from("platform_connections")
      .select("shop_domain, access_token, location_id, last_synced_at")
      .eq("user_id", user_id)
      .eq("platform", "shopify")
      .eq("is_active", true)
      .maybeSingle();

    if (platformConn) {
      resolvedShopDomain ??= platformConn.shop_domain ?? undefined;
      resolvedAccessToken ??= platformConn.access_token ?? undefined;
      resolvedLocationId ??= platformConn.location_id ?? undefined;
      lastSyncedAt = platformConn.last_synced_at ?? undefined;
    }

    if (!resolvedShopDomain || !resolvedAccessToken) {
      const { data: legacyConn } = await supabase
        .from("shopify_connections")
        .select("*")
        .eq("user_id", user_id)
        .maybeSingle();

      if (legacyConn) {
        try {
          const valid = await ensureValidToken(supabase, legacyConn as ShopifyConnectionRow);
          resolvedShopDomain ??= valid.storeUrl;
          resolvedAccessToken ??= valid.accessToken;
        } catch (err) {
          if (err instanceof ShopifyReauthRequiredError) {
            return new Response(JSON.stringify({
              error: "Shopify re-authentication required",
              needs_reauth: true,
              shop: err.shop,
            }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw err;
        }
      }
    }

    if (!resolvedShopDomain || !resolvedAccessToken) {
      return new Response(
        JSON.stringify({
          error: "Missing required Shopify connection for this user",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let updatedAtMin: string | undefined;
    if (mode === "incremental" && lastSyncedAt) {
      updatedAtMin = lastSyncedAt;
    }

    let pageInfo: string | null = null;
    let pageNum = 0;
    let productsSynced = 0;
    let variantsSynced = 0;

    while (true) {
      pageNum++;
      const { products, nextPageInfo } = await fetchProductsPage(
        resolvedShopDomain,
        resolvedAccessToken,
        pageInfo,
        pageNum === 1 ? updatedAtMin : undefined,
      );

      if (products.length === 0 && pageNum === 1) break;

      // Inventory levels for this page only
      const pageInventoryItemIds: number[] = [];
      for (const p of products) {
        for (const v of p.variants || []) {
          if (v.inventory_item_id) pageInventoryItemIds.push(v.inventory_item_id);
        }
      }
      const inventoryMap = await fetchInventoryLevels(
        resolvedShopDomain,
        resolvedAccessToken,
        pageInventoryItemIds,
        resolvedLocationId,
      );

      const rows: any[] = [];
      const nowIso = new Date().toISOString();
      for (const product of products) {
        const optionNames = (product.options || []).map((o) => o.name);
        for (const variant of product.variants || []) {
          const { colour, size } = parseVariantTitle(
            variant.title,
            optionNames,
            variant,
          );
          const liveQty = inventoryMap.get(variant.inventory_item_id);
          const qty =
            liveQty !== undefined ? liveQty : variant.inventory_quantity ?? null;

          rows.push({
            user_id,
            platform: "shopify",
            platform_product_id: String(product.id),
            platform_variant_id: String(variant.id),
            sku: variant.sku || null,
            product_title: product.title,
            variant_title: variant.title,
            vendor: (product as any).vendor || null,
            colour,
            size,
            current_qty: qty,
            current_cost: null,
            current_price: variant.price ? Number(variant.price) : null,
            barcode: variant.barcode || null,
            cached_at: nowIso,
          });
          variantsSynced++;
        }
      }

      if (rows.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const { error } = await supabase
            .from("product_catalog_cache")
            .upsert(rows.slice(i, i + CHUNK), {
              onConflict: "user_id,platform,platform_variant_id",
            });
          if (error) throw new Error(`Cache upsert failed: ${error.message}`);
        }
      }

      productsSynced += products.length;
      console.log(
        `[sync-shopify-catalog] page=${pageNum} products=${products.length} variants_total=${variantsSynced} elapsed_ms=${Date.now() - startedAt}`,
      );

      pageInfo = nextPageInfo;
      if (!pageInfo) break;
    }

    const finishedAt = new Date().toISOString();
    await supabase
      .from("platform_connections")
      .update({ last_synced_at: finishedAt })
      .eq("user_id", user_id)
      .eq("platform", "shopify")
      .eq("shop_domain", resolvedShopDomain);

    return new Response(
      JSON.stringify({
        products_synced: products.length,
        variants_synced: variantsSynced,
        duration_ms: Date.now() - startedAt,
        mode,
        incremental_since: updatedAtMin || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("sync-shopify-catalog error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startedAt,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
