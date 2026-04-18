// Sync Lightspeed catalog into product_catalog_cache
// POST { user_id, account_id, access_token, location_id, variant?: "x" | "r", domain_prefix? }
//
// Supports both Lightspeed Retail R-Series (on-premise/legacy)
//   base: https://api.lightspeedapp.com/API/Account/{account_id}/
// and Lightspeed Retail X-Series (cloud / Vend)
//   base: https://{domain_prefix}.retail.lightspeed.app/api/2.0/

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIZE_RE =
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|os|one\s?size|au\d{1,2}|us\d{1,2}|uk\d{1,2}|eu\d{2}|\d{1,2}(\.\d)?)$/i;

function isSizeToken(s: string): boolean {
  return SIZE_RE.test(s.trim());
}

function parseColourSize(
  description: string,
  attrs?: Record<string, string | null | undefined>,
): { colour: string | null; size: string | null } {
  // Prefer explicit attribute fields (matrix attributes)
  if (attrs) {
    const lower: Record<string, string | null | undefined> = {};
    for (const k of Object.keys(attrs)) lower[k.toLowerCase()] = attrs[k];
    const colour =
      lower["colour"] ?? lower["color"] ?? lower["shade"] ?? null;
    const size = lower["size"] ?? lower["length"] ?? lower["fit"] ?? null;
    if (colour || size) {
      return { colour: colour || null, size: size || null };
    }
  }

  if (!description) return { colour: null, size: null };
  const parts = description.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { colour: parts[0], size: parts.slice(1).join(" / ") };
  }
  if (parts.length === 1) {
    const s = parts[0];
    if (isSizeToken(s) || /^size\s+/i.test(s)) {
      return { colour: null, size: s.replace(/^size\s+/i, "").trim() || s };
    }
    return { colour: s, size: null };
  }
  return { colour: null, size: null };
}

async function lsFetch(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return lsFetch(url, token);
  }
  return res;
}

// ── R-Series (legacy) ──────────────────────────────────────────
async function syncRSeries(
  accountId: string,
  token: string,
  locationId: string,
) {
  const items: any[] = [];
  let offset = 0;
  const limit = 100;
  const relations = encodeURIComponent('["ItemShops","Prices","ItemMatrix"]');

  while (true) {
    const url =
      `https://api.lightspeedapp.com/API/Account/${accountId}/Item.json` +
      `?limit=${limit}&offset=${offset}&load_relations=${relations}`;
    const res = await lsFetch(url, token);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Lightspeed R items fetch failed (${res.status}): ${txt}`);
    }
    const json = await res.json();
    const batch = Array.isArray(json.Item)
      ? json.Item
      : json.Item
      ? [json.Item]
      : [];
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  const rows: any[] = [];
  for (const item of items) {
    const itemShops = Array.isArray(item.ItemShops?.ItemShop)
      ? item.ItemShops.ItemShop
      : item.ItemShops?.ItemShop
      ? [item.ItemShops.ItemShop]
      : [];
    const shop = itemShops.find((s: any) => String(s.shopID) === String(locationId)) ||
      itemShops[0];
    const qty = shop?.qoh ? Number(shop.qoh) : null;
    const price = shop?.salePrice
      ? Number(shop.salePrice)
      : item.Prices?.ItemPrice?.[0]?.amount
      ? Number(item.Prices.ItemPrice[0].amount)
      : null;
    const cost = item.avgCost ? Number(item.avgCost) : null;

    const attrs: Record<string, string | null | undefined> = {};
    // R-Series matrix attributes appear under item.ItemMatrix or custom fields
    if (item.ItemMatrix?.ItemAttributeSet) {
      const set = item.ItemMatrix.ItemAttributeSet;
      if (set.attribute1Name) attrs[set.attribute1Name] = item.attribute1Value;
      if (set.attribute2Name) attrs[set.attribute2Name] = item.attribute2Value;
      if (set.attribute3Name) attrs[set.attribute3Name] = item.attribute3Value;
    }

    const { colour, size } = parseColourSize(item.description || "", attrs);

    rows.push({
      platform: "lightspeed",
      platform_product_id: String(item.itemMatrixID || item.itemID),
      platform_variant_id: String(item.itemID),
      sku: item.systemSku || item.customSku || null,
      product_title: item.description || "",
      variant_title: [attrs.colour || attrs.color, attrs.size]
        .filter(Boolean)
        .join(" / ") || null,
      colour,
      size,
      current_qty: qty,
      current_cost: cost,
      current_price: price,
      barcode: item.upc || item.ean || null,
    });
  }

  return { items: items.length, rows };
}

// ── X-Series (cloud / Vend) ────────────────────────────────────
async function syncXSeries(
  domainPrefix: string,
  token: string,
  locationId: string,
) {
  const products: any[] = [];
  let after = 0;
  const pageSize = 200;

  while (true) {
    const url =
      `https://${domainPrefix}.retail.lightspeed.app/api/2.0/products` +
      `?page_size=${pageSize}&after=${after}`;
    const res = await lsFetch(url, token);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Lightspeed X products fetch failed (${res.status}): ${txt}`);
    }
    const json = await res.json();
    const batch = json.data || [];
    products.push(...batch);
    const nextAfter = json.version?.max;
    if (!batch.length || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  // Fetch inventory in bulk for the given outlet
  const inventoryMap = new Map<string, number>();
  let invAfter = 0;
  while (true) {
    const url =
      `https://${domainPrefix}.retail.lightspeed.app/api/2.0/inventory` +
      `?page_size=500&after=${invAfter}` +
      (locationId ? `&outlet_id=${encodeURIComponent(locationId)}` : "");
    const res = await lsFetch(url, token);
    if (!res.ok) break;
    const json = await res.json();
    const batch = json.data || [];
    for (const lvl of batch) {
      if (locationId && lvl.outlet_id !== locationId) continue;
      const prev = inventoryMap.get(lvl.product_id) || 0;
      inventoryMap.set(lvl.product_id, prev + Number(lvl.inventory_level || 0));
    }
    const nextAfter = json.version?.max;
    if (!batch.length || !nextAfter || nextAfter === invAfter) break;
    invAfter = nextAfter;
  }

  const rows: any[] = [];
  for (const p of products) {
    if (p.is_active === false || p.deleted_at) continue;

    const attrs: Record<string, string | null | undefined> = {};
    for (const va of p.variant_options || []) {
      if (va.name && va.value) attrs[va.name] = va.value;
    }

    const { colour, size } = parseColourSize(p.name || "", attrs);
    const qty = inventoryMap.has(p.id) ? inventoryMap.get(p.id)! : null;

    rows.push({
      platform: "lightspeed",
      platform_product_id: String(p.product_id || p.id),
      platform_variant_id: String(p.id),
      sku: p.sku || null,
      product_title: p.name || "",
      variant_title: p.variant_name || null,
      colour,
      size,
      current_qty: qty,
      current_cost: p.supply_price != null ? Number(p.supply_price) : null,
      current_price: p.price_including_tax != null
        ? Number(p.price_including_tax)
        : p.price_excluding_tax != null
        ? Number(p.price_excluding_tax)
        : null,
      barcode: p.barcode || null,
    });
  }

  return { items: products.length, rows };
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
      account_id,
      access_token,
      location_id,
      variant,
      domain_prefix,
    } = body || {};

    if (!user_id || !access_token) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: user_id, access_token",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Auto-detect variant if not provided
    const ls = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let resolvedVariant: "x" | "r" | undefined = variant;
    let resolvedDomainPrefix: string | undefined = domain_prefix;
    let resolvedAccountId: string | undefined = account_id;

    if (!resolvedVariant) {
      const { data: conn } = await ls
        .from("pos_connections")
        .select(
          "ls_x_domain_prefix, ls_x_access_token, ls_r_account_id, ls_r_access_token",
        )
        .eq("user_id", user_id)
        .maybeSingle();
      if (conn?.ls_x_domain_prefix) {
        resolvedVariant = "x";
        resolvedDomainPrefix ||= conn.ls_x_domain_prefix as string;
      } else if (conn?.ls_r_account_id) {
        resolvedVariant = "r";
        resolvedAccountId ||= conn.ls_r_account_id as string;
      } else {
        // Fall back from inputs
        resolvedVariant = resolvedDomainPrefix ? "x" : "r";
      }
    }

    if (resolvedVariant === "x" && !resolvedDomainPrefix) {
      throw new Error("X-Series sync requires domain_prefix");
    }
    if (resolvedVariant === "r" && !resolvedAccountId) {
      throw new Error("R-Series sync requires account_id");
    }

    // Run the appropriate sync
    const { items, rows } =
      resolvedVariant === "x"
        ? await syncXSeries(resolvedDomainPrefix!, access_token, location_id)
        : await syncRSeries(resolvedAccountId!, access_token, location_id);

    // Stamp user_id + cached_at on every row
    const nowIso = new Date().toISOString();
    const enriched = rows.map((r) => ({
      ...r,
      user_id,
      cached_at: nowIso,
    }));

    // Upsert in chunks
    const supabase = ls;
    const CHUNK = 500;
    for (let i = 0; i < enriched.length; i += CHUNK) {
      const chunk = enriched.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("product_catalog_cache")
        .upsert(chunk, {
          onConflict: "user_id,platform,platform_variant_id",
        });
      if (error) throw new Error(`Cache upsert failed: ${error.message}`);
    }

    // Update last_synced_at on platform_connections (if a row exists)
    await supabase
      .from("platform_connections")
      .update({ last_synced_at: nowIso })
      .eq("user_id", user_id)
      .eq("platform", "lightspeed");

    return new Response(
      JSON.stringify({
        items_synced: items,
        variants_synced: rows.length,
        duration_ms: Date.now() - startedAt,
        variant: resolvedVariant,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("sync-lightspeed-catalog error:", err);
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
