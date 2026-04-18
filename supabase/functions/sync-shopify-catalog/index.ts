// Sync Shopify catalog into product_catalog_cache
// POST { user_id, shop_domain, access_token, mode?: "full" | "incremental", location_id? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|os|one\s?size|au\d{1,2}|us\d{1,2}|uk\d{1,2}|eu\d{2}|\d{1,2}(\.\d)?)$/i;

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

async function fetchAllProducts(
  shop: string,
  token: string,
  updatedAtMin?: string,
): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  const baseFields = "id,title,variants,options,updated_at";
  let pageInfo: string | null = null;
  let isFirstPage = true;

  while (true) {
    let path: string;
    if (pageInfo) {
      // When using page_info, only limit + fields are allowed
      path = `/products.json?limit=250&fields=${baseFields}&page_info=${encodeURIComponent(pageInfo)}`;
    } else {
      const params = new URLSearchParams({
        limit: "250",
        fields: baseFields,
      });
      if (updatedAtMin && isFirstPage) {
        params.set("updated_at_min", updatedAtMin);
      }
      path = `/products.json?${params.toString()}`;
    }

    const res = await shopifyFetch(shop, token, path);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Shopify products fetch failed (${res.status}): ${txt}`);
    }

    const json = await res.json();
    products.push(...(json.products as ShopifyProduct[]));

    pageInfo = parseLinkHeader(res.headers.get("link"));
    isFirstPage = false;
    if (!pageInfo) break;
  }

  return products;
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

    if (!user_id || !shop_domain || !access_token) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: user_id, shop_domain, access_token",
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

    // Determine updated_at_min for incremental mode
    let updatedAtMin: string | undefined;
    if (mode === "incremental") {
      const { data: conn } = await supabase
        .from("platform_connections")
        .select("last_synced_at")
        .eq("user_id", user_id)
        .eq("platform", "shopify")
        .eq("shop_domain", shop_domain)
        .maybeSingle();
      if (conn?.last_synced_at) {
        updatedAtMin = conn.last_synced_at as string;
      }
    }

    // 1. Fetch products
    const products = await fetchAllProducts(
      shop_domain,
      access_token,
      updatedAtMin,
    );

    // 2. Collect inventory item ids (only if we want fresh inventory)
    const inventoryItemIds: number[] = [];
    for (const p of products) {
      for (const v of p.variants || []) {
        if (v.inventory_item_id) inventoryItemIds.push(v.inventory_item_id);
      }
    }

    const inventoryMap = await fetchInventoryLevels(
      shop_domain,
      access_token,
      inventoryItemIds,
      location_id,
    );

    // 3. Build cache rows
    const rows: any[] = [];
    let variantsSynced = 0;

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
          liveQty !== undefined
            ? liveQty
            : variant.inventory_quantity ?? null;

        rows.push({
          user_id,
          platform: "shopify",
          platform_product_id: String(product.id),
          platform_variant_id: String(variant.id),
          sku: variant.sku || null,
          product_title: product.title,
          variant_title: variant.title,
          colour,
          size,
          current_qty: qty,
          current_cost: null, // cost requires a separate inventory_items call (scope-gated)
          current_price: variant.price ? Number(variant.price) : null,
          barcode: variant.barcode || null,
          cached_at: new Date().toISOString(),
        });
        variantsSynced++;
      }
    }

    // 4. Upsert in chunks (Postgres parameter limits)
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("product_catalog_cache")
        .upsert(chunk, {
          onConflict: "user_id,platform,platform_variant_id",
        });
      if (error) {
        throw new Error(`Cache upsert failed: ${error.message}`);
      }
    }

    // 5. Update last_synced_at
    const nowIso = new Date().toISOString();
    await supabase
      .from("platform_connections")
      .update({ last_synced_at: nowIso })
      .eq("user_id", user_id)
      .eq("platform", "shopify")
      .eq("shop_domain", shop_domain);

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
