// Shopify products/create | products/update webhook receiver.
// Verifies HMAC, finds the owning user by shop domain, debounces, and triggers
// collection-intelligence to scan for new collection opportunities.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-shop-domain, x-shopify-topic",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") ?? "";
const SHOPIFY_API_SECRET_2 = Deno.env.get("SHOPIFY_API_SECRET_2") ?? "";

// Skip a new scan if one was started for this user in the last N minutes.
const DEBOUNCE_MINUTES = 10;

async function verifyHmac(rawBody: string, hmacHeader: string, secret: string): Promise<boolean> {
  if (!secret || !hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // Constant-time compare
  if (expected.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
    const shopDomain = (req.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
    const topic = req.headers.get("x-shopify-topic") ?? "";

    if (!shopDomain) {
      return new Response(JSON.stringify({ error: "missing shop domain" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Try both possible app secrets (custom app + standard app).
    const ok = (await verifyHmac(rawBody, hmac, SHOPIFY_API_SECRET))
      || (SHOPIFY_API_SECRET_2 && await verifyHmac(rawBody, hmac, SHOPIFY_API_SECRET_2));
    if (!ok) {
      console.warn("shopify-webhook-products: HMAC verify failed", { shopDomain, topic });
      return new Response(JSON.stringify({ error: "invalid hmac" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await admin
      .from("shopify_connections")
      .select("user_id, store_url")
      .eq("store_url", shopDomain)
      .maybeSingle();

    if (!conn?.user_id) {
      // Acknowledge so Shopify doesn't retry; nothing to do for unknown shops.
      return new Response(JSON.stringify({ ok: true, note: "no matching user" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Debounce: skip if a product_push scan started recently for this user.
    const since = new Date(Date.now() - DEBOUNCE_MINUTES * 60_000).toISOString();
    const { data: recent } = await admin
      .from("collection_scans")
      .select("id")
      .eq("user_id", conn.user_id)
      .eq("triggered_by", "product_push")
      .gte("started_at", since)
      .limit(1);

    // Back-in-stock detection: parse incoming variants and compare to last-known qty.
    try {
      const payload = JSON.parse(rawBody);
      const incoming: Array<{ id?: number | string; inventory_quantity?: number; title?: string; sku?: string }> =
        Array.isArray(payload?.variants) ? payload.variants : [];
      const productTitle: string = payload?.title ?? "";
      const productHandle: string = payload?.handle ?? "";
      const productImage: string | null = payload?.image?.src ?? payload?.images?.[0]?.src ?? null;

      if (incoming.length > 0) {
        const ids = incoming.map((v) => String(v?.id ?? "")).filter(Boolean);
        const { data: existing } = await admin
          .from("variants")
          .select("shopify_variant_id, quantity, sku")
          .eq("user_id", conn.user_id)
          .in("shopify_variant_id", ids);
        const prevMap = new Map<string, number>(
          (existing ?? []).map((r: { shopify_variant_id: string; quantity: number }) => [r.shopify_variant_id, r.quantity ?? 0]),
        );

        for (const v of incoming) {
          const vid = String(v?.id ?? "");
          if (!vid) continue;
          const newQty = Number(v?.inventory_quantity ?? 0);
          const oldQty = prevMap.get(vid);
          if (oldQty === 0 && newQty > 0) {
            const klaviyoUrl = `${SUPABASE_URL}/functions/v1/klaviyo-trigger`;
            fetch(klaviyoUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                user_id: conn.user_id,
                event_name: "Sonic: Back In Stock",
                profile: { external_id: `shop:${shopDomain}` },
                unique_id: `bis:${vid}:${Date.now()}`,
                properties: {
                  shop_domain: shopDomain,
                  product_title: productTitle,
                  product_handle: productHandle,
                  product_image: productImage,
                  variant_id: vid,
                  variant_title: v?.title ?? null,
                  variant_sku: v?.sku ?? null,
                  inventory_quantity: newQty,
                },
              }),
            }).catch((e) => console.error("klaviyo-trigger BIS failed:", e));
          }
        }
      }
    } catch (e) {
      console.warn("BIS detection skipped:", e);
    }

    if (recent && recent.length > 0) {
      return new Response(JSON.stringify({ ok: true, debounced: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fire-and-forget invocation of collection-intelligence (must not block webhook ack).
    const url = `${SUPABASE_URL}/functions/v1/collection-intelligence`;
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: conn.user_id, triggered_by: "product_push" }),
    }).catch((e) => console.error("collection-intelligence invoke failed:", e));

    return new Response(JSON.stringify({ ok: true, queued: true, topic }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("shopify-webhook-products error:", e);
    // Return 200 so Shopify does not retry on internal errors we can't recover from.
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
