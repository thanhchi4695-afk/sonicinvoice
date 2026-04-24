// Sync barcodes from Lightspeed (product_catalog_cache) to Shopify variants.
// Streams NDJSON progress events so the UI can show live counts.
//
// Stream events (one JSON object per line):
//   { type: "start", total_lightspeed: N }
//   { type: "shopify_scan", scanned: N }
//   { type: "shopify_scan_done", total_shopify: N }
//   { type: "progress", processed: N, updated: N, already: N, no_match: N, errors: N }
//   { type: "done", updated, already_had_barcode, no_shopify_match,
//                   no_barcode_in_lightspeed, errors }
//   { type: "error", message }

import { createClient } from "npm:@supabase/supabase-js@2";
import { ensureValidToken, ShopifyReauthRequiredError, type ShopifyConnectionRow } from "../_shared/shopify-token.ts";

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

  // Auth up-front so we can fail fast (non-streaming) on unauth.
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const userId = user.id;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        // 1. Shopify connection
        const { data: shopifyConn } = await supabase
          .from("shopify_connections")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (!shopifyConn?.store_url || !shopifyConn?.access_token) {
          send({ type: "error", message: "No Shopify connection found" });
          controller.close();
          return;
        }

        let valid;
        try {
          valid = await ensureValidToken(supabase, shopifyConn as ShopifyConnectionRow);
        } catch (err) {
          if (err instanceof ShopifyReauthRequiredError) {
            send({ type: "error", message: "Shopify re-authentication required", needs_reauth: true });
          } else {
            send({ type: "error", message: err instanceof Error ? err.message : "Token error" });
          }
          controller.close();
          return;
        }

        const shop = valid.storeUrl
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        const apiVersion = valid.apiVersion || "2024-10";
        const shopifyBase = `https://${shop}/admin/api/${apiVersion}`;
        const shopifyHeaders = {
          "X-Shopify-Access-Token": valid.accessToken,
          "Content-Type": "application/json",
        };

        // 2. Lightspeed rows
        const { data: lsRows, error: lsErr } = await supabase
          .from("product_catalog_cache")
          .select("sku, barcode, product_title")
          .eq("user_id", userId)
          .eq("platform", "lightspeed")
          .not("barcode", "is", null)
          .not("sku", "is", null);

        if (lsErr) {
          send({ type: "error", message: `Catalog read failed: ${lsErr.message}` });
          controller.close();
          return;
        }

        const total = lsRows?.length || 0;
        send({ type: "start", total_lightspeed: total });

        if (total === 0) {
          send({
            type: "done",
            updated: 0,
            already_had_barcode: 0,
            no_shopify_match: 0,
            no_barcode_in_lightspeed: 0,
            errors: [],
            note: "No Lightspeed rows with barcodes found. Run 'Sync catalog' first.",
          });
          controller.close();
          return;
        }

        // 3. Scan Shopify variants
        const skuMap = new Map<string, ShopifyVariant>();
        let pageInfo: string | null = null;
        let pages = 0;
        const MAX_PAGES = 50;
        let usedFallback = false;

        do {
          const url = pageInfo
            ? `${shopifyBase}/variants.json?limit=250&page_info=${pageInfo}`
            : `${shopifyBase}/variants.json?limit=250&fields=id,sku,barcode`;
          const res = await fetch(url, { headers: shopifyHeaders });
          if (!res.ok) {
            if (res.status === 404 || res.status === 403) {
              usedFallback = true;
              await collectViaProducts(shopifyBase, shopifyHeaders, skuMap, (n) =>
                send({ type: "shopify_scan", scanned: n }),
              );
              break;
            }
            send({ type: "error", message: `Shopify variants fetch failed (${res.status})` });
            controller.close();
            return;
          }
          const json = await res.json();
          const variants: ShopifyVariant[] = json.variants || [];
          for (const v of variants) {
            if (v.sku) skuMap.set(normalizeSku(v.sku), v);
          }
          send({ type: "shopify_scan", scanned: skuMap.size });

          const link = res.headers.get("link") || res.headers.get("Link") || "";
          const next = /<([^>]+)>;\s*rel="next"/.exec(link);
          pageInfo = next ? new URL(next[1]).searchParams.get("page_info") : null;
          pages++;
          if (pages >= MAX_PAGES) break;
          if (pageInfo) await new Promise((r) => setTimeout(r, 500));
        } while (pageInfo);

        send({ type: "shopify_scan_done", total_shopify: skuMap.size, fallback: usedFallback });

        // 4. Apply barcode updates
        let updated = 0;
        let already = 0;
        let noMatch = 0;
        let noBarcode = 0;
        let processed = 0;
        const errors: { sku: string; reason: string }[] = [];
        const PROGRESS_EVERY = 5;

        for (const row of lsRows) {
          processed++;
          if (!row.barcode) {
            noBarcode++;
          } else if (!row.sku) {
            noMatch++;
          } else {
            const variant = skuMap.get(normalizeSku(row.sku));
            if (!variant) {
              noMatch++;
            } else if (variant.barcode && variant.barcode.trim() !== "") {
              already++;
            } else {
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
                  errors.push({
                    sku: row.sku,
                    reason: `HTTP ${updateRes.status}: ${txt.slice(0, 120)}`,
                  });
                } else {
                  updated++;
                }
                await new Promise((r) => setTimeout(r, 600));
              } catch (e) {
                errors.push({
                  sku: row.sku,
                  reason: e instanceof Error ? e.message : String(e),
                });
              }
            }
          }

          if (processed % PROGRESS_EVERY === 0 || processed === total) {
            send({
              type: "progress",
              processed,
              total,
              updated,
              already,
              no_match: noMatch,
              errors: errors.length,
            });
          }
        }

        send({
          type: "done",
          updated,
          already_had_barcode: already,
          no_shopify_match: noMatch,
          no_barcode_in_lightspeed: noBarcode,
          errors,
        });
        controller.close();
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
});

function normalizeSku(s: string): string {
  return s.trim().toUpperCase();
}

async function collectViaProducts(
  base: string,
  headers: Record<string, string>,
  skuMap: Map<string, ShopifyVariant>,
  onProgress: (n: number) => void,
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
    onProgress(skuMap.size);
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    pageInfo = next ? new URL(next[1]).searchParams.get("page_info") : null;
    pages++;
    if (pages >= 50) break;
    if (pageInfo) await new Promise((r) => setTimeout(r, 500));
  } while (pageInfo);
}
