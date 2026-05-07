/**
 * gap-scanner
 *
 * Scans a user's connected Shopify store for products missing images
 * or descriptions, and upserts them into product_enrichment_queue.
 *
 * POST body: {} (uses caller's JWT to identify user)
 * Response: { total_scanned, incomplete_found, newly_queued,
 *             already_in_queue, skipped, warning?, error? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_PRODUCTS = 2000;
const PAGE_SIZE = 250;
const PAGE_DELAY_MS = 500;
const PLACEHOLDER_PATTERNS = [
  /^tba\.?$/i,
  /^coming soon\.?$/i,
  /^description coming\.?$/i,
  /^no description\.?$/i,
  /^n\/?a\.?$/i,
];

const SIZE_TOKENS = new Set([
  "xxs", "xs", "s", "small", "m", "medium", "l", "large",
  "xl", "xxl", "xxxl", "2xl", "3xl", "os", "onesize", "one size",
  "6","8","10","12","14","16","18","20","22","24",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function isIncomplete(p: ShopifyProduct): boolean {
  if (!p.images || p.images.length === 0) return true;
  const text = stripHtml(p.body_html);
  if (text.length < 50) return true;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(text))) return true;
  return false;
}

function extractStyleNumber(p: ShopifyProduct): string {
  const skus = (p.variants ?? [])
    .map((v) => (v?.sku ?? "").trim())
    .filter(Boolean);
  for (const sku of skus) {
    if (/^[A-Z0-9]{4,}/i.test(sku) && sku.length >= 6) return sku;
  }
  return p.handle;
}

function extractColour(title: string): string | null {
  if (!title) return null;
  const parts = title.split(/\s+[-|]\s+/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  const lower = last.toLowerCase();
  if (!last || SIZE_TOKENS.has(lower)) return null;
  if (/^\d+$/.test(last)) return null;
  // crude: a colour is mostly letters, 2-30 chars
  if (!/^[a-z\s/&-]{2,30}$/i.test(last)) return null;
  return last;
}

function fuzzyBrandMatch(
  vendor: string,
  brands: Array<{ brand_name: string; website_url: string | null }>,
): string | null {
  if (!vendor) return null;
  const v = vendor.toLowerCase().trim();
  for (const b of brands) {
    const n = (b.brand_name ?? "").toLowerCase().trim();
    if (!n) continue;
    if (n === v || n.includes(v) || v.includes(n)) {
      return b.website_url || null;
    }
  }
  return null;
}

// Parse the Link header for the next page_info cursor.
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) {
      try {
        const u = new URL(m[1]);
        return u.searchParams.get("page_info");
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface ShopifyVariant { sku?: string }
interface ShopifyImage { src?: string }
interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  body_html: string | null;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Shopify connection
    const { data: conn, error: connErr } = await admin
      .from("shopify_connections")
      .select("store_url, access_token, api_version")
      .eq("user_id", userId)
      .maybeSingle();
    if (connErr) return json({ error: `DB error: ${connErr.message}` }, 500);
    if (!conn?.store_url || !conn?.access_token) {
      return json({ error: "No Shopify connection found" }, 400);
    }
    const storeUrl = conn.store_url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const apiVersion = conn.api_version || "2025-01";

    // 2. Brand directory for vendor → website lookup
    const { data: brandsData } = await admin
      .from("supplier_websites")
      .select("brand_name, website_url")
      .eq("user_id", userId);
    const brands = (brandsData ?? []) as Array<{ brand_name: string; website_url: string | null }>;

    // 3. Existing queue rows for this user (status check)
    const { data: existingRows } = await admin
      .from("product_enrichment_queue")
      .select("shopify_product_id, status, retry_count, max_retries")
      .eq("user_id", userId);
    const existing = new Map<string, { status: string; retry_count: number; max_retries: number }>();
    for (const r of existingRows ?? []) {
      existing.set(String(r.shopify_product_id), {
        status: r.status,
        retry_count: r.retry_count ?? 0,
        max_retries: r.max_retries ?? 8,
      });
    }

    // 4. Paginate Shopify products
    const allProducts: ShopifyProduct[] = [];
    let pageInfo: string | null = null;
    let warning: string | undefined;
    const fields = "id,handle,title,vendor,body_html,images,variants";

    while (true) {
      const params = new URLSearchParams();
      if (pageInfo) {
        params.set("page_info", pageInfo);
        params.set("limit", String(PAGE_SIZE));
      } else {
        params.set("status", "active");
        params.set("limit", String(PAGE_SIZE));
        params.set("fields", fields);
      }
      const url = `https://${storeUrl}/admin/api/${apiVersion}/products.json?${params}`;
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": conn.access_token,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return json({ error: `Shopify API ${res.status}: ${text.slice(0, 300)}` }, 502);
      }
      const body = await res.json();
      const products: ShopifyProduct[] = body.products ?? [];
      allProducts.push(...products);

      if (allProducts.length >= MAX_PRODUCTS) {
        warning = `Reached max scan size of ${MAX_PRODUCTS}; run again for remainder.`;
        break;
      }
      pageInfo = parseNextPageInfo(res.headers.get("link") || res.headers.get("Link"));
      if (!pageInfo) break;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }

    // 5. Classify + upsert
    let incompleteFound = 0;
    let newlyQueued = 0;
    let alreadyInQueue = 0;
    let skipped = 0;

    const upsertRows: Record<string, unknown>[] = [];

    for (const p of allProducts) {
      if (!isIncomplete(p)) continue;
      incompleteFound++;

      const idStr = String(p.id);
      const prev = existing.get(idStr);
      if (prev) {
        const blockedStatuses = new Set([
          "approved", "pushed", "skipped", "pending_review",
        ]);
        if (blockedStatuses.has(prev.status)) {
          skipped++;
          continue;
        }
        if (prev.status === "not_found" && prev.retry_count >= prev.max_retries) {
          skipped++;
          continue;
        }
        alreadyInQueue++;
      } else {
        newlyQueued++;
      }

      const styleNumber = extractStyleNumber(p);
      const colour = extractColour(p.title);
      const supplierUrl = fuzzyBrandMatch(p.vendor, brands);

      upsertRows.push({
        user_id: userId,
        shopify_product_id: idStr,
        shopify_handle: p.handle,
        product_title: p.title,
        vendor: p.vendor || null,
        style_number: styleNumber,
        colour,
        supplier_url: supplierUrl,
        status: prev ? prev.status : "pending",
        updated_at: new Date().toISOString(),
      });
    }

    // Batch upserts
    if (upsertRows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const chunk = upsertRows.slice(i, i + CHUNK);
        const { error: upErr } = await admin
          .from("product_enrichment_queue")
          .upsert(chunk, { onConflict: "user_id,shopify_product_id" });
        if (upErr) {
          return json({ error: `Upsert failed: ${upErr.message}` }, 500);
        }
      }
    }

    return json({
      total_scanned: allProducts.length,
      incomplete_found: incompleteFound,
      newly_queued: newlyQueued,
      already_in_queue: alreadyInQueue,
      skipped,
      ...(warning ? { warning } : {}),
    });
  } catch (e) {
    console.error("[gap-scanner] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
